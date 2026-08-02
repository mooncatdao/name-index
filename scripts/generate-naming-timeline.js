import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  aggregateNamingTimeline,
  serializeNamingTimeline
} from "../src/naming-timeline.js";
import { loadEventsJsonl } from "../src/event-store.js";

const DEFAULT_EVENTS = "data/events.jsonl";
const DEFAULT_OUTPUT = "data/timeline-monthly.json";

function parseArguments(argv) {
  const values = { check: false };
  const flags = new Set(["--events", "--output"]);
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
  const eventsInput = values.events ?? DEFAULT_EVENTS;
  const outputInput = values.output ?? DEFAULT_OUTPUT;
  const eventsPath = path.resolve(process.cwd(), eventsInput);
  const outputPath = path.resolve(process.cwd(), outputInput);
  return {
    check: values.check,
    eventsPath,
    outputPath,
    source: path.isAbsolute(eventsInput)
      ? path.relative(process.cwd(), eventsPath) || path.basename(eventsPath)
      : eventsInput
  };
}

async function buildOutput(paths) {
  const events = await loadEventsJsonl(paths.eventsPath);
  return serializeNamingTimeline(aggregateNamingTimeline(events, {
    source: paths.source
  }));
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  const expected = await buildOutput(paths);
  if (paths.check) {
    let actual;
    try {
      actual = await readFile(paths.outputPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`timeline artifact is missing: ${paths.outputPath}`);
      }
      throw error;
    }
    if (actual !== expected) {
      throw new Error(`timeline artifact is out of date: ${paths.outputPath}`);
    }
    console.log("Validated naming timeline artifact.");
    return;
  }
  await writeFile(paths.outputPath, expected, "utf8");
  console.log(`Generated naming timeline artifact: ${paths.outputPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

export { parseArguments };
