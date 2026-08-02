import { getAddress } from "viem";

import { mergeEvents } from "./event-store.js";

function resolveMaxTransactions(value) {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("maxTransactions must be a positive safe integer");
  }
  return value;
}

/** Normalize an Ethereum transaction sender to viem's checksum format. */
export function normalizeNamer(value) {
  if (typeof value !== "string") {
    throw new TypeError("transaction sender must be an Ethereum address");
  }
  try {
    return getAddress(value);
  } catch {
    throw new TypeError("transaction sender must be an Ethereum address");
  }
}

/**
 * Enrich nonblank normalized events with transaction senders. Existing values
 * are reused, and one RPC transaction lookup serves every event in its hash.
 */
export async function enrichEventsWithNamers(client, events, options = {}) {
  if (!client || typeof client.getTransaction !== "function") {
    throw new TypeError("client must provide getTransaction");
  }
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("namer enrichment options must be an object");
  }

  const maxTransactions = resolveMaxTransactions(options.maxTransactions);
  const namerByTransaction = new Map();
  for (const event of events) {
    if (!Object.hasOwn(event, "namer")) {
      continue;
    }
    const namer = normalizeNamer(event.namer);
    const existing = namerByTransaction.get(event.transactionHash);
    if (existing !== undefined && existing !== namer) {
      throw new Error(`conflicting namers for transaction ${event.transactionHash}`);
    }
    namerByTransaction.set(event.transactionHash, namer);
  }

  const missingTransactions = [...new Set(
    events
      .filter((event) => event.decoded.status !== "blank" &&
        !Object.hasOwn(event, "namer"))
      .map((event) => event.transactionHash)
  )].sort();
  const fetchTransactions = missingTransactions
    .filter((transactionHash) => !namerByTransaction.has(transactionHash))
    .slice(0, maxTransactions);
  for (const transactionHash of fetchTransactions) {
    const transaction = await client.getTransaction({ hash: transactionHash });
    if (!transaction || transaction.from === undefined) {
      throw new TypeError(`RPC transaction ${transactionHash} did not include a sender`);
    }
    const namer = normalizeNamer(transaction.from);
    const existing = namerByTransaction.get(transactionHash);
    if (existing !== undefined && existing !== namer) {
      throw new Error(`conflicting namers for transaction ${transactionHash}`);
    }
    namerByTransaction.set(transactionHash, namer);
  }

  const enrichedEvents = events.map((event) => {
    if (event.decoded.status === "blank" || Object.hasOwn(event, "namer")) {
      return event;
    }
    const namer = namerByTransaction.get(event.transactionHash);
    return namer === undefined ? event : { ...event, namer };
  });
  const remainingTransactionCount = missingTransactions.filter((transactionHash) =>
    !namerByTransaction.has(transactionHash)
  ).length;
  return {
    events: mergeEvents([], enrichedEvents),
    fetchedTransactionCount: fetchTransactions.length,
    enrichedTransactionCount: fetchTransactions.length,
    enrichedEventCount: enrichedEvents.filter((event, index) =>
      Object.hasOwn(event, "namer") && !Object.hasOwn(events[index], "namer")
    ).length,
    remainingTransactionCount
  };
}
