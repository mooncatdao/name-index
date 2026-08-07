import { getRescueOrderByCatId } from "./cat-id-map.js";
import { mergeEvents } from "./event-store.js";
import { NAME_STATUS } from "./name-decoder.js";
import { assertReconciliationMatch } from "./provisional-events.js";

export const RECENT_NAMINGS_LIMIT = 100;

function compareChainOrder(left, right) {
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

function compareNewest(left, right) {
  return compareChainOrder(right.event, left.event);
}

function isSuccessfulNonblank(event) {
  return event.removed === false && (
    event.decoded.status === NAME_STATUS.TEXT ||
    event.decoded.status === NAME_STATUS.REDACTED
  );
}

function mergeFinalizedAndPending(finalizedEvents, pendingEvents) {
  const finalized = mergeEvents([], finalizedEvents);
  const pending = mergeEvents([], pendingEvents);
  const finalizedById = new Map(
    finalized.map((event) => [event.eventId, event])
  );
  const pendingOnly = [];
  for (const pendingEvent of pending) {
    const finalizedEvent = finalizedById.get(pendingEvent.eventId);
    if (finalizedEvent) {
      assertReconciliationMatch(finalizedEvent, pendingEvent);
      continue;
    }
    pendingOnly.push(pendingEvent);
  }
  return {
    events: mergeEvents(finalized, pendingOnly),
    provisionalEventIds: new Set(pendingOnly.map((event) => event.eventId))
  };
}

/** Build the bounded, newest-first recent naming feed records. */
export function buildRecentNamings(
  finalizedEvents,
  pendingEvents,
  { limit = RECENT_NAMINGS_LIMIT } = {}
) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("recent namings limit must be a positive safe integer");
  }
  const { events, provisionalEventIds } = mergeFinalizedAndPending(
    finalizedEvents,
    pendingEvents
  );
  return events
    .filter(isSuccessfulNonblank)
    .map((event) => ({
      event,
      provisional: provisionalEventIds.has(event.eventId)
    }))
    .sort(compareNewest)
    .slice(0, limit);
}

function escapeTableCell(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\\", "&#92;")
    .replaceAll("|", "&#124;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("*", "&#42;")
    .replaceAll("_", "&#95;")
    .replaceAll("`", "&#96;")
    .replaceAll("~", "&#126;")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function formatUtcTime(event) {
  if (!Number.isSafeInteger(event.blockTimestamp)) {
    return "—";
  }
  const iso = new Date(event.blockTimestamp * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function formatMoonCat(event) {
  let rescueOrder;
  try {
    rescueOrder = getRescueOrderByCatId(event.catId);
  } catch {
    rescueOrder = undefined;
  }
  return rescueOrder === undefined
    ? `CatID ${event.catId}`
    : `CatID ${event.catId} · rescue order ${rescueOrder}`;
}

function shortenAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAddress(address) {
  if (!address) {
    return "—";
  }
  return `[${shortenAddress(address)}](https://etherscan.io/address/${address})`;
}

function formatTransaction(transactionHash) {
  return `[${shortenAddress(transactionHash)}](https://etherscan.io/tx/${transactionHash})`;
}

/** Serialize recent naming records as a deterministic human-readable Markdown table. */
export function serializeRecentNamings(records) {
  const lines = [
    "# Recent MoonCat Namings",
    "",
    "Latest successful nonblank naming events, newest first. Provisional rows may disappear or become finalized after reconciliation.",
    "",
    "| UTC time | Name | MoonCat | Status | Namer | Transaction |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const { event, provisional } of records) {
    lines.push(`| ${escapeTableCell(formatUtcTime(event))} | ${escapeTableCell(event.decoded.text)} | ${escapeTableCell(formatMoonCat(event))} | ${provisional ? "Provisional" : "Finalized"} | ${formatAddress(event.namer)} | ${formatTransaction(event.transactionHash)} |`);
  }
  if (records.length === 0) {
    lines.push("| — | No recent namings | — | — | — | — |");
  }
  return `${lines.join("\n")}\n`;
}

