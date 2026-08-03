import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { decodeMoonCatName } from "./name-decoder.js";
import {
  EventStoreConflictError,
  mergeEvents,
  validateEvent
} from "./event-store.js";

export const PENDING_SCHEMA_VERSION = 1;
export const PENDING_STATUS = "provisional";

const PENDING_FIELDS = ["schemaVersion", "status", "events"];
const RECORD_FIELDS = ["status", "event"];
const EVENT_INPUT_FIELDS = [
  "eventId",
  "transactionHash",
  "logIndex",
  "blockNumber",
  "transactionIndex",
  "catId",
  "nameRaw",
  "removed"
];
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/i;
const NAME_RAW_PATTERN = /^0x[0-9a-f]{64}$/i;
const EVENT_ID_PATTERN = /^0x[0-9a-f]{64}:\d+$/i;

function compareEventIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new TypeError(message);
}

function assertExactFields(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} fields do not match the provisional schema`);
  }
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer`);
  }
}

/** Convert the Worker wire event into the canonical event shape independently. */
export function normalizeProvisionalEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("provisional event must be an object");
  }
  const fields = Object.hasOwn(input, "transactionIndex")
    ? EVENT_INPUT_FIELDS
    : EVENT_INPUT_FIELDS.filter((field) => field !== "transactionIndex");
  assertExactFields(input, fields, "provisional event");
  if (typeof input.transactionHash !== "string" ||
      !HASH_PATTERN.test(input.transactionHash) ||
      input.transactionHash !== input.transactionHash.toLowerCase()) {
    fail("transactionHash must be lowercase 32-byte hex");
  }
  assertSafeInteger(input.logIndex, "logIndex");
  assertSafeInteger(input.blockNumber, "blockNumber");
  if (Object.hasOwn(input, "transactionIndex")) {
    assertSafeInteger(input.transactionIndex, "transactionIndex");
  }
  if (typeof input.catId !== "string" ||
      !CAT_ID_PATTERN.test(input.catId) ||
      input.catId !== input.catId.toLowerCase()) {
    fail("catId must be lowercase bytes5 hex");
  }
  if (typeof input.nameRaw !== "string" ||
      !NAME_RAW_PATTERN.test(input.nameRaw) ||
      input.nameRaw !== input.nameRaw.toLowerCase()) {
    fail("nameRaw must be lowercase bytes32 hex");
  }
  if (typeof input.removed !== "boolean") {
    fail("removed must be boolean");
  }
  if (typeof input.eventId !== "string" ||
      !EVENT_ID_PATTERN.test(input.eventId) ||
      input.eventId !== `${input.transactionHash}:${input.logIndex}`) {
    fail("eventId must equal transactionHash:logIndex");
  }
  const event = {
    ...input,
    decoded: decodeMoonCatName(input.nameRaw, { catId: input.catId })
  };
  return validateEvent(event);
}

export function createPendingStore(events = []) {
  if (!Array.isArray(events)) {
    throw new TypeError("pending events must be an array");
  }
  const byEventId = new Map();
  for (const input of events) {
    const event = Object.hasOwn(input ?? {}, "decoded")
      ? validateEvent(input)
      : normalizeProvisionalEvent(input);
    if (event.removed) {
      continue;
    }
    const existing = byEventId.get(event.eventId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new EventStoreConflictError(event.eventId);
    }
    byEventId.set(event.eventId, event);
  }
  const eventEntries = [...byEventId.values()]
    .sort((left, right) => compareEventIds(left.eventId, right.eventId))
    .map((event) => [event.eventId, { status: PENDING_STATUS, event }]);
  return {
    schemaVersion: PENDING_SCHEMA_VERSION,
    status: PENDING_STATUS,
    events: Object.fromEntries(eventEntries)
  };
}

export function validatePendingStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    fail("pending store must be an object");
  }
  assertExactFields(store, PENDING_FIELDS, "pending store");
  if (store.schemaVersion !== PENDING_SCHEMA_VERSION) {
    fail("unsupported pending store schema version");
  }
  if (store.status !== PENDING_STATUS) {
    fail("pending store status must be provisional");
  }
  if (!store.events || typeof store.events !== "object" || Array.isArray(store.events)) {
    fail("pending store events must be an object keyed by event ID");
  }
  let previousId = "";
  for (const eventId of Object.keys(store.events)) {
    if (eventId <= previousId) {
      fail("pending store event keys must be sorted");
    }
    previousId = eventId;
    const record = store.events[eventId];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail("pending record must be an object");
    }
    assertExactFields(record, RECORD_FIELDS, "pending record");
    if (record.status !== PENDING_STATUS) {
      fail("pending record status must be provisional");
    }
    const event = validateEvent(record.event);
    if (event.removed || event.eventId !== eventId) {
      fail("pending record key must identify a nonremoved event");
    }
  }
  return store;
}

export function pendingEventsFromStore(store) {
  validatePendingStore(store);
  return mergeEvents([], Object.values(store.events).map((record) => record.event));
}

export async function loadPendingStore(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return createPendingStore();
    }
    throw error;
  }
  if (contents.trim() === "") {
    return createPendingStore();
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail("pending store is not valid JSON");
  }
  return validatePendingStore(parsed);
}

function serializePendingStore(store) {
  return `${JSON.stringify(validatePendingStore(store), null, 2)}\n`;
}

export async function savePendingStore(filePath, store) {
  const validated = validatePendingStore(store);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serializePendingStore(validated), {
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
  return validated;
}

export function upsertPendingEvent(store, input) {
  const current = validatePendingStore(store);
  const event = Object.hasOwn(input ?? {}, "decoded")
    ? validateEvent(input)
    : normalizeProvisionalEvent(input);
  const nextEvents = { ...current.events };
  if (event.removed) {
    const changed = Object.hasOwn(nextEvents, event.eventId);
    delete nextEvents[event.eventId];
    return {
      store: validatePendingStore({ ...current, events: nextEvents }),
      changed,
      action: changed ? "removed" : "ignored"
    };
  }
  const existing = nextEvents[event.eventId]?.event;
  if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
    throw new EventStoreConflictError(event.eventId);
  }
  const changed = !existing;
  nextEvents[event.eventId] = { status: PENDING_STATUS, event };
  const sortedEvents = Object.fromEntries(
    Object.entries(nextEvents).sort(([left], [right]) => compareEventIds(left, right))
  );
  return {
    store: validatePendingStore({ ...current, events: sortedEvents }),
    changed,
    action: changed ? "added" : "duplicate"
  };
}

/** Reconcile provisional events against the finalized canonical event history. */
export function reconcilePendingEvents(pendingEvents, canonicalEvents, finalizedBlock) {
  if (!Number.isSafeInteger(finalizedBlock) || finalizedBlock < 0) {
    throw new TypeError("finalizedBlock must be a nonnegative safe integer");
  }
  const canonicalById = new Map(
    mergeEvents([], canonicalEvents).map((event) => [event.eventId, event])
  );
  const retained = [];
  const promoted = [];
  const orphaned = [];
  const removed = [];
  for (const pending of mergeEvents([], pendingEvents)) {
    if (pending.removed) {
      removed.push(pending);
      continue;
    }
    const canonical = canonicalById.get(pending.eventId);
    if (canonical) {
      if (canonical.removed) {
        removed.push(pending);
      } else {
        const comparableCanonical = Object.hasOwn(pending, "transactionIndex") ===
          Object.hasOwn(canonical, "transactionIndex")
          ? canonical
          : Object.fromEntries(
            Object.entries(canonical).filter(([key]) => key !== "transactionIndex")
          );
        const comparablePending = Object.hasOwn(pending, "transactionIndex") ===
          Object.hasOwn(canonical, "transactionIndex")
          ? pending
          : Object.fromEntries(
            Object.entries(pending).filter(([key]) => key !== "transactionIndex")
          );
        mergeEvents([comparableCanonical], [comparablePending]);
        promoted.push(pending);
      }
    } else if (pending.blockNumber <= finalizedBlock) {
      orphaned.push(pending);
    } else {
      retained.push(pending);
    }
  }
  return {
    retained,
    promoted,
    orphaned,
    removed,
    store: createPendingStore(retained)
  };
}
