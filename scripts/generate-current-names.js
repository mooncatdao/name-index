import { readFile } from "node:fs/promises";

import {
  buildCurrentNameArtifacts,
  saveCurrentNameArtifacts,
  serializeCurrentNameArtifact
} from "../src/current-name-artifacts.js";
import { loadEventsJsonl } from "../src/event-store.js";

const DEFAULTS = {
  events: "data/events.jsonl",
  currentNames: "data/current-names.json",
  namesByCatId: "data/names-by-cat-id.json",
  namesByRescueOrder: "data/names-by-rescue-order.json",
  metadata: "data/metadata.json",
  namesSimple: "data/names-simple.json",
  namesTimestamp: "data/names-timestamp.json"
};

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set([
    "--events",
    "--current-names",
    "--names-by-cat-id",
    "--names-by-rescue-order",
    "--metadata",
    "--names-simple",
    "--names-timestamp"
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
    metadataPath: values.metadata ?? DEFAULTS.metadata,
    namesSimplePath: values.namessimple ?? DEFAULTS.namesSimple,
    namesTimestampPath: values.namestimestamp ?? DEFAULTS.namesTimestamp
  };
}

async function readSource(paths) {
  return loadEventsJsonl(paths.eventsPath);
}

async function buildOutputs(paths) {
  const events = await readSource(paths);
  const artifacts = buildCurrentNameArtifacts(events, { sourcePath: paths.eventsPath });
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [
      key,
      serializeCurrentNameArtifact(value)
    ])
  );
}

async function writeOutputs(paths) {
  const events = await readSource(paths);
  await saveCurrentNameArtifacts(events, paths, { sourcePath: paths.eventsPath });
}

async function checkOutputs(paths) {
  const expected = await buildOutputs(paths);
  const outputPaths = [
    [paths.currentNamesPath, expected.currentNames],
    [paths.namesByCatIdPath, expected.namesByCatId],
    [paths.namesByRescueOrderPath, expected.namesByRescueOrder],
    [paths.metadataPath, expected.metadata],
    [paths.namesSimplePath, expected.namesSimple],
    [paths.namesTimestampPath, expected.namesTimestamp]
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
    metadataPath: args.metadataPath,
    namesSimplePath: args.namesSimplePath,
    namesTimestampPath: args.namesTimestampPath
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

export { parseArguments };
