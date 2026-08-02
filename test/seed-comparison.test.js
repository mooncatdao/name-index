import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSeedComparison,
  serializeSeedComparison,
  writeSeedComparison
} from "../src/seed-comparison.js";

const TEXT_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const OTHER_RAW = "0x646f670000000000000000000000000000000000000000000000000000000000";

function canonical(catId, rescueOrder, nameRaw = TEXT_RAW, text = "cat") {
  return {
    catId,
    rescueOrder,
    eventId: `0x${String(rescueOrder).padStart(64, "0")}:0`,
    blockNumber: 4_140_500 + rescueOrder,
    transactionHash: `0x${String(rescueOrder).padStart(64, "0")}`,
    logIndex: 0,
    transactionIndex: 0,
    nameRaw,
    status: "text",
    text
  };
}

function seedEntry(catId, rescueOrder, nameRaw = TEXT_RAW, name = "cat") {
  return {
    catId,
    rescueOrder,
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    blockHeight: 4_140_500,
    timestamp: 1_502_373_528,
    namedOrder: rescueOrder,
    nameRaw,
    namer: "0x4bE972E5799b243180b2FC76468a1C8503281449",
    name
  };
}

test("comparison is deterministic and categorizes exact, canonical-only, seed-only, and mismatch records", () => {
  const canonicalRecords = [
    canonical("0x00d8523a53", 6),
    canonical("0x0069b659c0", 35, OTHER_RAW, "dog"),
    canonical("0x00b7c50d8a", 37)
  ];
  const seed = {
    schemaVersion: 1,
    entries: [
      seedEntry("0x00d8523a53", 6),
      seedEntry("0x0069b659c0", 35),
      seedEntry("0x007d228add", 39)
    ]
  };
  const report = buildSeedComparison(canonicalRecords, seed, {
    canonicalSource: "data/current-names.json",
    seedSource: "data/seed/current-names.json"
  });

  assert.deepEqual(report.counts, {
    exactMatches: 1,
    canonicalOnly: 1,
    seedOnly: 1,
    mismatches: 1
  });
  assert.equal(report.exactMatches["0x00d8523a53@6"].canonical.catId, "0x00d8523a53");
  assert.equal(report.canonicalOnly["0x00b7c50d8a@37"].canonical.status, "text");
  assert.equal(report.seedOnly["0x007d228add@39"].seed.name, "cat");
  assert.equal(report.mismatches["0x0069b659c0@35"].canonical.text, "dog");
  assert.equal(report.mismatches["0x0069b659c0@35"].seed.decoded.text, "cat");
});

test("comparison preserves raw and decoded details for undecodable seed names", () => {
  const raw = "0xb100000000000000000000000000000000000000000000000000000000000000";
  const report = buildSeedComparison([], {
    entries: [seedEntry("0x00116f9319", 9871, raw, true)]
  });
  const record = report.seedOnly["0x00116f9319@9871"].seed;
  assert.equal(record.name, true);
  assert.equal(record.nameRaw, raw);
  assert.equal(record.decoded.status, "invalid-utf8");
  assert.equal(Object.hasOwn(record.decoded, "text"), false);
});

test("report serialization and atomic write are exact-byte deterministic", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-seed-comparison-"));
  const reportPath = path.join(directory, "report.json");
  const report = buildSeedComparison([], { entries: [] });
  await writeSeedComparison(reportPath, report);
  assert.equal(await readFile(reportPath, "utf8"), serializeSeedComparison(report));
  await writeFile(reportPath, `${serializeSeedComparison(report)}\n`, "utf8");
  assert.notEqual(await readFile(reportPath, "utf8"), serializeSeedComparison(report));
  await rm(directory, { recursive: true, force: true });
});

test("comparison rejects duplicate CatID/rescue-order keys", () => {
  const entry = seedEntry("0x00d8523a53", 6);
  assert.throws(
    () => buildSeedComparison([], { entries: [entry, { ...entry }] }),
    /duplicate key 0x00d8523a53@6/
  );
});
