import assert from "node:assert/strict";
import test from "node:test";

import { createInitialCheckpoint } from "../src/checkpoint.js";
import { runPersistentScan } from "../src/persistent-scanner.js";

const EVENT = {
  eventId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0",
  transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 10,
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

function scanResult(checkpoint, events, proposedCheckpoint = checkpoint) {
  return {
    latestBlock: 100,
    finalizedBlock: 90,
    resumeBlock: 1,
    queriedFromBlock: 1,
    queriedToBlock: 90,
    eventCount: events.length,
    events,
    currentCheckpoint: { ...checkpoint },
    proposedCheckpoint: { ...proposedCheckpoint }
  };
}

function paths() {
  return { eventsPath: "/tmp/events.jsonl", checkpointPath: "/tmp/checkpoint.json" };
}

test("persists merged events before advancing the checkpoint", async () => {
  const checkpoint = createInitialCheckpoint();
  const advanced = createInitialCheckpoint({ lastScannedBlock: 4_140_500, lastFinalizedBlock: 4_140_500 });
  const calls = [];
  const result = await runPersistentScan({}, checkpoint, paths(), {
    dependencies: {
      runDryRunScan: async () => scanResult(checkpoint, [EVENT], advanced),
      loadEventsJsonl: async () => [],
      saveEventsJsonl: async (_path, events) => calls.push(["events", events]),
      saveCheckpoint: async (_path, saved) => calls.push(["checkpoint", saved])
    }
  });
  assert.deepEqual(calls.map(([name]) => name), ["events", "checkpoint"]);
  assert.equal(result.eventsChanged, true);
  assert.equal(result.checkpointChanged, true);
  assert.equal(result.persistedEventCount, 1);
});

test("event persistence failure blocks checkpoint persistence", async () => {
  const checkpoint = createInitialCheckpoint();
  const advanced = createInitialCheckpoint({ lastScannedBlock: 4_140_500, lastFinalizedBlock: 4_140_500 });
  let checkpointCalls = 0;
  await assert.rejects(runPersistentScan({}, checkpoint, paths(), {
    dependencies: {
      runDryRunScan: async () => scanResult(checkpoint, [EVENT], advanced),
      loadEventsJsonl: async () => [],
      saveEventsJsonl: async () => { throw new Error("disk full"); },
      saveCheckpoint: async () => { checkpointCalls += 1; }
    }
  }), /disk full/);
  assert.equal(checkpointCalls, 0);
});

test("checkpoint failure leaves durable events and is recoverable", async () => {
  const checkpoint = createInitialCheckpoint();
  const advanced = createInitialCheckpoint({ lastScannedBlock: 4_140_500, lastFinalizedBlock: 4_140_500 });
  let durableEvents = [];
  await assert.rejects(runPersistentScan({}, checkpoint, paths(), {
    dependencies: {
      runDryRunScan: async () => scanResult(checkpoint, [EVENT], advanced),
      loadEventsJsonl: async () => durableEvents,
      saveEventsJsonl: async (_path, events) => { durableEvents = events; },
      saveCheckpoint: async () => { throw new Error("checkpoint unavailable"); }
    }
  }), /checkpoint unavailable/);
  assert.deepEqual(durableEvents, [EVENT]);
});

test("overlap duplicate is idempotent and no-op avoids both writes", async () => {
  const checkpoint = createInitialCheckpoint();
  const calls = [];
  const dependencies = {
    runDryRunScan: async () => scanResult(checkpoint, [EVENT], checkpoint),
    loadEventsJsonl: async () => [EVENT],
    saveEventsJsonl: async () => calls.push("events"),
    saveCheckpoint: async () => calls.push("checkpoint")
  };
  const result = await runPersistentScan({}, checkpoint, paths(), { dependencies });
  assert.equal(result.eventsChanged, false);
  assert.equal(result.checkpointChanged, false);
  assert.deepEqual(calls, []);
});

test("idle scan with timestamp-only checkpoint change performs no writes", async () => {
  const checkpoint = createInitialCheckpoint();
  const proposed = { ...checkpoint, updatedAt: "2026-08-02T13:50:00.000Z" };
  const calls = [];
  const result = await runPersistentScan({}, checkpoint, paths(), {
    dependencies: {
      runDryRunScan: async () => scanResult(checkpoint, [], proposed),
      loadEventsJsonl: async () => [],
      saveEventsJsonl: async () => calls.push("events"),
      saveCheckpoint: async () => calls.push("checkpoint")
    }
  });
  assert.equal(result.checkpointChanged, false);
  assert.equal(result.checkpointAdvanced, false);
  assert.deepEqual(calls, []);
});

test("zero-event checkpoint advancement saves only the checkpoint", async () => {
  const checkpoint = createInitialCheckpoint();
  const advanced = createInitialCheckpoint({ lastScannedBlock: 4_140_500, lastFinalizedBlock: 4_140_500 });
  const calls = [];
  await runPersistentScan({}, checkpoint, paths(), {
    dependencies: {
      runDryRunScan: async () => scanResult(checkpoint, [], advanced),
      loadEventsJsonl: async () => [],
      saveEventsJsonl: async () => calls.push("events"),
      saveCheckpoint: async () => calls.push("checkpoint")
    }
  });
  assert.deepEqual(calls, ["checkpoint"]);
});
