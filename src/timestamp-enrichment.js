import { mergeEvents } from "./event-store.js";

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}

function normalizeTimestamp(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("block timestamp is outside the safe integer range");
    }
    return Number(value);
  }
  assertSafeInteger(value, "block timestamp");
  return value;
}

function resolveMaxBlocks(value) {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  assertSafeInteger(value, "maxBlocks");
  return value;
}

/**
 * Enrich nonblank normalized events with cached block timestamps.
 * Existing timestamps are trusted after event validation and are never fetched
 * again; missing events in the same block share one RPC getBlock call.
 */
export async function enrichEventsWithBlockTimestamps(client, events, options = {}) {
  if (!client || typeof client.getBlock !== "function") {
    throw new TypeError("client must provide getBlock");
  }
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("timestamp enrichment options must be an object");
  }

  const maxBlocks = resolveMaxBlocks(options.maxBlocks);
  const timestampByBlock = new Map();
  for (const event of events) {
    if (Object.hasOwn(event, "blockTimestamp")) {
      const timestamp = normalizeTimestamp(event.blockTimestamp);
      const existing = timestampByBlock.get(event.blockNumber);
      if (existing !== undefined && existing !== timestamp) {
        throw new Error(`conflicting timestamps for block ${event.blockNumber}`);
      }
      timestampByBlock.set(event.blockNumber, timestamp);
    }
  }

  const missingBlocks = [...new Set(
    events
      .filter((event) => event.decoded.status !== "blank" &&
        !Object.hasOwn(event, "blockTimestamp"))
      .map((event) => event.blockNumber)
  )].sort((left, right) => left - right);
  const fetchBlocks = missingBlocks.filter((blockNumber) =>
    !timestampByBlock.has(blockNumber)
  ).slice(0, maxBlocks);
  for (const blockNumber of fetchBlocks) {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
    if (!block || block.timestamp === undefined) {
      throw new TypeError(`RPC block ${blockNumber} did not include a timestamp`);
    }
    timestampByBlock.set(blockNumber, normalizeTimestamp(block.timestamp));
  }

  const enrichedEvents = events.map((event) => {
    if (event.decoded.status === "blank" ||
        Object.hasOwn(event, "blockTimestamp")) {
      return event;
    }
    const blockTimestamp = timestampByBlock.get(event.blockNumber);
    return blockTimestamp === undefined
      ? event
      : { ...event, blockTimestamp };
  });
  const enrichedBlockNumbers = new Set(fetchBlocks);
  for (const event of enrichedEvents) {
    if (Object.hasOwn(event, "blockTimestamp") &&
        !Object.hasOwn(events.find((candidate) => candidate.eventId === event.eventId), "blockTimestamp")) {
      enrichedBlockNumbers.add(event.blockNumber);
    }
  }
  const remainingBlockCount = missingBlocks.filter((blockNumber) =>
    !timestampByBlock.has(blockNumber)
  ).length;
  return {
    events: mergeEvents([], enrichedEvents),
    fetchedBlockCount: fetchBlocks.length,
    enrichedBlockCount: enrichedBlockNumbers.size,
    enrichedEventCount: enrichedEvents.filter((event, index) =>
      Object.hasOwn(event, "blockTimestamp") &&
      !Object.hasOwn(events[index], "blockTimestamp")
    ).length,
    remainingBlockCount
  };
}

export function namedYearFromTimestamp(blockTimestamp) {
  const timestamp = normalizeTimestamp(blockTimestamp);
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("block timestamp cannot produce a valid UTC date");
  }
  const year = date.getUTCFullYear();
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError("named year must be a four-digit UTC year");
  }
  return year;
}
