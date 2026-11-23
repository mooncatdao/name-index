import assert from "node:assert/strict";
import test from "node:test";

import { EventStoreConflictError } from "../src/event-store.js";
import {
  buildRecentNamings,
  serializeRecentNamings
} from "../src/recent-namings.js";

const NAME_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const BLANK_RAW = `0x${"0".repeat(64)}`;
const LEADING_NULL_RAW = `0x00${"61".repeat(31)}`;
const NAMER = "0x4bE972E5799b243180b2FC76468a1C8503281449";

function event({
  id,
  blockNumber,
  transactionIndex = 0,
  catId = "0x00d8523a53",
  status = "text",
  text = "cat",
  blockTimestamp,
  namer,
  removed = false
}) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  const nameRaw = {
    blank: BLANK_RAW,
    "leading-null": LEADING_NULL_RAW,
    "invalid-utf8": `0xc328${"00".repeat(30)}`
  }[status] ?? NAME_RAW;
  return {
    eventId: `${transactionHash}:0`,
    transactionHash,
    logIndex: 0,
    blockNumber,
    transactionIndex,
    catId,
    nameRaw,
    removed,
    decoded: {
      rawName: nameRaw,
      status,
      ...(status === "text" ? { text } : {}),
      ...(status === "redacted" ? { text: "�" } : {})
    },
    ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
    ...(namer === undefined ? {} : { namer })
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

test("recent namings deduplicate finalized overlaps and filter newest events", () => {
  const finalized = event({
    id: "a",
    blockNumber: 10,
    transactionIndex: 2,
    blockTimestamp: 1_500_000_000,
    namer: NAMER,
    text: "finalized"
  });
  const { blockTimestamp, namer, ...pendingOverlapFields } = {
    ...finalized,
    transactionIndex: 99
  };
  const pendingOverlap = reverseObject(pendingOverlapFields);
  const pending = event({
    id: "b",
    blockNumber: 11,
    transactionIndex: 1,
    blockTimestamp: undefined,
    namer: undefined,
    text: "provisional"
  });
  const invalid = event({
    id: "1", blockNumber: 14, catId: "0x00377aeabf", status: "invalid-utf8"
  });
  const leadingNull = event({ id: "e", blockNumber: 13, status: "leading-null" });
  const redacted = event({
    id: "2", blockNumber: 8, catId: "0x0008d4ecd0", status: "redacted"
  });
  const records = buildRecentNamings(
    [finalized, invalid, redacted, event({ id: "c", blockNumber: 15, status: "blank" })],
    [pendingOverlap, pending, leadingNull, event({ id: "d", blockNumber: 12, removed: true })]
  );

  assert.deepEqual(records.map(({ event: value }) => value.eventId), [
    invalid.eventId,
    leadingNull.eventId,
    pending.eventId,
    finalized.eventId,
    redacted.eventId
  ]);
  assert.deepEqual(records.map(({ provisional }) => provisional), [false, true, true, false, false]);

  const output = serializeRecentNamings(records);
  assert.match(output, /\| &#91;invalid UTF-8&#93; \| CatID 0x00377aeabf · rescue order 20069 \|/);
  assert.match(output, /\| &#91;leading null&#93; \|/);
  assert.match(output, /\| finalized \|/);
  assert.match(output, /\| � \|/);
  assert.match(output, /\| Provisional \|/);
  assert.match(output, /\| Finalized \|/);
  assert.match(output, /https:\/\/etherscan\.io\/tx\//);
  assert.match(output, /https:\/\/etherscan\.io\/address\//);
  assert.doesNotMatch(output, new RegExp(NAME_RAW));
  assert.equal(output.split("\n").filter((line) => line.startsWith("| ")).length, 7);
});

test("recent namings keep the newest 100 events by default", () => {
  const events = Array.from({ length: 105 }, (_, index) =>
    event({ id: index.toString(16).padStart(2, "0"), blockNumber: index + 1 })
  );
  const records = buildRecentNamings(events, []);
  assert.deepEqual(
    records.map(({ event }) => event.blockNumber),
    Array.from({ length: 100 }, (_, index) => 105 - index)
  );
});

test("recent namings render on-chain names as literal table text", () => {
  const suspiciousName = "<img src=x> [click](https://example.com) **bold** _italics_ `code` ~strike~ | slash\\";
  const records = buildRecentNamings([
    event({ id: "f", blockNumber: 20, text: suspiciousName })
  ], []);

  const output = serializeRecentNamings(records);
  assert.match(output, /&lt;img src=x&gt;/);
  assert.match(output, /&#91;click&#93;\(https:\/\/example\.com\)/);
  assert.match(output, /&#42;&#42;bold&#42;&#42;/);
  assert.match(output, /&#95;italics&#95;/);
  assert.match(output, /&#96;code&#96;/);
  assert.match(output, /&#126;strike&#126;/);
  assert.match(output, /&#124;/);
  assert.match(output, /slash&#92;/);
  assert.doesNotMatch(output, /<img src=x>/);
  assert.doesNotMatch(output, /\[click\]\(https:\/\/example\.com\)/);
});

test("recent namings rejects meaningful finalized overlap mismatches", () => {
  const finalized = event({ id: "a", blockNumber: 10 });
  const pending = {
    ...event({ id: "a", blockNumber: 10, transactionIndex: 8 }),
    catId: "0x0069b659c0"
  };
  assert.throws(
    () => buildRecentNamings([finalized], [pending]),
    EventStoreConflictError
  );
});
