import {
  calculateFinalizedBlock,
  calculateResumeBlock,
  validateCheckpoint
} from "./checkpoint.js";
import { fetchCatNamedLogs } from "./cat-named-logs.js";
import { runPersistentScan } from "./persistent-scanner.js";

export const DEFAULT_BACKFILL_MAX_BLOCKS = 100_000;

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function toSafeLatestBlock(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("latest block is outside the safe integer range");
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new TypeError("client.getBlockNumber() must return a safe block number");
}

function cloneCheckpoint(checkpoint) {
  return { ...checkpoint };
}

function getInitialResumeBlock(checkpoint) {
  const initialBoundary = checkpoint.startBlock - 1;
  if (checkpoint.lastScannedBlock === initialBoundary &&
      checkpoint.lastFinalizedBlock === initialBoundary) {
    return checkpoint.startBlock;
  }
  return calculateResumeBlock(checkpoint);
}

function resolveOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("backfill options must be an object");
  }
  const maxBlocks = options.maxBlocks ?? DEFAULT_BACKFILL_MAX_BLOCKS;
  assertPositiveSafeInteger(maxBlocks, "maxBlocks");
  const dependencies = options.dependencies ?? {};
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new TypeError("backfill dependencies must be an object");
  }
  return { maxBlocks, dependencies };
}

/**
 * Scan and persist one bounded, finalized backfill window.
 *
 * The bounded scan supplies its events and proposed checkpoint to the normal
 * persistent scanner, which remains the sole owner of durable write ordering.
 */
export async function runBackfillBatch(client, checkpoint, paths, options = {}) {
  validateCheckpoint(checkpoint);
  const { maxBlocks, dependencies } = resolveOptions(options);
  if (!client || typeof client !== "object") {
    throw new TypeError("client must provide getBlockNumber");
  }

  const fetchLogs = dependencies.fetchCatNamedLogs ?? fetchCatNamedLogs;
  const persist = dependencies.runPersistentScan ?? runPersistentScan;
  const getLatestBlock = dependencies.getBlockNumber ?? (
    (scanClient) => scanClient.getBlockNumber()
  );
  if (!dependencies.getBlockNumber && typeof client.getBlockNumber !== "function") {
    throw new TypeError("client must provide getBlockNumber");
  }
  if (typeof fetchLogs !== "function") {
    throw new TypeError("fetchCatNamedLogs dependency must be a function");
  }
  if (typeof persist !== "function") {
    throw new TypeError("runPersistentScan dependency must be a function");
  }
  if (typeof getLatestBlock !== "function") {
    throw new TypeError("getBlockNumber dependency must be a function");
  }

  const boundedScan = async (scanClient, currentCheckpoint, scanOptions = {}) => {
    validateCheckpoint(currentCheckpoint);
    const latestBlock = toSafeLatestBlock(await getLatestBlock(scanClient));
    const finalizedBlock = calculateFinalizedBlock(latestBlock, currentCheckpoint);
    const resumeBlock = getInitialResumeBlock(currentCheckpoint);
    const hasWork = finalizedBlock >= resumeBlock;
    const batchFromBlock = hasWork ? resumeBlock : null;
    const batchToBlock = hasWork
      ? Math.min(finalizedBlock, resumeBlock + maxBlocks - 1)
      : null;
    const events = hasWork
      ? await fetchLogs(scanClient, {
        fromBlock: BigInt(batchFromBlock),
        toBlock: BigInt(batchToBlock),
        chunkSize: BigInt(currentCheckpoint.chunkSize)
      })
      : [];
    const proposedCheckpoint = {
      ...cloneCheckpoint(currentCheckpoint),
      lastScannedBlock: hasWork
        ? Math.max(currentCheckpoint.lastScannedBlock, batchToBlock)
        : currentCheckpoint.lastScannedBlock,
      lastFinalizedBlock: hasWork
        ? Math.max(currentCheckpoint.lastFinalizedBlock, batchToBlock)
        : currentCheckpoint.lastFinalizedBlock
    };
    if (Object.hasOwn(scanOptions, "updatedAt")) {
      proposedCheckpoint.updatedAt = scanOptions.updatedAt;
    }
    validateCheckpoint(proposedCheckpoint);

    return {
      latestBlock,
      finalizedBlock,
      resumeBlock,
      queriedFromBlock: batchFromBlock,
      queriedToBlock: batchToBlock,
      batchFromBlock,
      batchToBlock,
      scannedBlockCount: hasWork ? batchToBlock - batchFromBlock + 1 : 0,
      eventCount: events.length,
      events,
      currentCheckpoint: cloneCheckpoint(currentCheckpoint),
      proposedCheckpoint
    };
  };

  const persistentDependencies = {
    ...dependencies,
    runDryRunScan: boundedScan
  };
  const { dependencies: _ignoredDependencies, ...persistentOptions } = options;
  const persisted = await persist(client, checkpoint, paths, {
    ...persistentOptions,
    dependencies: persistentDependencies
  });
  const complete = persisted.batchToBlock === null ||
    persisted.batchToBlock >= persisted.finalizedBlock;

  return {
    ...persisted,
    batchFromBlock: persisted.batchFromBlock,
    batchToBlock: persisted.batchToBlock,
    finalizedBlock: persisted.finalizedBlock,
    scannedBlockCount: persisted.scannedBlockCount,
    eventCount: persisted.eventCount,
    checkpointAdvanced: persisted.checkpointAdvanced,
    complete,
    nextResumeBlock: calculateResumeBlock(persisted.proposedCheckpoint)
  };
}
