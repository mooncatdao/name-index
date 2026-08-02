import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  CHAIN_ID,
  MOONCAT_COUNT,
  MOONCAT_RESCUE_ADDRESS,
  NAMING_START_BLOCK
} from "../src/constants.js";
import { loadEventsJsonl } from "../src/event-store.js";
import { deriveCurrentNames } from "../src/current-names.js";

const DEFAULTS = {
  events: "data/events.jsonl",
  currentNames: "data/current-names.json",
  namesByCatId: "data/names-by-cat-id.json",
  namesByRescueOrder: "data/names-by-rescue-order.json",
  metadata: "data/metadata.json"
};

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set([
    "--events",
    "--current-names",
    "--names-by-cat-id",
    "--names-by-rescue-order",
    "--metadata"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      values.check = true;
      continue;
    }
    if (!flags.has(flag) || index + 1 >= argv.length) {
      throw new Error(`unknown or incomplete argument: ${flag}`);
    }
    const name = flag.slice(2).replaceAll("-", "");
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    values[name] = argv[++index];
    if (values[name] === "") {
      throw new Error(`${flag} path must not be empty`);
    }
  }
  return {
    check: values.check,
    eventsPath: values.events ?? DEFAULTS.events,
    currentNamesPath: values.currentnames ?? DEFAULTS.currentNames,
    namesByCatIdPath: values.namesbycatid ?? DEFAULTS.namesByCatId,
    namesByRescueOrderPath: values.namesbyrescueorder ?? DEFAULTS.namesByRescueOrder,
    metadataPath: values.metadata ?? DEFAULTS.metadata
  };
}

function relativeSourcePath(eventsPath) {
  return eventsPath;
}

function buildMetadata(events, derived, eventsPath) {
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
    source: relativeSourcePath(eventsPath)
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function saveJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serialize(value), {
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

async function readSource(paths) {
  return loadEventsJsonl(paths.eventsPath);
}

async function buildOutputs(paths) {
  const events = await readSource(paths);
  const derived = deriveCurrentNames(events);
  return {
    currentNames: serialize(derived.currentNames),
    namesByCatId: serialize(derived.namesByCatId),
    namesByRescueOrder: serialize(derived.namesByRescueOrder),
    metadata: serialize(buildMetadata(events, derived, paths.eventsPath))
  };
}

async function writeOutputs(paths) {
  const events = await readSource(paths);
  const derived = deriveCurrentNames(events);
  await saveJsonAtomic(paths.currentNamesPath, derived.currentNames);
  await saveJsonAtomic(paths.namesByCatIdPath, derived.namesByCatId);
  await saveJsonAtomic(paths.namesByRescueOrderPath, derived.namesByRescueOrder);
  await saveJsonAtomic(
    paths.metadataPath,
    buildMetadata(events, derived, paths.eventsPath)
  );
}

async function checkOutputs(paths) {
  const expected = await buildOutputs(paths);
  const outputPaths = [
    [paths.currentNamesPath, expected.currentNames],
    [paths.namesByCatIdPath, expected.namesByCatId],
    [paths.namesByRescueOrderPath, expected.namesByRescueOrder],
    [paths.metadataPath, expected.metadata]
  ];
  for (const [filePath, expectedBytes] of outputPaths) {
    let actualBytes;
    try {
      actualBytes = await readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`artifact is missing: ${filePath}`);
      }
      throw error;
    }
    if (actualBytes !== expectedBytes) {
      throw new Error(`artifact is out of date: ${filePath}`);
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const paths = {
    eventsPath: args.eventsPath,
    currentNamesPath: args.currentNamesPath,
    namesByCatIdPath: args.namesByCatIdPath,
    namesByRescueOrderPath: args.namesByRescueOrderPath,
    metadataPath: args.metadataPath
  };
  if (args.check) {
    await checkOutputs(paths);
    console.log("Validated current-name artifacts.");
  } else {
    await writeOutputs(paths);
    console.log("Generated current-name artifacts.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { buildMetadata, parseArguments };
