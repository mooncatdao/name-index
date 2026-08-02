import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import {
  CAT_NAMED_EVENT,
  MOONCAT_RESCUE_ADDRESS
} from "./constants.js";
import { decodeMoonCatName } from "./name-decoder.js";

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/i;
const NAME_RAW_PATTERN = /^0x[0-9a-f]{64}$/i;

/** Thrown when two logs claim one event ID but contain different data. */
export class CatNamedLogConflictError extends Error {
  constructor(eventId) {
    super(`Conflicting CatNamed logs share eventId ${eventId}`);
    this.name = "CatNamedLogConflictError";
  }
}

function assertSafeBlockValue(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`${label} is outside the safe integer range`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new TypeError(`${label} must be a nonnegative safe integer or bigint`);
}

function assertBigInt(value, label) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError(`${label} must be a nonnegative bigint`);
  }
}

/** Create an Ethereum mainnet viem public client for a non-empty HTTP URL. */
export function createMoonCatPublicClient(rpcUrl) {
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
    throw new TypeError("rpcUrl must be a non-empty URL");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(rpcUrl.trim());
  } catch {
    throw new TypeError("rpcUrl must be a valid HTTP(S) URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new TypeError("rpcUrl must be a valid HTTP(S) URL");
  }
  return createPublicClient({
    chain: mainnet,
    transport: http(parsedUrl.toString())
  });
}

/** Create inclusive bigint ranges with no gaps or overlap. */
export function createBlockRanges(fromBlock, toBlock, chunkSize) {
  assertBigInt(fromBlock, "fromBlock");
  assertBigInt(toBlock, "toBlock");
  assertBigInt(chunkSize, "chunkSize");
  if (chunkSize <= 0n) {
    throw new RangeError("chunkSize must be positive");
  }
  if (toBlock < fromBlock) {
    throw new RangeError("toBlock must be greater than or equal to fromBlock");
  }

  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    ranges.push({
      fromBlock: start,
      toBlock: start + chunkSize - 1n > toBlock
        ? toBlock
        : start + chunkSize - 1n
    });
  }
  return ranges;
}

function normalizeHex(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} must be a correctly sized hexadecimal string`);
  }
  return value.toLowerCase();
}

function normalizeLog(log) {
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new TypeError("CatNamed log must be an object");
  }
  const transactionHash = normalizeHex(
    log.transactionHash,
    TX_HASH_PATTERN,
    "transactionHash"
  );
  const logIndex = assertSafeBlockValue(log.logIndex, "logIndex");
  const blockNumber = assertSafeBlockValue(log.blockNumber, "blockNumber");
  const transactionIndex = log.transactionIndex === undefined
    ? undefined
    : assertSafeBlockValue(log.transactionIndex, "transactionIndex");
  if (!log.args || typeof log.args !== "object") {
    throw new TypeError("CatNamed log args are required");
  }
  const catId = normalizeHex(log.args.catId, CAT_ID_PATTERN, "args.catId");
  const nameRaw = normalizeHex(log.args.catName, NAME_RAW_PATTERN, "args.catName");
  if (log.removed !== undefined && typeof log.removed !== "boolean") {
    throw new TypeError("removed must be boolean when present");
  }

  const event = {
    eventId: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber,
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
    catId,
    nameRaw,
    removed: log.removed ?? false,
    decoded: decodeMoonCatName(nameRaw, { catId })
  };
  return event;
}

function compareEvents(left, right) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }
  const leftHasTransactionIndex = left.transactionIndex !== undefined;
  const rightHasTransactionIndex = right.transactionIndex !== undefined;
  if (leftHasTransactionIndex && rightHasTransactionIndex &&
      left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  if (leftHasTransactionIndex !== rightHasTransactionIndex) {
    return leftHasTransactionIndex ? -1 : 1;
  }
  if (left.logIndex !== right.logIndex) {
    return left.logIndex - right.logIndex;
  }
  return left.eventId.localeCompare(right.eventId);
}

/** Fetch, normalize, sort, and overlap-deduplicate CatNamed logs. */
export async function fetchCatNamedLogs(client, {
  fromBlock,
  toBlock,
  chunkSize
}) {
  if (!client || typeof client.getLogs !== "function") {
    throw new TypeError("client must provide getLogs");
  }
  const ranges = createBlockRanges(fromBlock, toBlock, chunkSize);
  const byEventId = new Map();

  for (const range of ranges) {
    const logs = await client.getLogs({
      address: MOONCAT_RESCUE_ADDRESS,
      event: CAT_NAMED_EVENT,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock
    });
    if (!Array.isArray(logs)) {
      throw new TypeError("client.getLogs must return an array");
    }
    for (const log of logs) {
      const event = normalizeLog(log);
      const existing = byEventId.get(event.eventId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) {
          throw new CatNamedLogConflictError(event.eventId);
        }
      } else {
        byEventId.set(event.eventId, event);
      }
    }
  }

  return [...byEventId.values()].sort(compareEvents);
}
