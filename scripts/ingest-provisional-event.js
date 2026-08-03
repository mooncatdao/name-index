import {
  loadPendingStore,
  savePendingStore,
  upsertPendingEvent
} from "../src/provisional-events.js";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--pending" || index + 1 >= argv.length || Object.hasOwn(values, "pending")) {
      throw new Error(`unknown or incomplete argument: ${flag}`);
    }
    values.pending = argv[++index];
    if (values.pending === "") {
      throw new Error("--pending path must not be empty");
    }
  }
  return { pendingPath: values.pending ?? "data/pending-events.json" };
}

async function readPayload() {
  const raw = process.env.PROVISIONAL_EVENT_JSON;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("PROVISIONAL_EVENT_JSON is required");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("PROVISIONAL_EVENT_JSON is not valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.provisional !== true || !payload.event) {
    throw new Error("repository payload must contain provisional=true and event");
  }
  return payload.event;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const event = await readPayload();
  const current = await loadPendingStore(args.pendingPath);
  const result = upsertPendingEvent(current, event);
  if (result.changed) {
    await savePendingStore(args.pendingPath, result.store);
  }
  process.stdout.write(`${JSON.stringify({
    action: result.action,
    changed: result.changed,
    eventId: event.eventId,
    pendingCount: Object.keys(result.store.events).length
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
