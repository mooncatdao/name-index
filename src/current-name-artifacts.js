import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CHAIN_ID,
  MOONCAT_COUNT,
  MOONCAT_RESCUE_ADDRESS,
  NAMING_START_BLOCK
} from "./constants.js";
import { mergeEvents } from "./event-store.js";
import { deriveCurrentNames } from "./current-names.js";

const ARTIFACT_KEYS = [
  "currentNames",
  "namesByCatId",
  "namesByRescueOrder",
  "metadata",
  "namesSimple",
  "namesTimestamp"
];

function assertPaths(paths) {
  if (!paths || typeof paths !== "object") {
    throw new TypeError("artifact paths are required");
  }
  for (const key of [
    "currentNamesPath",
    "namesByCatIdPath",
    "namesByRescueOrderPath",
    "metadataPath",
    "namesSimplePath",
    "namesTimestampPath"
  ]) {
    if (typeof paths[key] !== "string" || paths[key] === "") {
      throw new TypeError(`artifact paths must include ${key}`);
    }
  }
}

/** Serialize artifact values with the standalone generator's exact format. */
export function serializeCurrentNameArtifact(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildMetadata(events, derived, sourcePath) {
  return {
    schemaVersion: 1,
    chainId: CHAIN_ID,
    contractAddress: MOONCAT_RESCUE_ADDRESS,
    namingStartBlock: Number(NAMING_START_BLOCK),
    moonCatCount: MOONCAT_COUNT,
    eventCount: events.length,
    blankEventCount: events.filter((event) => event.decoded.status === "blank").length,
    removedEventCount: events.filter((event) => event.removed).length,
    namedCatCount: derived.currentNames.length,
    source: sourcePath
  };
}

/** Build CatMoon's display-only decimal rescue-order name map. */
export function buildSimpleNameMap(currentNames) {
  return Object.fromEntries(
    currentNames
      .filter((record) => typeof record.text === "string")
      .sort((left, right) => left.rescueOrder - right.rescueOrder)
      .map((record) => [String(record.rescueOrder), record.text])
  );
}

/** Build the display-ready rescue-order map with naming-event timestamps. */
export function buildTimestampNameMap(currentNames) {
  return Object.fromEntries(
    currentNames
      .filter((record) => typeof record.text === "string")
      .sort((left, right) => left.rescueOrder - right.rescueOrder)
      .map((record) => [String(record.rescueOrder), {
        name: record.text,
        timestamp: Object.hasOwn(record, "blockTimestamp")
          ? record.blockTimestamp
          : null
      }])
  );
}

/** Build all current-name artifacts from an already available event array. */
export function buildCurrentNameArtifacts(events, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("artifact options must be an object");
  }
  const canonicalEvents = mergeEvents([], events);
  const derived = deriveCurrentNames(canonicalEvents);
  return {
    currentNames: derived.currentNames,
    namesByCatId: derived.namesByCatId,
    namesByRescueOrder: derived.namesByRescueOrder,
    metadata: buildMetadata(
      canonicalEvents,
      derived,
      options.sourcePath ?? "data/events.jsonl"
    ),
    namesSimple: buildSimpleNameMap(derived.currentNames),
    namesTimestamp: buildTimestampNameMap(derived.currentNames)
  };
}

export async function writeCurrentNameJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serializeCurrentNameArtifact(value), {
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
}

/** Atomically persist all current-name artifacts from the supplied events. */
export async function saveCurrentNameArtifacts(events, paths, options = {}) {
  assertPaths(paths);
  const artifacts = buildCurrentNameArtifacts(events, options);
  const write = options.writeJsonAtomic ?? writeCurrentNameJsonAtomic;
  if (typeof write !== "function") {
    throw new TypeError("writeJsonAtomic dependency must be a function");
  }
  for (const key of ARTIFACT_KEYS) {
    const pathKey = `${key}Path`;
    await write(paths[pathKey], artifacts[key]);
  }
  return artifacts;
}
