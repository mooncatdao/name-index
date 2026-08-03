import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EventStoreConflictError } from "../src/event-store.js";
import { buildLiveNameArtifacts } from "../src/live-name-artifacts.js";
import {
  createPendingStore,
  loadPendingStore,
  normalizeProvisionalEvent,
  pendingEventsFromStore,
  reconcilePendingEvents,
  savePendingStore,
  upsertPendingEvent
} from "../src/provisional-events.js";

const NAME_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const BLANK_RAW = "0x0000000000000000000000000000000000000000000000000000000000000000";

function inputEvent({
  id = "a",
  catId = "0x00d8523a53",
  blockNumber = 100,
  logIndex = 0,
  nameRaw = NAME_RAW,
  removed = false
} = {}) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  return {
    eventId: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber,
    transactionIndex: 0,
    catId,
    nameRaw,
    removed
  };
}

test("pending storage is independently decoded, keyed, sorted, and idempotent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-pending-"));
  const filePath = path.join(directory, "pending-events.json");
  const first = normalizeProvisionalEvent(inputEvent({ id: "b" }));
  const second = normalizeProvisionalEvent(inputEvent({ id: "a", logIndex: 1 }));
  let store = createPendingStore([first, second]);
  assert.deepEqual(Object.keys(store.events), [second.eventId, first.eventId].sort());
  assert.equal(store.status, "provisional");
  assert.equal(store.events[first.eventId].status, "provisional");
  await savePendingStore(filePath, store);
  const bytes = await readFile(filePath, "utf8");
  assert.equal(bytes, `${JSON.stringify(store, null, 2)}\n`);
  store = await loadPendingStore(filePath);
  const duplicate = upsertPendingEvent(store, first);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.action, "duplicate");
  const removed = upsertPendingEvent(store, { ...first, removed: true });
  assert.equal(removed.changed, true);
  assert.equal(pendingEventsFromStore(removed.store).length, 1);
  await rm(directory, { recursive: true, force: true });
});

test("reconciliation promotes canonical matches, retains newer events, and drops orphans", () => {
  const promoted = normalizeProvisionalEvent(inputEvent({ id: "a", blockNumber: 10 }));
  const retained = normalizeProvisionalEvent(inputEvent({ id: "b", blockNumber: 101, catId: "0x0069b659c0" }));
  const orphaned = normalizeProvisionalEvent(inputEvent({ id: "c", blockNumber: 100, catId: "0x00b7c50d8a" }));
  const result = reconcilePendingEvents(
    [promoted, retained, orphaned],
    [{ ...promoted, blockTimestamp: 1_502_373_528 }],
    100
  );
  assert.deepEqual(result.promoted.map((event) => event.eventId), [promoted.eventId]);
  assert.deepEqual(result.orphaned.map((event) => event.eventId), [orphaned.eventId]);
  assert.deepEqual(result.retained.map((event) => event.eventId), [retained.eventId]);
  assert.deepEqual(pendingEventsFromStore(result.store), [retained]);
});

test("reconciliation tolerates RPC enrichment and removes canonical tombstones safely", () => {
  const pending = normalizeProvisionalEvent(inputEvent({ id: "a" }));
  delete pending.transactionIndex;
  const tombstone = normalizeProvisionalEvent(inputEvent({ id: "b", removed: true }));
  const canonical = { ...pending, transactionIndex: 4, blockTimestamp: 1_502_373_528 };
  const result = reconcilePendingEvents([pending, tombstone], [canonical], 100);
  assert.deepEqual(result.promoted.map((event) => event.eventId), [pending.eventId]);
  assert.deepEqual(result.removed.map((event) => event.eventId), [tombstone.eventId]);
  assert.deepEqual(result.retained, []);
});

test("reconciliation promotes matching events when transaction indexes differ", () => {
  const pending = normalizeProvisionalEvent(inputEvent({ id: "a" }));
  const canonical = { ...pending, transactionIndex: 4, blockTimestamp: 1_502_373_528 };
  const result = reconcilePendingEvents([pending], [canonical], 100);
  assert.deepEqual(result.promoted, [pending]);
  assert.deepEqual(result.retained, []);
  assert.deepEqual(pendingEventsFromStore(result.store), []);
  assert.equal(canonical.transactionIndex, 4);
});

test("reconciliation still rejects meaningful mismatches", () => {
  const pending = normalizeProvisionalEvent(inputEvent({ id: "a" }));
  const canonical = {
    ...pending,
    transactionIndex: 4,
    catId: "0x0069b659c0"
  };
  assert.throws(
    () => reconcilePendingEvents([pending], [canonical], 100),
    EventStoreConflictError
  );
});

test("live artifacts overlay provisional names and expose blank pending status", () => {
  const finalized = [normalizeProvisionalEvent(inputEvent({ id: "a", blockNumber: 10 }))];
  const pendingName = normalizeProvisionalEvent(inputEvent({
    id: "b",
    blockNumber: 101,
    catId: "0x0069b659c0",
    nameRaw: "0x646f670000000000000000000000000000000000000000000000000000000000"
  }));
  const pendingBlank = normalizeProvisionalEvent(inputEvent({
    id: "c",
    blockNumber: 102,
    catId: "0x00b7c50d8a",
    nameRaw: BLANK_RAW
  }));
  const artifacts = buildLiveNameArtifacts(finalized, [pendingName, pendingBlank]);
  assert.equal(artifacts.metadata.artifactType, "live");
  assert.equal(artifacts.metadata.finalizedEventCount, 1);
  assert.equal(artifacts.metadata.pendingEventCount, 2);
  assert.equal(artifacts.metadata.pendingBlankEventCount, 1);
  assert.equal(artifacts.metadata.pendingNamedCatCount, 1);
  assert.equal(artifacts.namesByCatId[pendingName.catId].provisional, true);
  assert.equal(artifacts.namesByCatId[pendingName.catId].text, "dog");
  assert.equal(Object.hasOwn(artifacts.namesByCatId, pendingBlank.catId), false);
  assert.equal(artifacts.namesSimple["35"], "dog");
});
