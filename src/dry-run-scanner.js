import {
  calculateFinalizedBlock,
  calculateResumeBlock,
  validateCheckpoint
} from "./checkpoint.js";
import { fetchCatNamedLogs } from "./cat-named-logs.js";

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

/**
 * Plan and execute one read-only naming scan. No checkpoint or dataset is
 * written; the proposed checkpoint is returned for caller inspection.
 */
export async function runDryRunScan(client, checkpoint, options = {}) {
  if (!client || typeof client.getBlockNumber !== "function") {
    throw new TypeError("client must provide getBlockNumber");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("scan options must be an object");
  }
  validateCheckpoint(checkpoint);
  const currentCheckpoint = cloneCheckpoint(checkpoint);
  const latestBlock = toSafeLatestBlock(await client.getBlockNumber());
  const finalizedBlock = calculateFinalizedBlock(latestBlock, checkpoint);
  const resumeBlock = calculateResumeBlock(checkpoint);
  const hasWork = finalizedBlock >= resumeBlock;
  const events = hasWork
    ? await fetchCatNamedLogs(client, {
      fromBlock: BigInt(resumeBlock),
      toBlock: BigInt(finalizedBlock),
      chunkSize: BigInt(checkpoint.chunkSize)
    })
    : [];

  const proposedCheckpoint = {
    ...currentCheckpoint,
    lastScannedBlock: Math.max(
      currentCheckpoint.lastScannedBlock,
      finalizedBlock
    ),
    lastFinalizedBlock: Math.max(
      currentCheckpoint.lastFinalizedBlock,
      finalizedBlock
    )
  };
  if (Object.hasOwn(options, "updatedAt")) {
    proposedCheckpoint.updatedAt = options.updatedAt;
  }
  validateCheckpoint(proposedCheckpoint);

  return {
    latestBlock,
    finalizedBlock,
    resumeBlock,
    queriedFromBlock: resumeBlock,
    queriedToBlock: finalizedBlock,
    eventCount: events.length,
    events,
    currentCheckpoint,
    proposedCheckpoint
  };
}
