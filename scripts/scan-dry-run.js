import path from "node:path";

import { loadCheckpoint } from "../src/checkpoint.js";
import {
  createMoonCatPublicClient
} from "../src/cat-named-logs.js";
import { runDryRunScan } from "../src/dry-run-scanner.js";

function parseArguments(argv) {
  let checkpointPath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--checkpoint") {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
    if (checkpointPath !== undefined || index + 1 >= argv.length) {
      throw new Error("--checkpoint requires exactly one value");
    }
    checkpointPath = argv[++index];
    if (checkpointPath === "") {
      throw new Error("--checkpoint path must not be empty");
    }
  }
  return checkpointPath === undefined
    ? path.resolve(process.cwd(), "state", "checkpoint.json")
    : path.resolve(process.cwd(), checkpointPath);
}

async function main() {
  const checkpointPath = parseArguments(process.argv.slice(2));
  const rpcUrl = process.env.MOONCAT_RPC_URL || process.env.ETH_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("MOONCAT_RPC_URL or ETH_RPC_URL is required");
  }
  const checkpoint = await loadCheckpoint(checkpointPath);
  const client = createMoonCatPublicClient(rpcUrl);
  const result = await runDryRunScan(client, checkpoint);
  process.stdout.write(`${JSON.stringify({ checkpointPath, ...result })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error)
  })}\n`);
  process.exitCode = 1;
}
