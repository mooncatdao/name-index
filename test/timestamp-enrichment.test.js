import assert from "node:assert/strict";
import test from "node:test";

import { enrichEventsWithBlockTimestamps, namedYearFromTimestamp } from "../src/timestamp-enrichment.js";

const RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";

function event(id, blockNumber, status = "text") {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  return {
    eventId: `${transactionHash}:0`,
    transactionHash,
    logIndex: 0,
    blockNumber,
    transactionIndex: 0,
    catId: id === "a" ? "0x00d8523a53" : "0x0069b659c0",
    nameRaw: status === "blank" ? `0x${"0".repeat(64)}` : RAW,
    removed: false,
    decoded: status === "blank"
      ? { rawName: `0x${"0".repeat(64)}`, status: "blank" }
      : { rawName: RAW, status: "text", text: "cat" }
  };
}

test("deduplicates block timestamp reads and derives UTC named years", async () => {
  const calls = [];
  const result = await enrichEventsWithBlockTimestamps({
    async getBlock(request) {
      calls.push(request);
      return { timestamp: 1_702_944_000n };
    }
  }, [event("a", 10), event("b", 10), event("c", 11, "blank")]);

  assert.deepEqual(calls, [{ blockNumber: 10n }]);
  assert.deepEqual(result.events.map((item) => item.blockTimestamp), [1_702_944_000, 1_702_944_000, undefined]);
  assert.equal(result.fetchedBlockCount, 1);
  assert.equal(result.enrichedEventCount, 2);
  assert.equal(result.remainingBlockCount, 0);
  assert.equal(namedYearFromTimestamp(1_702_944_000), 2023);
});

test("maxBlocks makes historical enrichment resumable", async () => {
  const calls = [];
  const client = {
    async getBlock({ blockNumber }) {
      calls.push(blockNumber);
      return { timestamp: 1_502_373_528n + blockNumber };
    }
  };
  const events = [event("a", 10), event("b", 11)];
  const first = await enrichEventsWithBlockTimestamps(client, events, { maxBlocks: 1 });
  assert.deepEqual(calls, [10n]);
  assert.equal(first.enrichedEventCount, 1);
  assert.equal(first.remainingBlockCount, 1);

  const second = await enrichEventsWithBlockTimestamps(client, first.events);
  assert.deepEqual(calls, [10n, 11n]);
  assert.equal(second.enrichedEventCount, 1);
  assert.equal(second.remainingBlockCount, 0);
});

test("existing timestamps are not fetched again", async () => {
  let calls = 0;
  const result = await enrichEventsWithBlockTimestamps({
    async getBlock() {
      calls += 1;
      return { timestamp: 1_502_373_528n };
    }
  }, [{ ...event("a", 10), blockTimestamp: 1_502_373_528 }]);
  assert.equal(calls, 0);
  assert.equal(result.enrichedEventCount, 0);
  assert.equal(result.remainingBlockCount, 0);
});
