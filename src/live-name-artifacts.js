import {
  buildCurrentNameArtifacts,
  serializeCurrentNameArtifact,
  writeCurrentNameJsonAtomic
} from "./current-name-artifacts.js";
import { mergeEvents } from "./event-store.js";
import { assertReconciliationMatch } from "./provisional-events.js";

const ARTIFACT_KEYS = [
  "currentNames",
  "namesByCatId",
  "namesByRescueOrder",
  "metadata",
  "namesSimple"
];

function assertPaths(paths) {
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new TypeError("live artifact paths are required");
  }
  for (const key of [
    "currentNamesPath",
    "namesByCatIdPath",
    "namesByRescueOrderPath",
    "metadataPath",
    "namesSimplePath"
  ]) {
    if (typeof paths[key] !== "string" || paths[key] === "") {
      throw new TypeError(`live artifact paths must include ${key}`);
    }
  }
}

function addProvisionalMarker(value, pendingEventIds) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry === null
      ? null
      : addProvisionalMarker(entry, pendingEventIds));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (typeof value.eventId === "string" && pendingEventIds.has(value.eventId)) {
    return { ...value, provisional: true };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      addProvisionalMarker(entry, pendingEventIds)
    ])
  );
}

/** Build explicit live artifacts from finalized events plus provisional events. */
export function buildLiveNameArtifacts(finalizedEvents, pendingEvents, options = {}) {
  if (!Array.isArray(finalizedEvents) || !Array.isArray(pendingEvents)) {
    throw new TypeError("finalized and pending events must be arrays");
  }
  const finalized = mergeEvents([], finalizedEvents);
  const pending = mergeEvents([], pendingEvents);
  const finalizedById = new Map(
    finalized.map((event) => [event.eventId, event])
  );
  const pendingOverlay = [];
  for (const event of pending) {
    const canonical = finalizedById.get(event.eventId);
    if (canonical) {
      assertReconciliationMatch(canonical, event);
      continue;
    }
    pendingOverlay.push(event);
  }
  const combined = mergeEvents(finalized, pendingOverlay);
  const base = buildCurrentNameArtifacts(combined, {
    sourcePath: options.sourcePath ?? "data/events.jsonl + data/pending-events.json"
  });
  const pendingEventIds = new Set(
    pendingOverlay
      .filter((event) => !event.removed)
      .map((event) => event.eventId)
  );
  const pendingBlankEventCount = pendingOverlay.filter((event) =>
    event.decoded.status === "blank"
  ).length;
  const pendingRemovedEventCount = pendingOverlay.filter((event) =>
    event.removed
  ).length;
  const pendingNamedCatCount = base.currentNames.filter((record) =>
    pendingEventIds.has(record.eventId)
  ).length;
  const metadata = {
    ...base.metadata,
    artifactType: "live",
    finalizedEventCount: finalized.length,
    pendingEventCount: pendingOverlay.length,
    pendingBlankEventCount,
    pendingRemovedEventCount,
    pendingNamedCatCount,
    pendingStatus: "provisional",
    sources: {
      finalized: options.finalizedSourcePath ?? "data/events.jsonl",
      pending: options.pendingSourcePath ?? "data/pending-events.json"
    }
  };
  return {
    currentNames: addProvisionalMarker(base.currentNames, pendingEventIds),
    namesByCatId: addProvisionalMarker(base.namesByCatId, pendingEventIds),
    namesByRescueOrder: addProvisionalMarker(base.namesByRescueOrder, pendingEventIds),
    metadata,
    namesSimple: base.namesSimple
  };
}

/** Atomically persist all explicit live artifacts. */
export async function saveLiveNameArtifacts(
  finalizedEvents,
  pendingEvents,
  paths,
  options = {}
) {
  assertPaths(paths);
  const artifacts = buildLiveNameArtifacts(finalizedEvents, pendingEvents, options);
  const write = options.writeJsonAtomic ?? writeCurrentNameJsonAtomic;
  if (typeof write !== "function") {
    throw new TypeError("writeJsonAtomic dependency must be a function");
  }
  for (const key of ARTIFACT_KEYS) {
    await write(paths[`${key}Path`], artifacts[key]);
  }
  return artifacts;
}

export function serializeLiveNameArtifact(value) {
  return serializeCurrentNameArtifact(value);
}

export { assertPaths as assertLiveArtifactPaths };
