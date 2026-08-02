import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EventStoreConflictError,
  loadEventsJsonl,
  mergeEvents,
  saveEventsJsonl
} from "../src/event-store.js";

const NAME_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const BASE_DECODED = { rawName: NAME_RAW, status: "text", text: "cat" };

function makeEvent({ id = "a", blockNumber = 10, logIndex = 0, transactionIndex = 0, text = "cat" } = {}) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  return {
    eventId: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber,
    transactionIndex,
    catId: "0x00d8523a53",
    nameRaw: NAME_RAW,
    removed: false,
    decoded: { ...BASE_DECODED, text }
  };
}

test("missing and empty JSONL stores load as empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-events-"));
  const filePath = path.join(directory, "events.jsonl");
  assert.deepEqual(await loadEventsJsonl(filePath), []);
  await writeFile(filePath, "", "utf8");
  assert.deepEqual(await loadEventsJsonl(filePath), []);
  await rm(directory, { recursive: true, force: true });
});

test("JSONL parsing sorts and collapses exact duplicates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-events-"));
  const filePath = path.join(directory, "events.jsonl");
  const first = makeEvent({ id: "a", blockNumber: 12 });
  const second = makeEvent({ id: "b", blockNumber: 11 });
  await writeFile(filePath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n${JSON.stringify(first)}\n`, "utf8");
  const events = await loadEventsJsonl(filePath);
  assert.deepEqual(events, [second, first]);
  await rm(directory, { recursive: true, force: true });
});

test("merge rejects malformed and conflicting records", () => {
  const event = makeEvent();
  assert.throws(() => mergeEvents([], [{ ...event, removed: "false" }]), TypeError);
  assert.throws(() => mergeEvents([event], [{ ...event, decoded: { ...event.decoded, text: "dog" } }]), EventStoreConflictError);
  assert.throws(() => mergeEvents([], [{ ...event, eventId: "wrong" }]), TypeError);
});

test("atomic save round-trip writes compact JSONL with trailing newline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-events-"));
  const filePath = path.join(directory, "nested", "events.jsonl");
  const events = [makeEvent({ id: "b", blockNumber: 11 }), makeEvent({ id: "a", blockNumber: 10 })];
  await saveEventsJsonl(filePath, events);
  const contents = await readFile(filePath, "utf8");
  assert.equal(contents.endsWith("\n"), true);
  assert.equal(contents.includes("  "), false);
  assert.deepEqual(await loadEventsJsonl(filePath), [events[1], events[0]]);
  await saveEventsJsonl(filePath, []);
  assert.equal(await readFile(filePath, "utf8"), "");
  await rm(directory, { recursive: true, force: true });
});

test("optional transactionIndex may be absent from normalized events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-events-"));
  const filePath = path.join(directory, "events.jsonl");
  const event = makeEvent();
  delete event.transactionIndex;
  await saveEventsJsonl(filePath, [event]);
  const loaded = await loadEventsJsonl(filePath);
  assert.deepEqual(loaded, [event]);
  await rm(directory, { recursive: true, force: true });
});

test("timestamp enrichment merges a missing optional timestamp without conflict", () => {
  const event = makeEvent();
  const enriched = { ...event, blockTimestamp: 1_502_373_528 };
  assert.deepEqual(mergeEvents([event], [enriched]), [enriched]);
  assert.throws(
    () => mergeEvents([enriched], [{ ...enriched, blockTimestamp: 1_502_373_529 }]),
    EventStoreConflictError
  );
});

test("timestamp and namer enrichment merge independently and conflicts are loud", () => {
  const event = makeEvent();
  const namer = "0x4bE972E5799b243180b2FC76468a1C8503281449";
  const withTimestamp = { ...event, blockTimestamp: 1_502_373_528 };
  const enriched = { ...event, namer };
  assert.deepEqual(mergeEvents([withTimestamp], [enriched]), [{
    ...event,
    blockTimestamp: 1_502_373_528,
    namer
  }]);
  assert.throws(
    () => mergeEvents([enriched], [{ ...enriched, namer: "0x61Fae4F63C5B0316F658B11319141C5755F833c8" }]),
    EventStoreConflictError
  );
});
