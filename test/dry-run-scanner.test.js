import assert from "node:assert/strict";
import test from "node:test";

import { createInitialCheckpoint } from "../src/checkpoint.js";
import { runDryRunScan } from "../src/dry-run-scanner.js";

const NAME_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const CAT_ID = "0x00d8523a53";

function makeLog() {
  return {
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0n,
    blockNumber: 4_140_500n,
    transactionIndex: 0n,
    args: { catId: CAT_ID, catName: NAME_RAW }
  };
}

test("initial checkpoint before the finalized range is a getLogs-free no-op", async () => {
  let blockCalls = 0;
  let logCalls = 0;
  const checkpoint = createInitialCheckpoint();
  const result = await runDryRunScan({
    async getBlockNumber() {
      blockCalls += 1;
      return 4_140_408n;
    },
    async getLogs() {
      logCalls += 1;
      return [];
    }
  }, checkpoint);

  assert.equal(blockCalls, 1);
  assert.equal(logCalls, 0);
  assert.equal(result.latestBlock, 4_140_408);
  assert.equal(result.finalizedBlock, 4_140_408);
  assert.equal(result.resumeBlock, 4_140_409);
  assert.equal(result.eventCount, 0);
  assert.deepEqual(result.events, []);
  assert.equal(result.proposedCheckpoint.lastScannedBlock, 4_140_408);
  assert.equal(result.proposedCheckpoint.lastFinalizedBlock, 4_140_408);
});

test("work scan applies overlap, uses bigint fetch bounds, and proposes progress", async () => {
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_140_550,
    lastFinalizedBlock: 4_140_486,
    overlapBlocks: 100,
    chunkSize: 1_000
  });
  const calls = { block: 0, logs: [] };
  const before = JSON.parse(JSON.stringify(checkpoint));
  const result = await runDryRunScan({
    async getBlockNumber() {
      calls.block += 1;
      return 4_140_664n;
    },
    async getLogs(request) {
      calls.logs.push(request);
      return [makeLog()];
    }
  }, checkpoint, { updatedAt: "2026-08-02T13:30:00.000Z" });

  assert.equal(calls.block, 1);
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].fromBlock, 4_140_451n);
  assert.equal(calls.logs[0].toBlock, 4_140_600n);
  assert.equal(result.latestBlock, 4_140_664);
  assert.equal(result.finalizedBlock, 4_140_600);
  assert.equal(result.resumeBlock, 4_140_451);
  assert.equal(result.queriedFromBlock, 4_140_451);
  assert.equal(result.queriedToBlock, 4_140_600);
  assert.equal(result.eventCount, 1);
  assert.equal(result.events[0].decoded.text, "cat");
  assert.equal(result.proposedCheckpoint.lastScannedBlock, 4_140_600);
  assert.equal(result.proposedCheckpoint.lastFinalizedBlock, 4_140_600);
  assert.equal(result.proposedCheckpoint.updatedAt, "2026-08-02T13:30:00.000Z");
  assert.deepEqual(checkpoint, before);
  assert.notEqual(result.currentCheckpoint, checkpoint);
  assert.notEqual(result.proposedCheckpoint, checkpoint);
});

test("default proposed timestamp preserves checkpoint value and unsafe latest blocks reject", async () => {
  const checkpoint = createInitialCheckpoint({ updatedAt: null });
  let logCalls = 0;
  const client = {
    async getBlockNumber() {
      return BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    },
    async getLogs() {
      logCalls += 1;
      return [];
    }
  };
  await assert.rejects(runDryRunScan(client, checkpoint), RangeError);
  assert.equal(logCalls, 0);

  const noOp = await runDryRunScan({
    async getBlockNumber() {
      return 0n;
    },
    async getLogs() {
      return [];
    }
  }, checkpoint);
  assert.equal(noOp.proposedCheckpoint.updatedAt, null);
});

test("lagging RPC never rewinds an existing checkpoint and makes no log call", async () => {
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_141_000,
    lastFinalizedBlock: 4_140_900
  });
  const before = JSON.parse(JSON.stringify(checkpoint));
  let logCalls = 0;
  const result = await runDryRunScan({
    async getBlockNumber() {
      return 4_140_800n;
    },
    async getLogs() {
      logCalls += 1;
      return [];
    }
  }, checkpoint);

  assert.equal(result.finalizedBlock, 4_140_736);
  assert.equal(result.resumeBlock, 4_140_901);
  assert.equal(logCalls, 0);
  assert.equal(result.proposedCheckpoint.lastScannedBlock, 4_141_000);
  assert.equal(result.proposedCheckpoint.lastFinalizedBlock, 4_140_900);
  assert.deepEqual(checkpoint, before);
});

test("scanner rejects clients without getBlockNumber", async () => {
  await assert.rejects(
    runDryRunScan({}, createInitialCheckpoint()),
    TypeError
  );
});
