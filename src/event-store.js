import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { NAME_STATUS } from "./name-decoder.js";

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;
const NAME_RAW_PATTERN = /^0x[0-9a-f]{64}$/;
const EVENT_ID_PATTERN = /^0x[0-9a-f]{64}:\d+$/;
const REQUIRED_EVENT_FIELDS = [
  "eventId",
  "transactionHash",
  "logIndex",
  "blockNumber",
  "catId",
  "nameRaw",
  "removed",
  "decoded"
];
const OPTIONAL_EVENT_FIELDS = ["blockTimestamp"];
const DECODED_FIELDS = ["rawName", "status", "text"];
const STATUSES = new Set(Object.values(NAME_STATUS));

/** Thrown when duplicate event IDs carry different normalized records. */
export class EventStoreConflictError extends Error {
  constructor(eventId) {
    super(`Conflicting event records share eventId ${eventId}`);
    this.name = "EventStoreConflictError";
  }
}

function fail(message) {
  throw new TypeError(message);
}

function assertSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a nonnegative safe integer`);
  }
}

function assertExactFields(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} fields do not match the normalized schema`);
  }
}

/** Strictly validate one normalized event produced by fetchCatNamedLogs. */
export function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    fail("event must be an object");
  }
  const expectedEventFields = [
    ...REQUIRED_EVENT_FIELDS,
    ...(Object.hasOwn(event, "transactionIndex") ? ["transactionIndex"] : []),
    ...(Object.hasOwn(event, "blockTimestamp") ? OPTIONAL_EVENT_FIELDS : [])
  ];
  assertExactFields(event, expectedEventFields, "event");
  if (typeof event.transactionHash !== "string" ||
      !TX_HASH_PATTERN.test(event.transactionHash)) {
    fail("transactionHash must be lowercase 32-byte hex");
  }
  assertSafeInteger(event.logIndex, "logIndex");
  assertSafeInteger(event.blockNumber, "blockNumber");
  if (Object.hasOwn(event, "transactionIndex")) {
    assertSafeInteger(event.transactionIndex, "transactionIndex");
  }
  if (Object.hasOwn(event, "blockTimestamp")) {
    assertSafeInteger(event.blockTimestamp, "blockTimestamp");
  }
  if (typeof event.catId !== "string" || !CAT_ID_PATTERN.test(event.catId)) {
    fail("catId must be lowercase bytes5 hex");
  }
  if (typeof event.nameRaw !== "string" || !NAME_RAW_PATTERN.test(event.nameRaw)) {
    fail("nameRaw must be lowercase bytes32 hex");
  }
  if (typeof event.removed !== "boolean") {
    fail("removed must be boolean");
  }
  if (typeof event.eventId !== "string" ||
      !EVENT_ID_PATTERN.test(event.eventId) ||
      event.eventId !== `${event.transactionHash}:${event.logIndex}`) {
    fail("eventId must equal transactionHash:logIndex");
  }

  const decoded = event.decoded;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    fail("decoded must be an object");
  }
  const expectedDecodedFields = decoded.status === NAME_STATUS.TEXT ||
    decoded.status === NAME_STATUS.REDACTED
    ? DECODED_FIELDS
    : DECODED_FIELDS.filter((field) => field !== "text");
  assertExactFields(decoded, expectedDecodedFields, "decoded");
  if (decoded.rawName !== event.nameRaw || !NAME_RAW_PATTERN.test(decoded.rawName)) {
    fail("decoded.rawName must match nameRaw");
  }
  if (typeof decoded.status !== "string" || !STATUSES.has(decoded.status)) {
    fail("decoded.status is invalid");
  }
  if ((decoded.status === NAME_STATUS.TEXT || decoded.status === NAME_STATUS.REDACTED) &&
      typeof decoded.text !== "string") {
    fail("decoded.text is required for text and redacted statuses");
  }
  return event;
}

function compareEvents(left, right) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }
  const leftHasTransactionIndex = left.transactionIndex !== undefined;
  const rightHasTransactionIndex = right.transactionIndex !== undefined;
  if (leftHasTransactionIndex && rightHasTransactionIndex &&
      left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  if (leftHasTransactionIndex !== rightHasTransactionIndex) {
    return leftHasTransactionIndex ? -1 : 1;
  }
  if (left.logIndex !== right.logIndex) {
    return left.logIndex - right.logIndex;
  }
  return left.eventId.localeCompare(right.eventId);
}

function mergeIntoMap(byEventId, events) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  for (const event of events) {
    validateEvent(event);
    const existing = byEventId.get(event.eventId);
    if (existing) {
      const sameExceptTimestamp =
        JSON.stringify({ ...existing, blockTimestamp: undefined }) ===
        JSON.stringify({ ...event, blockTimestamp: undefined });
      const existingHasTimestamp = Object.hasOwn(existing, "blockTimestamp");
      const incomingHasTimestamp = Object.hasOwn(event, "blockTimestamp");
      if (sameExceptTimestamp && existingHasTimestamp !== incomingHasTimestamp) {
        byEventId.set(event.eventId, incomingHasTimestamp ? event : existing);
      } else if (JSON.stringify(existing) !== JSON.stringify(event)) {
        throw new EventStoreConflictError(event.eventId);
      }
    } else {
      byEventId.set(event.eventId, event);
    }
  }
}

/** Merge exact duplicates and return unique events in deterministic order. */
export function mergeEvents(existingEvents, incomingEvents) {
  const byEventId = new Map();
  mergeIntoMap(byEventId, existingEvents);
  mergeIntoMap(byEventId, incomingEvents);
  return [...byEventId.values()].sort(compareEvents);
}

/** Load a JSONL event store, returning [] only when the file is absent/empty. */
export async function loadEventsJsonl(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (contents === "") {
    return [];
  }
  const lines = contents.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.some((line) => line.trim() === "")) {
    throw new TypeError("event JSONL contains an empty record line");
  }
  const parsed = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new TypeError(`event JSONL line ${index + 1} is not valid JSON`);
    }
  });
  return mergeEvents([], parsed);
}

/** Atomically replace an event JSONL file with compact deterministic records. */
export async function saveEventsJsonl(filePath, events) {
  const sortedEvents = mergeEvents([], events);
  const serialized = sortedEvents.length === 0
    ? ""
    : `${sortedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
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
  return sortedEvents;
}
