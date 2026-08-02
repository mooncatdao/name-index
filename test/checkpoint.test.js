import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHECKPOINT_SCHEMA_VERSION,
  DEFAULT_CHECKPOINT,
  calculateFinalizedBlock,
  calculateResumeBlock,
  createInitialCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  validateCheckpoint
} from "../src/checkpoint.js";

test("initial checkpoint uses deterministic scanner defaults", () => {
  const checkpoint = createInitialCheckpoint();
  assert.deepEqual(checkpoint, {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    chainId: 1,
    contractAddress: "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6",
    startBlock: 4_140_409,
    lastScannedBlock: 4_140_408,
    lastFinalizedBlock: 4_140_408,
    confirmations: 64,
    overlapBlocks: 100,
    chunkSize: 10_000,
    updatedAt: null
  });
  assert.deepEqual(checkpoint, DEFAULT_CHECKPOINT);
});

test("missing checkpoint falls back while malformed files reject", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-checkpoint-"));
  const missingPath = path.join(directory, "missing.json");
  assert.deepEqual(await loadCheckpoint(missingPath), createInitialCheckpoint());

  const malformedPath = path.join(directory, "malformed.json");
  await saveCheckpoint(malformedPath, createInitialCheckpoint());
  await (await import("node:fs/promises")).writeFile(malformedPath, "{not json", "utf8");
  await assert.rejects(loadCheckpoint(malformedPath), {
    name: "CheckpointValidationError",
    message: "checkpoint file is not valid JSON"
  });
  await rm(directory, { recursive: true, force: true });
});

test("overlap resume and finalized boundary calculations are clamped", () => {
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_140_550,
    lastFinalizedBlock: 4_140_486,
    overlapBlocks: 100,
    confirmations: 64
  });
  assert.equal(calculateResumeBlock(checkpoint), 4_140_451);
  assert.equal(calculateFinalizedBlock(4_140_500, checkpoint), 4_140_436);
  assert.equal(calculateFinalizedBlock(4_140_400, checkpoint), 4_140_408);
  assert.equal(
    calculateResumeBlock(createInitialCheckpoint({ overlapBlocks: 10_000_000 })),
    4_140_409
  );
});

test("save and load round-trip atomically with explicit timestamp", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-checkpoint-"));
  const filePath = path.join(directory, "nested", "checkpoint.json");
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_150_000,
    lastFinalizedBlock: 4_149_936
  });
  const saved = await saveCheckpoint(filePath, checkpoint, {
    updatedAt: "2026-08-02T13:00:00.000Z"
  });
  assert.equal(saved.updatedAt, "2026-08-02T13:00:00.000Z");
  assert.deepEqual(await loadCheckpoint(filePath), saved);
  assert.equal((await readdir(path.dirname(filePath))).length, 1);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), saved);
  await rm(directory, { recursive: true, force: true });
});

test("schema, chain, contract, and block invariants reject invalid state", () => {
  const invalidCases = [
    ["schemaVersion", 2],
    ["chainId", 5],
    ["contractAddress", "0x0000000000000000000000000000000000000000"],
    ["lastScannedBlock", 4_140_407],
    ["lastFinalizedBlock", 4_140_407],
    ["lastFinalizedBlock", 4_140_500],
    ["confirmations", -1],
    ["overlapBlocks", -1],
    ["chunkSize", 0],
    ["updatedAt", "not-a-timestamp"]
  ];
  for (const [field, value] of invalidCases) {
    const checkpoint = { ...createInitialCheckpoint(), [field]: value };
    assert.throws(() => validateCheckpoint(checkpoint), {
      name: "CheckpointValidationError"
    });
  }
  assert.throws(
    () => validateCheckpoint({ ...createInitialCheckpoint(), extra: true }),
    { name: "CheckpointValidationError" }
  );
  assert.throws(
    () => calculateFinalizedBlock(4_140_409n, createInitialCheckpoint()),
    { name: "CheckpointValidationError" }
  );
});
