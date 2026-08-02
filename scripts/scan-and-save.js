import path from "node:path";

import { loadCheckpoint } from "../src/checkpoint.js";
import { createMoonCatPublicClient } from "../src/cat-named-logs.js";
import { runPersistentScan } from "../src/persistent-scanner.js";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--checkpoint" && flag !== "--events") {
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
  return {
    checkpointPath: path.resolve(process.cwd(), values.checkpoint ?? "state/checkpoint.json"),
    eventsPath: path.resolve(process.cwd(), values.events ?? "data/events.jsonl")
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
