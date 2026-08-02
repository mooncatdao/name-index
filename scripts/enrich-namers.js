import path from "node:path";

import { loadEventsJsonl, saveEventsJsonl } from "../src/event-store.js";
import { createMoonCatPublicClient } from "../src/cat-named-logs.js";
import { saveCurrentNameArtifacts } from "../src/current-name-artifacts.js";
import { enrichEventsWithNamers } from "../src/namer-enrichment.js";

function parsePositiveInteger(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("--max-transactions must be a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("--max-transactions must be a positive integer");
  }
  return parsed;
}

function parseArguments(argv) {
  const values = {};
  const flags = new Set([
    "--events",
    "--max-transactions",
    "--current-names",
    "--names-by-cat-id",
    "--names-by-rescue-order",
    "--metadata",
    "--names-simple"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
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

  const eventsInput = values.events ?? "data/events.jsonl";
  const eventsPath = path.resolve(process.cwd(), eventsInput);
  const eventsSource = path.isAbsolute(eventsInput)
    ? path.relative(process.cwd(), eventsPath) || path.basename(eventsPath)
    : eventsInput;
  return {
    eventsPath,
    eventsSource,
    ...(Object.hasOwn(values, "max-transactions")
      ? { maxTransactions: parsePositiveInteger(values["max-transactions"]) }
      : {}),
    currentNamesPath: path.resolve(process.cwd(), values["current-names"] ?? "data/current-names.json"),
    namesByCatIdPath: path.resolve(process.cwd(), values["names-by-cat-id"] ?? "data/names-by-cat-id.json"),
    namesByRescueOrderPath: path.resolve(process.cwd(), values["names-by-rescue-order"] ?? "data/names-by-rescue-order.json"),
    metadataPath: path.resolve(process.cwd(), values.metadata ?? "data/metadata.json"),
    namesSimplePath: path.resolve(process.cwd(), values["names-simple"] ?? "data/names-simple.json")
  };
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  const rpcUrl = process.env.MOONCAT_RPC_URL || process.env.ETH_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error("MOONCAT_RPC_URL or ETH_RPC_URL is required");
  }
  const existingEvents = await loadEventsJsonl(paths.eventsPath);
  const enrichment = await enrichEventsWithNamers(
    createMoonCatPublicClient(rpcUrl),
    existingEvents,
    { maxTransactions: paths.maxTransactions }
  );
  const eventsChanged = JSON.stringify(existingEvents) !==
    JSON.stringify(enrichment.events);
  if (eventsChanged) {
    await saveEventsJsonl(paths.eventsPath, enrichment.events);
  }
  await saveCurrentNameArtifacts(enrichment.events, paths, {
    sourcePath: paths.eventsSource
  });
  process.stdout.write(`${JSON.stringify({
    ...paths,
    existingEventCount: existingEvents.length,
    persistedEventCount: enrichment.events.length,
    fetchedTransactionCount: enrichment.fetchedTransactionCount,
    enrichedTransactionCount: enrichment.enrichedTransactionCount,
    enrichedEventCount: enrichment.enrichedEventCount,
    remainingTransactionCount: enrichment.remainingTransactionCount,
    eventsChanged,
    artifactsWritten: true
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
