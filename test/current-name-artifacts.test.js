import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCurrentNameArtifacts,
  saveCurrentNameArtifacts
} from "../src/current-name-artifacts.js";

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

const PATHS = {
  currentNamesPath: "current.json",
  namesByCatIdPath: "by-cat.json",
  namesByRescueOrderPath: "by-rescue.json",
  metadataPath: "metadata.json"
};

test("artifact builder is deterministic and metadata matches merged events", () => {
  const artifacts = buildCurrentNameArtifacts([EVENT, EVENT], {
    sourcePath: "data/events.jsonl"
  });
  assert.equal(artifacts.currentNames.length, 1);
  assert.equal(artifacts.namesByCatId[EVENT.catId].eventId, EVENT.eventId);
  assert.equal(artifacts.namesByRescueOrder[6].catId, EVENT.catId);
  assert.equal(artifacts.namesByRescueOrder.length, 25_440);
  assert.deepEqual(artifacts.metadata, {
    schemaVersion: 1,
    chainId: 1,
    contractAddress: "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6",
    namingStartBlock: 4_140_409,
    moonCatCount: 25_440,
    eventCount: 1,
    blankEventCount: 0,
    removedEventCount: 0,
    namedCatCount: 1,
    source: "data/events.jsonl"
  });
});

test("artifact writes receive the exact merged event-derived payloads in order", async () => {
  const calls = [];
  await saveCurrentNameArtifacts([EVENT], PATHS, {
    sourcePath: "events.jsonl",
    writeJsonAtomic: async (filePath, value) => calls.push([filePath, value])
  });
  assert.deepEqual(calls.map(([filePath]) => filePath), [
    PATHS.currentNamesPath,
    PATHS.namesByCatIdPath,
    PATHS.namesByRescueOrderPath,
    PATHS.metadataPath
  ]);
  assert.equal(calls[0][1][0].eventId, EVENT.eventId);
  assert.equal(calls[1][1][EVENT.catId].eventId, EVENT.eventId);
  assert.equal(calls[2][1][6].eventId, EVENT.eventId);
  assert.equal(calls[3][1].eventCount, 1);
});

test("artifact write failure stops the remaining artifact writes", async () => {
  const calls = [];
  await assert.rejects(saveCurrentNameArtifacts([EVENT], PATHS, {
    writeJsonAtomic: async (filePath) => {
      calls.push(filePath);
      if (filePath === PATHS.namesByCatIdPath) {
        throw new Error("artifact disk full");
      }
    }
  }), /artifact disk full/);
  assert.deepEqual(calls, [PATHS.currentNamesPath, PATHS.namesByCatIdPath]);
});
