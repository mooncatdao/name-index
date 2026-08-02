import path from "node:path";

import { loadCheckpoint } from "../src/checkpoint.js";
import { createMoonCatPublicClient } from "../src/cat-named-logs.js";
import { runPersistentScan } from "../src/persistent-scanner.js";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--checkpoint", "--events", "--current-names", "--names-by-cat-id", "--names-by-rescue-order", "--metadata"].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const name = flag.slice(2);
    if (Object.hasOwn(values, name) || index + 1 >= argv.length) {
      throw new Error(`${flag} requires exactly one value`);
    }
    values[name] = argv[++index];
    if (values[name] === "") {
      throw new Error(`${flag} path must not be empty`);
    }
  }
  const eventsInput = values.events ?? "data/events.jsonl";
  const eventsPath = path.resolve(process.cwd(), eventsInput);
  const eventsSource = path.isAbsolute(eventsInput)
    ? path.relative(process.cwd(), eventsPath) || path.basename(eventsPath)
    : eventsInput;
  return {
    checkpointPath: path.resolve(process.cwd(), values.checkpoint ?? "state/checkpoint.json"),
    eventsPath,
    eventsSource,
    currentNamesPath: path.resolve(process.cwd(), values["current-names"] ?? "data/current-names.json"),
    namesByCatIdPath: path.resolve(process.cwd(), values["names-by-cat-id"] ?? "data/names-by-cat-id.json"),
    namesByRescueOrderPath: path.resolve(process.cwd(), values["names-by-rescue-order"] ?? "data/names-by-rescue-order.json"),
    metadataPath: path.resolve(process.cwd(), values.metadata ?? "data/metadata.json")
  };
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  const rpcUrl = process.env.MOONCAT_RPC_URL || process.env.ETH_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("MOONCAT_RPC_URL or ETH_RPC_URL is required");
  }
  const checkpoint = await loadCheckpoint(paths.checkpointPath);
  const result = await runPersistentScan(
    createMoonCatPublicClient(rpcUrl),
    checkpoint,
    paths,
    { updatedAt: new Date().toISOString() }
  );
  process.stdout.write(`${JSON.stringify({ ...paths, ...result })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error)
  })}\n`);
  process.exitCode = 1;
}
