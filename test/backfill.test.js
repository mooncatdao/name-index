import assert from "node:assert/strict";
import test from "node:test";

import { createInitialCheckpoint } from "../src/checkpoint.js";
import { runBackfillBatch } from "../src/backfill.js";

const EVENT = {
  eventId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0",
  transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 4_140_450,
  transactionIndex: 0,
  catId: "0x00d8523a53",
  nameRaw: "0x6361740000000000000000000000000000000000000000000000000000000000",
  removed: false,
  decoded: {
    rawName: "0x6361740000000000000000000000000000000000000000000000000000000000",
    status: "text",
    text: "cat"
  }
};

function paths() {
  return {
    eventsPath: "/tmp/backfill-events.jsonl",
    eventsSource: "data/events.jsonl",
    checkpointPath: "/tmp/backfill-checkpoint.json",
    currentNamesPath: "/tmp/backfill-current-names.json",
    namesByCatIdPath: "/tmp/backfill-by-cat.json",
    namesByRescueOrderPath: "/tmp/backfill-by-rescue.json",
    metadataPath: "/tmp/backfill-metadata.json",
    namesSimplePath: "/tmp/backfill-names-simple.json",
    namesTimestampPath: "/tmp/backfill-names-timestamp.json"
  };
}

function dependencies({ latestBlock, existingEvents = [], calls, fetchEvents = [EVENT] }) {
  return {
    getBlockNumber: async () => latestBlock,
    fetchCatNamedLogs: async (_client, range) => {
      calls.push(["fetch", range]);
      return fetchEvents;
    },
    loadEventsJsonl: async () => existingEvents,
    saveEventsJsonl: async (_path, events) => calls.push(["events", events]),
    saveCurrentNameArtifacts: async (events) => calls.push(["artifacts", events]),
    saveCheckpoint: async (_path, checkpoint) => calls.push(["checkpoint", checkpoint])
  };
}

test("initial backfill starts at the naming block and is bounded independently of chunk size", async () => {
  const checkpoint = createInitialCheckpoint({ chunkSize: 10_000 });
  const calls = [];
  const result = await runBackfillBatch({}, checkpoint, paths(), {
    maxBlocks: 100,
    dependencies: dependencies({ latestBlock: 4_140_600, calls })
  });

  assert.deepEqual(calls[0], ["fetch", {
    fromBlock: 4_140_409n,
    toBlock: 4_140_508n,
    chunkSize: 10_000n
  }]);
  assert.deepEqual(calls.map(([name]) => name), ["fetch", "events", "artifacts", "checkpoint"]);
  assert.equal(result.batchFromBlock, 4_140_409);
  assert.equal(result.batchToBlock, 4_140_508);
  assert.equal(result.finalizedBlock, 4_140_536);
  assert.equal(result.scannedBlockCount, 100);
  assert.equal(result.eventCount, 1);
  assert.equal(result.checkpointAdvanced, true);
  assert.equal(result.complete, false);
  assert.equal(result.nextResumeBlock, 4_140_409);
});

test("resumes from the existing overlap and never scans beyond finalized", async () => {
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_140_550,
    lastFinalizedBlock: 4_140_486,
    overlapBlocks: 100,
    chunkSize: 1_000
  });
  const calls = [];
  const result = await runBackfillBatch({}, checkpoint, paths(), {
    maxBlocks: 500,
    dependencies: dependencies({ latestBlock: 4_140_664, calls, fetchEvents: [] })
  });

  assert.deepEqual(calls[0], ["fetch", {
    fromBlock: 4_140_451n,
    toBlock: 4_140_600n,
    chunkSize: 1_000n
  }]);
  assert.equal(result.batchFromBlock, 4_140_451);
  assert.equal(result.batchToBlock, 4_140_600);
  assert.equal(result.finalizedBlock, 4_140_600);
  assert.equal(result.scannedBlockCount, 150);
  assert.equal(result.complete, true);
});

test("no finalized work performs no durable writes", async () => {
  const checkpoint = createInitialCheckpoint();
  const calls = [];
  const result = await runBackfillBatch({}, checkpoint, paths(), {
    maxBlocks: 100,
    dependencies: dependencies({ latestBlock: 4_140_408, calls, fetchEvents: [] })
  });

  assert.deepEqual(calls, []);
  assert.equal(result.batchFromBlock, null);
  assert.equal(result.batchToBlock, null);
  assert.equal(result.scannedBlockCount, 0);
  assert.equal(result.eventCount, 0);
  assert.equal(result.checkpointAdvanced, false);
  assert.equal(result.complete, true);
  assert.equal(result.nextResumeBlock, 4_140_409);
});

test("retrying an already persisted overlap is idempotent", async () => {
  const checkpoint = createInitialCheckpoint({
    lastScannedBlock: 4_140_500,
    lastFinalizedBlock: 4_140_436,
    overlapBlocks: 100
  });
  const calls = [];
  const result = await runBackfillBatch({}, checkpoint, paths(), {
    maxBlocks: 100,
    dependencies: dependencies({
      latestBlock: 4_140_500,
      calls,
      existingEvents: [EVENT]
    })
  });

  assert.deepEqual(calls[0][0], "fetch");
  assert.deepEqual(calls.slice(1), []);
  assert.equal(result.eventsChanged, false);
  assert.equal(result.checkpointAdvanced, false);
});

test("max-block validation rejects unbounded or invalid batches", async () => {
  await assert.rejects(
    runBackfillBatch({}, createInitialCheckpoint(), paths(), { maxBlocks: 0 }),
    /maxBlocks must be a positive safe integer/
  );
  await assert.rejects(
    runBackfillBatch({}, createInitialCheckpoint(), paths(), { maxBlocks: 1.5 }),
    /maxBlocks must be a positive safe integer/
  );
});
