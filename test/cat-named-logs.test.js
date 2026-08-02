import assert from "node:assert/strict";
import test from "node:test";

import {
  CatNamedLogConflictError,
  createBlockRanges,
  createMoonCatPublicClient,
  fetchCatNamedLogs
} from "../src/cat-named-logs.js";
import {
  CAT_NAMED_EVENT,
  MOONCAT_RESCUE_ADDRESS
} from "../src/constants.js";

const CAT_ID = "0x00d8523a53";
const SECOND_CAT_ID = "0x0069b659c0";
const TEXT_NAME = "0x6361740000000000000000000000000000000000000000000000000000000000";
const SECOND_NAME = "0x646f670000000000000000000000000000000000000000000000000000000000";
const BLANK_NAME = "0x0000000000000000000000000000000000000000000000000000000000000000";

function makeLog({
  transactionHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex = 0n,
  blockNumber = 10n,
  transactionIndex,
  catId = CAT_ID,
  catName = TEXT_NAME,
  removed
} = {}) {
  return {
    transactionHash,
    logIndex,
    blockNumber,
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
    args: { catId, catName },
    ...(removed === undefined ? {} : { removed })
  };
}

function withoutField(log, field) {
  const copy = { ...log };
  delete copy[field];
  return copy;
}

test("creates exact inclusive bigint chunk ranges", () => {
  assert.deepEqual(createBlockRanges(10n, 25n, 10n), [
    { fromBlock: 10n, toBlock: 19n },
    { fromBlock: 20n, toBlock: 25n }
  ]);
  assert.deepEqual(createBlockRanges(4n, 4n, 1n), [
    { fromBlock: 4n, toBlock: 4n }
  ]);
  for (const args of [[10, 20n, 2n], [10n, 20n, 0n], [20n, 10n, 2n]]) {
    assert.throws(() => createBlockRanges(...args));
  }
});

test("validates RPC URLs without making a request", () => {
  assert.throws(() => createMoonCatPublicClient(""), TypeError);
  assert.throws(() => createMoonCatPublicClient("not a url"), TypeError);
  assert.throws(() => createMoonCatPublicClient("file:///tmp/rpc"), TypeError);
  const client = createMoonCatPublicClient("https://example.invalid/rpc");
  assert.equal(client.chain.id, 1);
});

test("fetches each range with expected viem arguments and normalizes sorted events", async () => {
  const calls = [];
  const logs = [
    makeLog({
      transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      logIndex: 1n,
      blockNumber: 12n,
      transactionIndex: 2n,
      catId: SECOND_CAT_ID,
      catName: SECOND_NAME,
      removed: true
    }),
    makeLog({
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      logIndex: 0n,
      blockNumber: 11n,
      transactionIndex: 1n,
      catName: BLANK_NAME
    })
  ];
  const client = {
    async getLogs(request) {
      calls.push(request);
      return calls.length === 1 ? [logs[0]] : [logs[1]];
    }
  };
  const events = await fetchCatNamedLogs(client, {
    fromBlock: 10n,
    toBlock: 19n,
    chunkSize: 5n
  });

  assert.deepEqual(calls.map(({ address, event, fromBlock, toBlock }) => ({
    address,
    event,
    fromBlock,
    toBlock
  })), [
    { address: MOONCAT_RESCUE_ADDRESS, event: CAT_NAMED_EVENT, fromBlock: 10n, toBlock: 14n },
    { address: MOONCAT_RESCUE_ADDRESS, event: CAT_NAMED_EVENT, fromBlock: 15n, toBlock: 19n }
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].decoded.status, "blank");
  assert.equal(events[0].nameRaw, BLANK_NAME);
  assert.equal(events[0].removed, false);
  assert.equal(events[1].decoded.text, "dog");
  assert.equal(events[1].removed, true);
  assert.deepEqual(events.map((event) => [event.blockNumber, event.transactionIndex, event.logIndex]), [
    [11, 1, 0],
    [12, 2, 1]
  ]);
});

test("empty ranges from the provider produce an empty event list", async () => {
  const client = { getLogs: async () => [] };
  assert.deepEqual(await fetchCatNamedLogs(client, {
    fromBlock: 1n,
    toBlock: 2n,
    chunkSize: 10n
  }), []);
});

test("enriches nonblank logs with one cached timestamp call per block", async () => {
  const calls = [];
  const logs = [
    makeLog({
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: 20n,
      logIndex: 0n,
      catId: CAT_ID
    }),
    makeLog({
      transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNumber: 20n,
      logIndex: 1n,
      catId: SECOND_CAT_ID,
      catName: SECOND_NAME
    })
  ];
  const client = {
    async getLogs() {
      return logs;
    },
    async getBlock(request) {
      calls.push(request);
      return { timestamp: 1_502_373_528n };
    }
  };
  const events = await fetchCatNamedLogs(client, {
    fromBlock: 20n,
    toBlock: 20n,
    chunkSize: 1n
  });
  assert.deepEqual(calls, [{ blockNumber: 20n }]);
  assert.deepEqual(events.map((event) => event.blockTimestamp), [1_502_373_528, 1_502_373_528]);
});

test("enriches shared-transaction logs with one normalized sender lookup", async () => {
  const calls = [];
  const logs = [
    makeLog({ logIndex: 0n, blockNumber: 20n }),
    makeLog({
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      logIndex: 1n,
      blockNumber: 20n,
      catId: SECOND_CAT_ID,
      catName: SECOND_NAME
    })
  ];
  const client = {
    async getLogs() {
      return logs;
    },
    async getTransaction(request) {
      calls.push(request);
      return { from: "0x4be972e5799b243180b2fc76468a1c8503281449" };
    }
  };
  const events = await fetchCatNamedLogs(client, {
    fromBlock: 20n,
    toBlock: 20n,
    chunkSize: 1n,
    enrichTimestamps: false
  });
  assert.deepEqual(calls, [{
    hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }]);
  assert.deepEqual(events.map((event) => event.namer), [
    "0x4bE972E5799b243180b2FC76468a1C8503281449",
    "0x4bE972E5799b243180b2FC76468a1C8503281449"
  ]);
});

test("deduplicates exact overlap logs and rejects conflicting duplicates", async () => {
  const duplicate = makeLog({ blockNumber: 20n });
  const client = {
    calls: 0,
    async getLogs() {
      this.calls += 1;
      return [duplicate];
    }
  };
  const events = await fetchCatNamedLogs(client, {
    fromBlock: 20n,
    toBlock: 21n,
    chunkSize: 1n
  });
  assert.equal(client.calls, 2);
  assert.equal(events.length, 1);

  const conflictingClient = {
    calls: 0,
    async getLogs() {
      this.calls += 1;
      return [makeLog({ catName: this.calls === 1 ? TEXT_NAME : SECOND_NAME })];
    }
  };
  await assert.rejects(
    fetchCatNamedLogs(conflictingClient, { fromBlock: 20n, toBlock: 21n, chunkSize: 1n }),
    CatNamedLogConflictError
  );
});

test("rejects malformed logs and unsafe numeric values", async () => {
  const malformedLogs = [
    withoutField(makeLog(), "transactionHash"),
    withoutField(makeLog(), "logIndex"),
    withoutField(makeLog(), "blockNumber"),
    { ...makeLog(), args: { catName: TEXT_NAME } },
    { ...makeLog(), args: { catId: CAT_ID } },
    makeLog({ blockNumber: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
    makeLog({ transactionIndex: BigInt(Number.MAX_SAFE_INTEGER) + 1n })
  ];
  for (const log of malformedLogs) {
    await assert.rejects(
      fetchCatNamedLogs({ getLogs: async () => [log] }, {
        fromBlock: 1n,
        toBlock: 1n,
        chunkSize: 1n
      })
    );
  }
});
