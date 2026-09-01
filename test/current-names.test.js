import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createInitialCheckpoint } from "../src/checkpoint.js";
import { deriveCurrentNames, CurrentNameConflictError } from "../src/current-names.js";

const BLANK_RAW = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TEXT_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const INVALID_RAW = "0xc328000000000000000000000000000000000000000000000000000000000000";
const LEADING_RAW = "0x0063617400000000000000000000000000000000000000000000000000000000";
const REDACTED_RAW = "0x4a657773646964392f3131000000000000000000000000000000000000000000";

function event({ id, catId, blockNumber, status = "text", nameRaw = TEXT_RAW, text = "cat", removed = false, blockTimestamp = 1_502_373_528, namer = "0x4bE972E5799b243180b2FC76468a1C8503281449" }) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  const decoded = { rawName: nameRaw, status };
  if (status === "text" || status === "redacted") {
    decoded.text = text;
  }
  return {
    eventId: `${transactionHash}:0`,
    transactionHash,
    logIndex: 0,
    blockNumber,
    transactionIndex: 0,
    blockTimestamp,
    ...(status === "blank" ? {} : { namer }),
    catId,
    nameRaw,
    removed,
    decoded
  };
}

test("blank events do not assign, while a later nonblank event does", () => {
  const result = deriveCurrentNames([
    event({ id: "a", catId: "0x00d8523a53", blockNumber: 2, status: "blank", nameRaw: BLANK_RAW }),
    event({ id: "b", catId: "0x00d8523a53", blockNumber: 3 })
  ]);
  assert.equal(result.currentNames.length, 1);
  assert.equal(result.currentNames[0].catId, "0x00d8523a53");
  assert.equal(result.currentNames[0].rescueOrder, 6);
});

test("removed and blank-only histories produce no assignments", () => {
  const result = deriveCurrentNames([
    event({ id: "a", catId: "0x00d8523a53", blockNumber: 2, removed: true }),
    event({ id: "b", catId: "0x0069b659c0", blockNumber: 3, status: "blank", nameRaw: BLANK_RAW })
  ]);
  assert.deepEqual(result.currentNames, []);
  assert.deepEqual(result.namesByCatId, {});
  assert.equal(result.namesByRescueOrder.length, 25_440);
  assert.equal(result.namesByRescueOrder.every((entry) => entry === null), true);
});

test("all nonblank statuses are retained with raw/status/text fields", () => {
  const result = deriveCurrentNames([
    event({ id: "a", catId: "0x00d8523a53", blockNumber: 2, status: "text" }),
    event({ id: "b", catId: "0x0069b659c0", blockNumber: 3, status: "redacted", nameRaw: REDACTED_RAW, text: "�" }),
    event({ id: "c", catId: "0x00b7c50d8a", blockNumber: 4, status: "invalid-utf8", nameRaw: INVALID_RAW }),
    event({ id: "d", catId: "0x007d228add", blockNumber: 5, status: "leading-null", nameRaw: LEADING_RAW })
  ]);
  assert.deepEqual(result.currentNames.map((entry) => entry.rescueOrder), [6, 35, 37, 39]);
  assert.deepEqual(result.currentNames.map((entry) => entry.namedOrder), [1, 2, 3, 4]);
  assert.equal(result.namesByCatId["0x00d8523a53"].namedYear, 2017);
  assert.equal(result.namesByCatId["0x00d8523a53"].blockTimestamp, 1_502_373_528);
  assert.equal(result.namesByCatId["0x00d8523a53"].namer, "0x4bE972E5799b243180b2FC76468a1C8503281449");
  assert.equal(result.namesByCatId["0x0069b659c0"].text, "�");
  assert.equal(Object.hasOwn(result.namesByCatId["0x00b7c50d8a"], "text"), false);
  assert.equal(result.namesByRescueOrder[39].status, "leading-null");
});

test("named order uses canonical event order within the same block and is one-based", () => {
  const first = event({ id: "a", catId: "0x00d8523a53", blockNumber: 10 });
  const second = event({ id: "b", catId: "0x0069b659c0", blockNumber: 10 });
  const result = deriveCurrentNames([
    { ...second, transactionIndex: 2 },
    { ...first, transactionIndex: 1 }
  ]);
  assert.equal(result.namesByCatId[first.catId].namedOrder, 1);
  assert.equal(result.namesByCatId[second.catId].namedOrder, 2);
});

test("distinct nonblank assignments for one CatID fail loudly", () => {
  assert.throws(() => deriveCurrentNames([
    event({ id: "a", catId: "0x00d8523a53", blockNumber: 2 }),
    event({ id: "b", catId: "0x00d8523a53", blockNumber: 3, nameRaw: REDACTED_RAW, status: "redacted", text: "�" })
  ]), CurrentNameConflictError);
});

test("indexes are deterministic, sparse, and input remains unchanged", () => {
  const events = [
    event({ id: "b", catId: "0x0069b659c0", blockNumber: 4 }),
    event({ id: "a", catId: "0x00d8523a53", blockNumber: 2 })
  ];
  const before = JSON.stringify(events);
  const result = deriveCurrentNames(events);
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(Object.keys(result.namesByCatId), ["0x0069b659c0", "0x00d8523a53"]);
  assert.equal(result.namesByRescueOrder[6].catId, "0x00d8523a53");
  assert.equal(result.namesByRescueOrder[35].catId, "0x0069b659c0");
  assert.equal(result.namesByRescueOrder.filter(Boolean).length, 2);
});

test("generator creates deterministic artifacts and --check detects byte mismatches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-current-names-"));
  const paths = ["events.jsonl", "current.json", "by-cat.json", "by-rescue.json", "metadata.json", "names-simple.json", "names-timestamp.json"]
    .map((name) => path.join(directory, name));
  const args = [
    "scripts/generate-current-names.js",
    "--events", paths[0],
    "--current-names", paths[1],
    "--names-by-cat-id", paths[2],
    "--names-by-rescue-order", paths[3],
    "--metadata", paths[4],
    "--names-simple", paths[5],
    "--names-timestamp", paths[6]
  ];
  await writeFile(paths[0], "", "utf8");
  let result = spawnSync(process.execPath, args, { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const firstBytes = await Promise.all(paths.slice(1).map((filePath) => readFile(filePath, "utf8")));
  result = spawnSync(process.execPath, [...args, "--check"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await writeFile(paths[1], `${firstBytes[0]}\n`, "utf8");
  result = spawnSync(process.execPath, [...args, "--check"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  await rm(directory, { recursive: true, force: true });
});
