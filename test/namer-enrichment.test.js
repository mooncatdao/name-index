import assert from "node:assert/strict";
import test from "node:test";

import { enrichEventsWithNamers, normalizeNamer } from "../src/namer-enrichment.js";

const RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const NAMER = "0x4bE972E5799b243180b2FC76468a1C8503281449";

function event({ id, logIndex = 0, status = "text", namer } = {}) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  const decoded = status === "blank"
    ? { rawName: `0x${"0".repeat(64)}`, status: "blank" }
    : { rawName: RAW, status: "text", text: "cat" };
  return {
    eventId: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber: 10,
    transactionIndex: 0,
    catId: id === "a" ? "0x00d8523a53" : "0x0069b659c0",
    nameRaw: decoded.rawName,
    removed: false,
    decoded,
    ...(namer === undefined ? {} : { namer })
  };
}

test("deduplicates transaction lookups and normalizes sender addresses", async () => {
  const calls = [];
  const result = await enrichEventsWithNamers({
    async getTransaction(request) {
      calls.push(request);
      return { from: NAMER.toLowerCase() };
    }
  }, [event({ id: "a" }), event({ id: "a", logIndex: 1 }), event({ id: "b", status: "blank" })]);

  assert.deepEqual(calls, [{ hash: event({ id: "a" }).transactionHash }]);
  assert.equal(result.events.find((item) => item.logIndex === 0 && item.transactionHash.endsWith("a".repeat(64))).namer, NAMER);
  assert.equal(result.events.find((item) => item.logIndex === 1).namer, NAMER);
  assert.equal(result.events.find((item) => item.transactionHash.endsWith("b".repeat(64))).namer, undefined);
  assert.equal(result.fetchedTransactionCount, 1);
  assert.equal(result.enrichedTransactionCount, 1);
  assert.equal(result.enrichedEventCount, 2);
  assert.equal(result.remainingTransactionCount, 0);
});

test("maxTransactions makes historical enrichment resumable", async () => {
  const calls = [];
  const client = {
    async getTransaction({ hash }) {
      calls.push(hash);
      return { from: NAMER };
    }
  };
  const events = [event({ id: "a" }), event({ id: "b" })];
  const first = await enrichEventsWithNamers(client, events, { maxTransactions: 1 });
  assert.equal(first.enrichedEventCount, 1);
  assert.equal(first.remainingTransactionCount, 1);
  const second = await enrichEventsWithNamers(client, first.events);
  assert.equal(second.enrichedEventCount, 1);
  assert.equal(second.remainingTransactionCount, 0);
  assert.equal(calls.length, 2);
});

test("existing namers are reused and malformed or conflicting values fail", async () => {
  let calls = 0;
  const result = await enrichEventsWithNamers({
    async getTransaction() {
      calls += 1;
      return { from: NAMER };
    }
  }, [event({ id: "a", namer: NAMER })]);
  assert.equal(calls, 0);
  assert.equal(result.enrichedEventCount, 0);
  assert.equal(normalizeNamer(NAMER.toLowerCase()), NAMER);
  assert.throws(() => normalizeNamer("0x1234"), TypeError);
  await assert.rejects(
    enrichEventsWithNamers({
      async getTransaction() {
        return { from: NAMER };
      }
    }, [event({ id: "a", namer: NAMER }), event({ id: "a", logIndex: 1, namer: "0x61Fae4F63C5B0316F658B11319141C5755F833c8" })]),
    /conflicting namers/
  );
});
