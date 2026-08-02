import { randomUUID } from "node:crypto";
import {
  mkdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { decodeMoonCatName } from "./name-decoder.js";

export const SEED_COMPARISON_SCHEMA_VERSION = 1;

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertCatId(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{10}$/i.test(value)) {
    throw new TypeError(`${label}.catId must be a bytes5 hexadecimal string`);
  }
}

function assertRescueOrder(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}.rescueOrder must be a nonnegative safe integer`);
  }
}

function comparisonKey(record) {
  return `${record.catId}@${record.rescueOrder}`;
}

function addIndexedRecord(index, record, label) {
  assertRecord(record, label);
  assertCatId(record.catId, label);
  assertRescueOrder(record.rescueOrder, label);
  const key = comparisonKey(record);
  if (index.has(key)) {
    throw new TypeError(`${label} contains duplicate key ${key}`);
  }
  index.set(key, record);
}

function seedDetails(entry) {
  const decoded = decodeMoonCatName(entry.nameRaw, { catId: entry.catId });
  return {
    ...entry,
    decoded
  };
}

function comparableCanonical(record) {
  return {
    nameRaw: record.nameRaw,
    status: record.status,
    ...(Object.hasOwn(record, "text") ? { text: record.text } : {})
  };
}

function comparableSeed(entry) {
  const decoded = decodeMoonCatName(entry.nameRaw, { catId: entry.catId });
  return {
    nameRaw: entry.nameRaw,
    status: decoded.status,
    ...(Object.hasOwn(decoded, "text") ? { text: decoded.text } : {})
  };
}

function reportCanonicalDetails(record) {
  const {
    namedOrder: _namedOrder,
    blockTimestamp: _blockTimestamp,
    namedYear: _namedYear,
    ...details
  } = record;
  return details;
}

function equalComparable(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedEntries(index) {
  return [...index.entries()].sort(([, left], [, right]) => {
    if (left.rescueOrder !== right.rescueOrder) {
      return left.rescueOrder - right.rescueOrder;
    }
    return left.catId.localeCompare(right.catId);
  });
}

function indexedOutput(entries, valueFactory) {
  return Object.fromEntries(
    entries.map(([key, value]) => [key, valueFactory(value)])
  );
}

/** Build a deterministic comparison without merging seed records into events. */
export function buildSeedComparison(canonicalCurrentNames, seed, options = {}) {
  assertArray(canonicalCurrentNames, "canonicalCurrentNames");
  assertRecord(seed, "seed");
  assertArray(seed.entries, "seed.entries");
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("comparison options must be an object");
  }

  const canonicalIndex = new Map();
  for (const record of canonicalCurrentNames) {
    addIndexedRecord(canonicalIndex, record, "canonicalCurrentNames");
    if (typeof record.nameRaw !== "string" ||
        typeof record.status !== "string") {
      throw new TypeError("canonical records must include nameRaw and status");
    }
  }
  const seedIndex = new Map();
  for (const entry of seed.entries) {
    addIndexedRecord(seedIndex, entry, "seed.entries");
    if (typeof entry.nameRaw !== "string" ||
        !/^0x[0-9a-f]{64}$/i.test(entry.nameRaw)) {
      throw new TypeError("seed entries must include a bytes32 nameRaw");
    }
  }

  const exactMatches = [];
  const mismatches = [];
  for (const [key, canonical] of sortedEntries(canonicalIndex)) {
    const seedEntry = seedIndex.get(key);
    if (!seedEntry) {
      continue;
    }
    if (equalComparable(comparableCanonical(canonical), comparableSeed(seedEntry))) {
      exactMatches.push([key, {
        canonical: reportCanonicalDetails(canonical),
        seed: seedDetails(seedEntry)
      }]);
    } else {
      mismatches.push([key, {
        canonical: reportCanonicalDetails(canonical),
        seed: seedDetails(seedEntry)
      }]);
    }
  }

  const canonicalOnly = sortedEntries(canonicalIndex)
    .filter(([key]) => !seedIndex.has(key));
  const seedOnly = sortedEntries(seedIndex)
    .filter(([key]) => !canonicalIndex.has(key));

  return {
    schemaVersion: SEED_COMPARISON_SCHEMA_VERSION,
    canonicalSource: options.canonicalSource ?? "data/current-names.json",
    seedSource: options.seedSource ?? "data/seed/current-names.json",
    canonicalCount: canonicalCurrentNames.length,
    seedCount: seed.entries.length,
    counts: {
      exactMatches: exactMatches.length,
      canonicalOnly: canonicalOnly.length,
      seedOnly: seedOnly.length,
      mismatches: mismatches.length
    },
    exactMatches: indexedOutput(exactMatches, (value) => value),
    canonicalOnly: indexedOutput(canonicalOnly, (value) => ({
      canonical: reportCanonicalDetails(value)
    })),
    seedOnly: indexedOutput(seedOnly, (value) => ({ seed: seedDetails(value) })),
    mismatches: indexedOutput(mismatches, (value) => value)
  };
}

export function serializeSeedComparison(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Atomically write the deterministic seed comparison report. */
export async function writeSeedComparison(filePath, report) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeSeedComparison(report), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }
  return report;
}
