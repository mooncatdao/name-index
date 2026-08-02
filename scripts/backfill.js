import path from "node:path";

import { loadCheckpoint } from "../src/checkpoint.js";
import { createMoonCatPublicClient } from "../src/cat-named-logs.js";
import { runBackfillBatch } from "../src/backfill.js";

const DEFAULT_EVENTS_SOURCE = "data/events.jsonl";

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(argv) {
  const values = { untilComplete: false };
  const flags = new Set([
    "--checkpoint",
    "--events",
    "--current-names",
    "--names-by-cat-id",
    "--names-by-rescue-order",
    "--metadata",
    "--names-simple"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--until-complete") {
      if (values.untilComplete) {
        throw new Error("--until-complete may be provided only once");
      }
      values.untilComplete = true;
      continue;
    }
    if (flag === "--max-blocks") {
      if (Object.hasOwn(values, "maxBlocks") || index + 1 >= argv.length) {
        throw new Error("--max-blocks requires exactly one value");
      }
      values.maxBlocks = parsePositiveInteger(argv[++index], "--max-blocks");
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
      throw new Error(`${flag} path must not be empty`);
    }
  }

  const eventsInput = values.events ?? DEFAULT_EVENTS_SOURCE;
  const eventsPath = path.resolve(process.cwd(), eventsInput);
  const eventsSource = path.isAbsolute(eventsInput)
    ? path.relative(process.cwd(), eventsPath) || path.basename(eventsPath)
    : eventsInput;
  return {
    untilComplete: values.untilComplete,
    ...(Object.hasOwn(values, "maxBlocks") ? { maxBlocks: values.maxBlocks } : {}),
    checkpointPath: path.resolve(process.cwd(), values.checkpoint ?? "state/checkpoint.json"),
    eventsPath,
    eventsSource,
    currentNamesPath: path.resolve(process.cwd(), values["current-names"] ?? "data/current-names.json"),
    namesByCatIdPath: path.resolve(process.cwd(), values["names-by-cat-id"] ?? "data/names-by-cat-id.json"),
    namesByRescueOrderPath: path.resolve(process.cwd(), values["names-by-rescue-order"] ?? "data/names-by-rescue-order.json"),
    metadataPath: path.resolve(process.cwd(), values.metadata ?? "data/metadata.json"),
    namesSimplePath: path.resolve(process.cwd(), values["names-simple"] ?? "data/names-simple.json")
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const rpcUrl = process.env.MOONCAT_RPC_URL || process.env.ETH_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("MOONCAT_RPC_URL or ETH_RPC_URL is required");
  }
  const client = createMoonCatPublicClient(rpcUrl);
  let checkpoint = await loadCheckpoint(args.checkpointPath);
  let result;
  let batchCount = 0;
  let stoppedForNoProgress = false;

  while (true) {
    result = await runBackfillBatch(client, checkpoint, args, {
      ...(Object.hasOwn(args, "maxBlocks") ? { maxBlocks: args.maxBlocks } : {}),
      updatedAt: new Date().toISOString()
    });
    batchCount += 1;
    if (!args.untilComplete || result.complete) {
      break;
    }
    const progress = result.checkpointAdvanced ||
      result.eventsChanged ||
      result.artifactsWritten;
    if (!progress) {
      stoppedForNoProgress = true;
      break;
    }
    checkpoint = result.proposedCheckpoint;
  }

  process.stdout.write(`${JSON.stringify({
    ...args,
    ...result,
    batchCount,
    stoppedForNoProgress
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
