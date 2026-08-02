import {
  loadEventsJsonl,
  mergeEvents,
  saveEventsJsonl
} from "./event-store.js";
import { saveCheckpoint } from "./checkpoint.js";
import { runDryRunScan } from "./dry-run-scanner.js";

function assertPaths(paths) {
  if (!paths || typeof paths !== "object" ||
      typeof paths.eventsPath !== "string" || paths.eventsPath === "" ||
      typeof paths.checkpointPath !== "string" || paths.checkpointPath === "") {
    throw new TypeError("paths must contain eventsPath and checkpointPath");
  }
}

function assertDependency(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} dependency must be a function`);
  }
}

/** Persist canonical events before attempting checkpoint advancement. */
export async function runPersistentScan(client, checkpoint, paths, options = {}) {
  assertPaths(paths);
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("scanner options must be an object");
  }
  const dependencies = options.dependencies ?? {};
  const scan = dependencies.runDryRunScan ?? runDryRunScan;
  const loadEvents = dependencies.loadEventsJsonl ?? loadEventsJsonl;
  const saveEvents = dependencies.saveEventsJsonl ?? saveEventsJsonl;
  const saveState = dependencies.saveCheckpoint ?? saveCheckpoint;
  assertDependency(scan, "runDryRunScan");
  assertDependency(loadEvents, "loadEventsJsonl");
  assertDependency(saveEvents, "saveEventsJsonl");
  assertDependency(saveState, "saveCheckpoint");

  const scanResult = await scan(client, checkpoint, options);
  const existingEvents = await loadEvents(paths.eventsPath);
  const mergedEvents = mergeEvents(existingEvents, scanResult.events);
  const eventsChanged = JSON.stringify(existingEvents) !== JSON.stringify(mergedEvents);
  const checkpointAdvanced =
    scanResult.proposedCheckpoint.lastScannedBlock >
      scanResult.currentCheckpoint.lastScannedBlock ||
    scanResult.proposedCheckpoint.lastFinalizedBlock >
      scanResult.currentCheckpoint.lastFinalizedBlock;
  const checkpointChanged = checkpointAdvanced;

  if (eventsChanged) {
    await saveEvents(paths.eventsPath, mergedEvents);
  }
  if (checkpointChanged) {
    await saveState(paths.checkpointPath, scanResult.proposedCheckpoint);
  }

  return {
    ...scanResult,
    existingEventCount: existingEvents.length,
    persistedEventCount: mergedEvents.length,
    eventsChanged,
    checkpointChanged,
    checkpointAdvanced
  };
}
