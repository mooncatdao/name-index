import assert from "node:assert/strict";
import test from "node:test";

import { EventStoreConflictError } from "../src/event-store.js";
import { buildLiveNameArtifacts } from "../src/live-name-artifacts.js";
import { normalizeProvisionalEvent } from "../src/provisional-events.js";

const BLANK_RAW = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TEXT_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";

function inputEvent({
  id = "a",
  catId = "0x00d8523a53",
  transactionIndex = 0,
  nameRaw = BLANK_RAW
} = {}) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  return {
    eventId: `${transactionHash}:0`,
    transactionHash,
    logIndex: 0,
    blockNumber: 100,
    transactionIndex,
    catId,
    nameRaw,
    removed: false
  };
}

function reverseObject(value) {
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, entry]) => [
      key,
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? reverseObject(entry)
        : entry
    ])
  );
}

test("live overlay prefers finalized records for semantic pending overlaps", () => {
  const finalized = normalizeProvisionalEvent(inputEvent({ id: "a" }));
  const pending = reverseObject(normalizeProvisionalEvent(inputEvent({
    id: "a",
    transactionIndex: 4
  })));
  const artifacts = buildLiveNameArtifacts([finalized], [pending]);

  assert.equal(artifacts.metadata.finalizedEventCount, 1);
  assert.equal(artifacts.metadata.pendingEventCount, 0);
  assert.equal(artifacts.metadata.pendingBlankEventCount, 0);
  assert.equal(artifacts.metadata.pendingRemovedEventCount, 0);
  assert.equal(artifacts.metadata.pendingNamedCatCount, 0);
  assert.deepEqual(artifacts.currentNames, []);
  assert.equal(Object.hasOwn(artifacts.namesByCatId, finalized.catId), false);
});

test("live overlay rejects meaningful finalized and pending mismatches", () => {
  const finalized = normalizeProvisionalEvent(inputEvent({ id: "a" }));
  const pending = normalizeProvisionalEvent(inputEvent({
    id: "a",
    catId: "0x0069b659c0",
    transactionIndex: 4
  }));

  assert.throws(
    () => buildLiveNameArtifacts([finalized], [pending]),
    EventStoreConflictError
  );
});

test("live timestamp map preserves known timestamps and marks unknown provisional timestamps", () => {
  const finalized = normalizeProvisionalEvent(inputEvent({ id: "a", nameRaw: TEXT_RAW }));
  const provisional = normalizeProvisionalEvent(inputEvent({
    id: "b",
    catId: "0x0069b659c0",
    nameRaw: TEXT_RAW
  }));
  const withTimestamp = { ...finalized, blockTimestamp: 1_502_373_528 };
  const artifacts = buildLiveNameArtifacts([withTimestamp], [provisional]);

  assert.deepEqual(artifacts.namesSimple, { "6": "cat", "35": "cat" });
  assert.deepEqual(artifacts.namesTimestamp, {
    "6": { name: "cat", timestamp: 1_502_373_528 },
    "35": { name: "cat", timestamp: null }
  });
});
