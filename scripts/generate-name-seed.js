import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getCatIdByRescueOrder,
  getRescueOrderByCatId,
  normalizeCatId
} from "../src/cat-id-map.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const SOURCE_PATH = path.join(
  ROOT_DIR,
  "references",
  "upstream",
  "mooncatrescue",
  "mooncat_named.json"
);
const OUTPUT_DIR = path.join(ROOT_DIR, "data", "seed");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "current-names.json");
const EXPECTED_COUNT = 1_225;
const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;
const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const RECORD_FIELDS = [
  "txHash",
  "blockHeight",
  "timestamp",
  "namedOrder",
  "nameRaw",
  "catId",
  "namer",
  "name"
];

/*
 * Seed schema:
 *   schemaVersion: deterministic schema version
 *   source: source snapshot, extraction-context, hash, and completeness notes
 *   entries: source records sorted by namedOrder, with rescueOrder added
 *
 * Source fields are copied without normalizing values so that true remains
 * true and address/hash casing remains exactly as represented upstream.
 */

function assertPattern(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertRecordShape(sourceCatId, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Invalid record for ${sourceCatId}`);
  }

  const actualFields = Object.keys(record).sort();
  const expectedFields = [...RECORD_FIELDS].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    throw new Error(`Unexpected fields for ${sourceCatId}`);
  }
  if (record.catId !== sourceCatId) {
    throw new Error(`Source key does not match record.catId for ${sourceCatId}`);
  }

  const normalizedCatId = normalizeCatId(record.catId);
  if (normalizedCatId !== record.catId || !CAT_ID_PATTERN.test(record.catId)) {
    throw new Error(`Invalid canonical CatID for ${sourceCatId}`);
  }
  assertPattern(record.txHash, TX_HASH_PATTERN, "transaction hash");
  assertPattern(record.nameRaw, BYTES32_PATTERN, "bytes32 nameRaw");
  assertPattern(record.namer, ADDRESS_PATTERN, "Ethereum address");

  for (const [field, label] of [
    ["blockHeight", "block height"],
    ["timestamp", "timestamp"],
    ["namedOrder", "named order"]
  ]) {
    if (!Number.isSafeInteger(record[field]) || record[field] < 0) {
      throw new Error(`Invalid ${label} for ${sourceCatId}: ${record[field]}`);
    }
  }
  if (record.name !== true && typeof record.name !== "string") {
    throw new Error(`Invalid decoded name for ${sourceCatId}`);
  }
}

function getSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildSeed(source, sourceSha256) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Naming source must be a JSON object");
  }

  const sourceEntries = Object.entries(source);
  if (sourceEntries.length !== EXPECTED_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_COUNT} naming records, got ${sourceEntries.length}`
    );
  }

  const catIds = new Set();
  const namedOrders = new Set();
  const entries = sourceEntries.map(([sourceCatId, record]) => {
    assertRecordShape(sourceCatId, record);
    if (catIds.has(record.catId)) {
      throw new Error(`Duplicate CatID: ${record.catId}`);
    }
    if (namedOrders.has(record.namedOrder)) {
      throw new Error(`Duplicate namedOrder: ${record.namedOrder}`);
    }
    catIds.add(record.catId);
    namedOrders.add(record.namedOrder);

    const rescueOrder = getRescueOrderByCatId(record.catId);
    if (getCatIdByRescueOrder(rescueOrder) !== record.catId) {
      throw new Error(`CatID mapping parity failed for ${record.catId}`);
    }

    return {
      catId: record.catId,
      rescueOrder,
      txHash: record.txHash,
      blockHeight: record.blockHeight,
      timestamp: record.timestamp,
      namedOrder: record.namedOrder,
      nameRaw: record.nameRaw,
      namer: record.namer,
      name: record.name
    };
  }).sort((left, right) => left.namedOrder - right.namedOrder);

  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].namedOrder !== index) {
      throw new Error(`namedOrder sequence is missing ${index}`);
    }
  }

  return {
    schemaVersion: 1,
    source: {
      snapshot: "references/upstream/mooncatrescue/mooncat_named.json",
      extractionContext: "references/upstream/mooncatrescue/mooncat_names.js",
      sha256: sourceSha256,
      recordCount: entries.length,
      booleanTrueNameCount: entries.filter((entry) => entry.name === true).length,
      blankNameAttemptsExcluded: true,
      blankNameNote:
        "mooncat_names.js skips blank bytes32 names; this is successful naming state, not complete CatNamed event history."
    },
    entries
  };
}

function serialize(seed) {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

async function loadSource() {
  const bytes = await readFile(SOURCE_PATH);
  return {
    bytes,
    source: JSON.parse(bytes.toString("utf8"))
  };
}

async function main() {
  const { bytes, source } = await loadSource();
  const output = serialize(buildSeed(source, getSha256(bytes)));

  if (process.argv.includes("--check")) {
    let existing;
    try {
      existing = await readFile(OUTPUT_PATH, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Name seed artifact is missing: ${OUTPUT_PATH}`);
      }
      throw error;
    }
    if (existing !== output) {
      throw new Error("Name seed artifact is out of date; run npm run generate:name-seed");
    }
    console.log(`Validated ${EXPECTED_COUNT} current-name seed records.`);
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(`Generated ${EXPECTED_COUNT} current-name seed records at ${OUTPUT_PATH}.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { buildSeed, getSha256, serialize };
