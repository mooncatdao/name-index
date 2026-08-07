import { readFile, writeFile } from "node:fs/promises";

import { loadEventsJsonl } from "../src/event-store.js";
import { buildRecentNamings, serializeRecentNamings } from "../src/recent-namings.js";
import { loadPendingStore, pendingEventsFromStore } from "../src/provisional-events.js";

const DEFAULTS = {
  events: "data/events.jsonl",
  pending: "data/pending-events.json",
  output: "RECENT-NAMINGS.md"
};

function parseLimit(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("--limit must be a positive integer");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set(["--events", "--pending", "--output", "--limit"]);
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
    const name = flag.slice(2);
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    values[name] = argv[++index];
    if (values[name] === "") {
      throw new Error(`${flag} value must not be empty`);
    }
  }
  return {
    check: values.check,
    eventsPath: values.events ?? DEFAULTS.events,
    pendingPath: values.pending ?? DEFAULTS.pending,
    outputPath: values.output ?? DEFAULTS.output,
    limit: values.limit === undefined ? undefined : parseLimit(values.limit)
  };
}

async function buildOutput(paths) {
  const [finalizedEvents, pendingStore] = await Promise.all([
    loadEventsJsonl(paths.eventsPath),
    loadPendingStore(paths.pendingPath)
  ]);
  return serializeRecentNamings(
    buildRecentNamings(
      finalizedEvents,
      pendingEventsFromStore(pendingStore),
      { limit: paths.limit }
    )
  );
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const expected = await buildOutput(args);
  if (args.check) {
    let actual;
    try {
      actual = await readFile(args.outputPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`recent namings feed is missing: ${args.outputPath}`);
      }
      throw error;
    }
    if (actual !== expected) {
      throw new Error(`recent namings feed is out of date: ${args.outputPath}`);
    }
    console.log("Validated recent namings feed.");
    return;
  }
  await writeFile(args.outputPath, expected, "utf8");
  console.log(`Generated recent namings feed: ${args.outputPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { parseArguments };
