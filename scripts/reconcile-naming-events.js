import path from "node:path";

import { loadCheckpoint } from "../src/checkpoint.js";
import { loadEventsJsonl } from "../src/event-store.js";
import {
  loadPendingStore,
  pendingEventsFromStore,
  reconcilePendingEvents,
  savePendingStore
} from "../src/provisional-events.js";
import { saveLiveNameArtifacts } from "../src/live-name-artifacts.js";

const DEFAULTS = {
  checkpoint: "state/checkpoint.json",
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
  const values = {};
  const flags = new Set(Object.keys(DEFAULTS).map((key) => `--${key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`));
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
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
    checkpointPath: path.resolve(process.cwd(), values.checkpoint ?? DEFAULTS.checkpoint),
    eventsPath: path.resolve(process.cwd(), values.events ?? DEFAULTS.events),
    pendingPath: path.resolve(process.cwd(), values.pending ?? DEFAULTS.pending),
    currentNamesPath: path.resolve(process.cwd(), values.currentnames ?? DEFAULTS.currentNames),
    namesByCatIdPath: path.resolve(process.cwd(), values.namesbycatid ?? DEFAULTS.namesByCatId),
    namesByRescueOrderPath: path.resolve(process.cwd(), values.namesbyrescueorder ?? DEFAULTS.namesByRescueOrder),
    metadataPath: path.resolve(process.cwd(), values.metadata ?? DEFAULTS.metadata),
    namesSimplePath: path.resolve(process.cwd(), values.namessimple ?? DEFAULTS.namesSimple),
    namesTimestampPath: path.resolve(process.cwd(), values.namestimestamp ?? DEFAULTS.namesTimestamp)
  };
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  const [checkpoint, finalizedEvents, pendingStore] = await Promise.all([
    loadCheckpoint(paths.checkpointPath),
    loadEventsJsonl(paths.eventsPath),
    loadPendingStore(paths.pendingPath)
  ]);
  const reconciliation = reconcilePendingEvents(
    pendingEventsFromStore(pendingStore),
    finalizedEvents,
    checkpoint.lastFinalizedBlock
  );
  await savePendingStore(paths.pendingPath, reconciliation.store);
  await saveLiveNameArtifacts(finalizedEvents, reconciliation.retained, {
    currentNamesPath: paths.currentNamesPath,
    namesByCatIdPath: paths.namesByCatIdPath,
    namesByRescueOrderPath: paths.namesByRescueOrderPath,
    metadataPath: paths.metadataPath,
    namesSimplePath: paths.namesSimplePath,
    namesTimestampPath: paths.namesTimestampPath,
    finalizedSourcePath: paths.eventsPath,
    pendingSourcePath: paths.pendingPath,
    sourcePath: `${paths.eventsPath} + ${paths.pendingPath}`
  });
  process.stdout.write(`${JSON.stringify({
    finalizedBlock: checkpoint.lastFinalizedBlock,
    pendingCount: reconciliation.retained.length,
    promotedCount: reconciliation.promoted.length,
    orphanedCount: reconciliation.orphaned.length,
    removedCount: reconciliation.removed.length
  })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error)
  })}\n`);
  process.exitCode = 1;
}

export { parseArguments };
