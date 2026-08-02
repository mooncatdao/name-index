import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import seed from "../data/seed/current-names.json" with { type: "json" };
import source from "../references/upstream/mooncatrescue/mooncat_named.json" with {
  type: "json"
};
import {
  getCatIdByRescueOrder,
  getRescueOrderByCatId
} from "../src/cat-id-map.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(
  ROOT_DIR,
  "references",
  "upstream",
  "mooncatrescue",
  "mooncat_named.json"
);

test("name seed contains every source record in namedOrder order", () => {
  const sourceEntries = Object.entries(source);
  assert.equal(sourceEntries.length, 1_225);
  assert.equal(seed.entries.length, 1_225);
  assert.equal(seed.source.recordCount, 1_225);
  assert.equal(seed.source.booleanTrueNameCount, 18);
  assert.equal(seed.source.blankNameAttemptsExcluded, true);

  const catIds = new Set();
  const rescueOrders = new Set();
  for (let index = 0; index < seed.entries.length; index += 1) {
    const entry = seed.entries[index];
    assert.equal(entry.namedOrder, index);
    assert.equal(getRescueOrderByCatId(entry.catId), entry.rescueOrder);
    assert.equal(getCatIdByRescueOrder(entry.rescueOrder), entry.catId);
    assert.equal(catIds.has(entry.catId), false);
    assert.equal(rescueOrders.has(entry.namedOrder), false);
    catIds.add(entry.catId);
    rescueOrders.add(entry.namedOrder);
  }
  assert.equal(catIds.size, 1_225);
  assert.equal(rescueOrders.size, 1_225);
});

test("seed preserves source records exactly and keeps undecodable names", () => {
  for (const [sourceCatId, record] of Object.entries(source)) {
    const entry = seed.entries[record.namedOrder];
    assert.deepEqual(entry, {
      catId: record.catId,
      rescueOrder: getRescueOrderByCatId(record.catId),
      txHash: record.txHash,
      blockHeight: record.blockHeight,
      timestamp: record.timestamp,
      namedOrder: record.namedOrder,
      nameRaw: record.nameRaw,
      namer: record.namer,
      name: record.name
    });
    assert.equal(entry.catId, sourceCatId);
  }

  const trueNames = seed.entries.filter((entry) => entry.name === true);
  assert.equal(trueNames.length, 18);
  assert.equal(trueNames[0].catId, "0x007973409c");
});

test("representative records and source hash are stable", () => {
  assert.deepEqual(seed.entries[0], {
    catId: "0x00d8523a53",
    rescueOrder: getRescueOrderByCatId("0x00d8523a53"),
    txHash: "0xd3e6393d78952aca8307787844bbb4b2c1b997378a6fff27fc3a629870ae6fed",
    blockHeight: 4_140_545,
    timestamp: 1_502_373_528,
    namedOrder: 0,
    nameRaw: "0x6d6973746572206d6f6f00000000000000000000000000000000000000000000",
    namer: "0x4bE972E5799b243180b2FC76468a1C8503281449",
    name: "mister moo"
  });
  assert.equal(seed.entries.at(-1).namedOrder, 1_224);

  const sourceHash = createHash("sha256")
    .update(readFileSync(SOURCE_PATH))
    .digest("hex");
  assert.equal(seed.source.sha256, sourceHash);
});

test("name seed generation is deterministic", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-name-seed.js", "--check"],
    { cwd: ROOT_DIR, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
});
