import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const BUNDLE_PATH = path.join(
  ROOT_DIR,
  "references",
  "upstream",
  "mooncatrescue",
  "libmooncat-limited.js"
);
const OUTPUT_PATH = path.join(
  ROOT_DIR,
  "data",
  "reference",
  "cat-id-to-rescue-order.json"
);
const COUNT = 25_440;
const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;

/*
 * Artifact schema:
 *   count: total number of entries
 *   catIdsByRescueOrder: CatIDs indexed by rescue order
 *   rescueOrderByCatId: normalized CatID keys mapped to rescue order
 *
 * The two indexes make both directions O(1), while the ordered array also
 * makes the rescue-order sequence explicit and easy to audit.
 */

function normalizeBundleCatId(value) {
  if (typeof value !== "string") {
    throw new TypeError("LibMoonCat returned a non-string CatID");
  }

  const normalized = value.toLowerCase();
  if (!CAT_ID_PATTERN.test(normalized)) {
    throw new Error(`LibMoonCat returned an invalid CatID: ${value}`);
  }
  return normalized;
}

async function loadLibMoonCat() {
  const source = await readFile(BUNDLE_PATH, "utf8");
  const window = Object.create(null);
  const context = vm.createContext({ window });

  vm.runInContext(source, context, {
    filename: BUNDLE_PATH,
    timeout: 120_000
  });

  const api = window.LibMoonCat;
  if (!api || typeof api.getRescueOrder !== "function" ||
      typeof api.getMoonCatIdByRescueIndex !== "function" ||
      typeof api.getCatId !== "function" || typeof api.parseCatId !== "function") {
    throw new Error("libmooncat-limited.js did not expose the required helpers");
  }
  return api;
}

function buildMapping(api) {
  const catIdsByRescueOrder = [];
  const rescueOrderByCatId = Object.create(null);

  for (let rescueOrder = 0; rescueOrder < COUNT; rescueOrder += 1) {
    const fromRescueIndex = normalizeBundleCatId(
      api.getMoonCatIdByRescueIndex(rescueOrder)
    );
    const fromGetCatId = normalizeBundleCatId(api.getCatId(rescueOrder));

    if (fromRescueIndex !== fromGetCatId) {
      throw new Error(
        `LibMoonCat helper disagreement at rescue order ${rescueOrder}`
      );
    }
    if (api.parseCatId(fromRescueIndex).toLowerCase() !== fromRescueIndex) {
      throw new Error(`LibMoonCat parseCatId mismatch for ${fromRescueIndex}`);
    }
    if (api.getRescueOrder(fromRescueIndex) !== rescueOrder) {
      throw new Error(`LibMoonCat round-trip mismatch for ${fromRescueIndex}`);
    }
    if (rescueOrderByCatId[fromRescueIndex] !== undefined) {
      throw new Error(`Duplicate CatID returned: ${fromRescueIndex}`);
    }

    catIdsByRescueOrder.push(fromRescueIndex);
    rescueOrderByCatId[fromRescueIndex] = rescueOrder;
  }

  if (catIdsByRescueOrder.length !== COUNT ||
      Object.keys(rescueOrderByCatId).length !== COUNT) {
    throw new Error(`Expected exactly ${COUNT} CatID mappings`);
  }

  return {
    count: COUNT,
    catIdsByRescueOrder,
    rescueOrderByCatId
  };
}

function serialize(mapping) {
  return `${JSON.stringify(mapping, null, 2)}\n`;
}

async function main() {
  const mapping = buildMapping(await loadLibMoonCat());
  const output = serialize(mapping);

  if (process.argv.includes("--check")) {
    let existing;
    try {
      existing = await readFile(OUTPUT_PATH, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Mapping artifact is missing: ${OUTPUT_PATH}`);
      }
      throw error;
    }
    if (existing !== output) {
      throw new Error(
        "Mapping artifact is out of date; run npm run generate:cat-id-map"
      );
    }
    console.log(`Validated ${mapping.count} CatID mappings.`);
    return;
  }

  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(`Generated ${mapping.count} CatID mappings at ${OUTPUT_PATH}.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { buildMapping, loadLibMoonCat, serialize };
