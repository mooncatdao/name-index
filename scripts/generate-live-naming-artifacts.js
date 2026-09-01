import { readFile } from "node:fs/promises";

import {
  buildLiveNameArtifacts,
  saveLiveNameArtifacts,
  serializeLiveNameArtifact
} from "../src/live-name-artifacts.js";
import { loadEventsJsonl } from "../src/event-store.js";
import {
  loadPendingStore,
  pendingEventsFromStore
} from "../src/provisional-events.js";

const DEFAULTS = {
  events: "data/events.jsonl",
  pending: "data/pending-events.json",
  currentNames: "data/current-names-live.json",
  namesByCatId: "data/names-by-cat-id-live.json",
  namesByRescueOrder: "data/names-by-rescue-order-live.json",
  metadata: "data/metadata-live.json",
  namesSimple: "data/names-simple-live.json",
  namesTimestamp: "data/names-timestamp-live.json"
};

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set([
    "--events",
    "--pending",
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
      if (values.check) {
        throw new Error("--check may be provided only once");
      }
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
    pendingPath: values.pending ?? DEFAULTS.pending,
    currentNamesPath: values.currentnames ?? DEFAULTS.currentNames,
    namesByCatIdPath: values.namesbycatid ?? DEFAULTS.namesByCatId,
    namesByRescueOrderPath: values.namesbyrescueorder ?? DEFAULTS.namesByRescueOrder,
    metadataPath: values.metadata ?? DEFAULTS.metadata,
    namesSimplePath: values.namessimple ?? DEFAULTS.namesSimple,
    namesTimestampPath: values.namestimestamp ?? DEFAULTS.namesTimestamp
  };
}

async function buildOutputs(paths) {
  const [finalizedEvents, pendingStore] = await Promise.all([
    loadEventsJsonl(paths.eventsPath),
    loadPendingStore(paths.pendingPath)
  ]);
  const artifacts = buildLiveNameArtifacts(
    finalizedEvents,
    pendingEventsFromStore(pendingStore),
    {
      finalizedSourcePath: paths.eventsPath,
      pendingSourcePath: paths.pendingPath,
      sourcePath: `${paths.eventsPath} + ${paths.pendingPath}`
    }
  );
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [
      key,
      serializeLiveNameArtifact(value)
    ])
  );
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
        throw new Error(`live artifact is missing: ${filePath}`);
      }
      throw error;
    }
    if (actualBytes !== expectedBytes) {
      throw new Error(`live artifact is out of date: ${filePath}`);
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const paths = {
    eventsPath: args.eventsPath,
    pendingPath: args.pendingPath,
    currentNamesPath: args.currentNamesPath,
    namesByCatIdPath: args.namesByCatIdPath,
    namesByRescueOrderPath: args.namesByRescueOrderPath,
    metadataPath: args.metadataPath,
    namesSimplePath: args.namesSimplePath,
    namesTimestampPath: args.namesTimestampPath
  };
  if (args.check) {
    await checkOutputs(paths);
    console.log("Validated live naming artifacts.");
  } else {
    const [finalizedEvents, pendingStore] = await Promise.all([
      loadEventsJsonl(paths.eventsPath),
      loadPendingStore(paths.pendingPath)
    ]);
    await saveLiveNameArtifacts(
      finalizedEvents,
      pendingEventsFromStore(pendingStore),
      paths,
      {
        finalizedSourcePath: paths.eventsPath,
        pendingSourcePath: paths.pendingPath,
        sourcePath: `${paths.eventsPath} + ${paths.pendingPath}`
      }
    );
    console.log("Generated live naming artifacts.");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { parseArguments };
