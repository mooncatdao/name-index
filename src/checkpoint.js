import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  CHAIN_ID,
  MOONCAT_RESCUE_ADDRESS,
  NAMING_START_BLOCK
} from "./constants.js";

export const CHECKPOINT_SCHEMA_VERSION = 1;
export const DEFAULT_CONFIRMATIONS = 64;
export const DEFAULT_OVERLAP_BLOCKS = 100;
export const DEFAULT_CHUNK_SIZE = 10_000;

const START_BLOCK = Number(NAMING_START_BLOCK);
const CHECKPOINT_FIELDS = [
  "schemaVersion",
  "chainId",
  "contractAddress",
  "startBlock",
  "lastScannedBlock",
  "lastFinalizedBlock",
  "confirmations",
  "overlapBlocks",
  "chunkSize",
  "updatedAt"
];
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;

/** Thrown when a checkpoint is malformed or incompatible with this scanner. */
export class CheckpointValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckpointValidationError";
  }
}

/**
 * Version 1 checkpoint schema. Block fields are safe JSON numbers, and
 * updatedAt is null for deterministic initial state or an ISO-8601 UTC string.
 */
export const DEFAULT_CHECKPOINT = Object.freeze({
  schemaVersion: CHECKPOINT_SCHEMA_VERSION,
  chainId: CHAIN_ID,
  contractAddress: MOONCAT_RESCUE_ADDRESS,
  startBlock: START_BLOCK,
  lastScannedBlock: START_BLOCK - 1,
  lastFinalizedBlock: START_BLOCK - 1,
  confirmations: DEFAULT_CONFIRMATIONS,
  overlapBlocks: DEFAULT_OVERLAP_BLOCKS,
  chunkSize: DEFAULT_CHUNK_SIZE,
  updatedAt: null
});

function fail(message) {
  throw new CheckpointValidationError(message);
}

function assertSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    fail(`${field} must be a safe integer number`);
  }
}

function assertNonnegativeInteger(value, field) {
  assertSafeInteger(value, field);
  if (value < 0) {
    fail(`${field} must be nonnegative`);
  }
}

function assertUpdatedAt(value) {
  if (value === null) {
    return;
  }
  if (typeof value !== "string" || value.length === 0) {
    fail("updatedAt must be null or an ISO-8601 UTC string");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("updatedAt must be null or an ISO-8601 UTC string");
  }
}

/** Validate and return a checkpoint without changing its values. */
export function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    fail("checkpoint must be an object");
  }

  const actualFields = Object.keys(checkpoint).sort();
  const expectedFields = [...CHECKPOINT_FIELDS].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    fail("checkpoint fields do not match schema version 1");
  }
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    fail(`unsupported checkpoint schemaVersion: ${checkpoint.schemaVersion}`);
  }
  if (checkpoint.chainId !== CHAIN_ID) {
    fail(`checkpoint chainId must be ${CHAIN_ID}`);
  }
  if (typeof checkpoint.contractAddress !== "string" ||
      !ADDRESS_PATTERN.test(checkpoint.contractAddress) ||
      checkpoint.contractAddress.toLowerCase() !== MOONCAT_RESCUE_ADDRESS.toLowerCase()) {
    fail("checkpoint contractAddress does not match MoonCatRescue");
  }

  assertNonnegativeInteger(checkpoint.startBlock, "startBlock");
  assertSafeInteger(checkpoint.lastScannedBlock, "lastScannedBlock");
  assertSafeInteger(checkpoint.lastFinalizedBlock, "lastFinalizedBlock");
  if (checkpoint.lastScannedBlock < checkpoint.startBlock - 1) {
    fail("lastScannedBlock cannot precede startBlock - 1");
  }
  if (checkpoint.lastFinalizedBlock < checkpoint.startBlock - 1) {
    fail("lastFinalizedBlock cannot precede startBlock - 1");
  }
  if (checkpoint.lastFinalizedBlock > checkpoint.lastScannedBlock) {
    fail("lastFinalizedBlock cannot exceed lastScannedBlock");
  }
  assertNonnegativeInteger(checkpoint.confirmations, "confirmations");
  assertNonnegativeInteger(checkpoint.overlapBlocks, "overlapBlocks");
  assertSafeInteger(checkpoint.chunkSize, "chunkSize");
  if (checkpoint.chunkSize <= 0) {
    fail("chunkSize must be positive");
  }
  assertUpdatedAt(checkpoint.updatedAt);
  return checkpoint;
}

/** Create deterministic initial state, with optional validated configuration overrides. */
export function createInitialCheckpoint(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("checkpoint overrides must be an object");
  }
  const checkpoint = { ...DEFAULT_CHECKPOINT, ...overrides };
  if (!Object.hasOwn(overrides, "lastScannedBlock")) {
    checkpoint.lastScannedBlock = checkpoint.startBlock - 1;
  }
  if (!Object.hasOwn(overrides, "lastFinalizedBlock")) {
    checkpoint.lastFinalizedBlock = checkpoint.startBlock - 1;
  }
  return validateCheckpoint(checkpoint);
}

/** Resume from the configured overlap, never before the naming start block. */
export function calculateResumeBlock(checkpoint) {
  validateCheckpoint(checkpoint);
  return Math.max(
    checkpoint.startBlock,
    checkpoint.lastScannedBlock - checkpoint.overlapBlocks + 1
  );
}

/** Calculate the finalized boundary, clamped to the pre-start sentinel. */
export function calculateFinalizedBlock(latestBlock, checkpoint) {
  validateCheckpoint(checkpoint);
  assertSafeInteger(latestBlock, "latestBlock");
  if (latestBlock < 0) {
    throw new TypeError("latestBlock must be nonnegative");
  }
  return Math.max(
    checkpoint.startBlock - 1,
    latestBlock - checkpoint.confirmations
  );
}

/** Load a checkpoint or return deterministic initial state when the file is absent. */
export async function loadCheckpoint(filePath, initialOverrides = {}) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return createInitialCheckpoint(initialOverrides);
    }
    throw error;
  }

  let checkpoint;
  try {
    checkpoint = JSON.parse(contents);
  } catch {
    fail("checkpoint file is not valid JSON");
  }
  return validateCheckpoint(checkpoint);
}

function resolveSaveOptions(options) {
  if (options === undefined) {
    return {};
  }
  if (options === null || typeof options === "string") {
    return { updatedAt: options };
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("save options must be an object or timestamp string");
  }
  return options;
}

/** Atomically save a validated checkpoint using a same-directory temporary file. */
export async function saveCheckpoint(filePath, checkpoint, options) {
  const saveOptions = resolveSaveOptions(options);
  const nextCheckpoint = { ...checkpoint };
  if (Object.hasOwn(saveOptions, "updatedAt")) {
    nextCheckpoint.updatedAt = saveOptions.updatedAt;
  }
  const validated = validateCheckpoint(nextCheckpoint);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
  return validated;
}
