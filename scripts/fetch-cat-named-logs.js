import {
  createMoonCatPublicClient,
  fetchCatNamedLogs
} from "../src/cat-named-logs.js";

const DEFAULT_CHUNK_SIZE = 10_000n;

function parseBlockArgument(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a nonnegative decimal integer`);
  }
  return BigInt(value);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const name = flag === "--chunk-size" ? "chunkSize" : flag.slice(2);
    if (!["from", "to", "chunkSize"].includes(name) || !flag.startsWith("--")) {
      throw new Error(`unknown argument: ${flag}`);
    }
    if (Object.hasOwn(values, name) || index + 1 >= argv.length) {
      throw new Error(`missing or duplicate value for ${flag}`);
    }
    values[name] = argv[++index];
  }
  if (values.from === undefined || values.to === undefined) {
    throw new Error("--from and --to are required");
  }
  return {
    fromBlock: parseBlockArgument(values.from, "--from"),
    toBlock: parseBlockArgument(values.to, "--to"),
    chunkSize: parseBlockArgument(values.chunkSize ?? DEFAULT_CHUNK_SIZE.toString(), "--chunk-size")
  };
}

async function main() {
  const range = parseArguments(process.argv.slice(2));
  const rpcUrl = process.env.MOONCAT_RPC_URL || process.env.ETH_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("MOONCAT_RPC_URL or ETH_RPC_URL is required");
  }
  const client = createMoonCatPublicClient(rpcUrl);
  const events = await fetchCatNamedLogs(client, range);
  process.stdout.write(`${JSON.stringify({
    fromBlock: range.fromBlock.toString(),
    toBlock: range.toBlock.toString(),
    eventCount: events.length,
    events
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
