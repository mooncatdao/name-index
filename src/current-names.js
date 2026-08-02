import { MOONCAT_COUNT } from "./constants.js";
import { getRescueOrderByCatId } from "./cat-id-map.js";
import { mergeEvents } from "./event-store.js";
import { namedYearFromTimestamp } from "./timestamp-enrichment.js";

export class CurrentNameConflictError extends Error {
  constructor(catId) {
    super(`Multiple nonblank naming events assign CatID ${catId}`);
    this.name = "CurrentNameConflictError";
  }
}

function compareNamingEvents(left, right) {
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

function toCurrentNameRecord(event, rescueOrder, namedOrder) {
  return {
    catId: event.catId,
    rescueOrder,
    namedOrder,
    eventId: event.eventId,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    ...(Object.hasOwn(event, "transactionIndex")
      ? { transactionIndex: event.transactionIndex }
      : {}),
    nameRaw: event.nameRaw,
    status: event.decoded.status,
    ...(Object.hasOwn(event, "blockTimestamp")
      ? {
        blockTimestamp: event.blockTimestamp,
        namedYear: namedYearFromTimestamp(event.blockTimestamp)
      }
      : {}),
    ...(Object.hasOwn(event.decoded, "text")
      ? { text: event.decoded.text }
      : {})
  };
}

/** Derive current names without mutating or writing the canonical event history. */
export function deriveCurrentNames(events) {
  const orderedEvents = mergeEvents([], events);
  const assignmentsByCatId = new Map();

  for (const event of orderedEvents) {
    if (event.removed || event.decoded.status === "blank") {
      continue;
    }
    const rescueOrder = getRescueOrderByCatId(event.catId);
    if (assignmentsByCatId.has(event.catId)) {
      throw new CurrentNameConflictError(event.catId);
    }
    assignmentsByCatId.set(event.catId, { event, rescueOrder });
  }

  const namingOrder = [...assignmentsByCatId.values()]
    .sort((left, right) => compareNamingEvents(left.event, right.event));
  const recordsByCatId = new Map(
    namingOrder.map(({ event, rescueOrder }, index) => [
      event.catId,
      toCurrentNameRecord(event, rescueOrder, index + 1)
    ])
  );

  const currentNames = [...recordsByCatId.values()]
    .sort((left, right) => left.rescueOrder - right.rescueOrder);
  const namesByCatId = Object.fromEntries(
    [...recordsByCatId.keys()]
      .sort()
      .map((catId) => [catId, recordsByCatId.get(catId)])
  );
  const namesByRescueOrder = Array(MOONCAT_COUNT).fill(null);
  for (const record of currentNames) {
    namesByRescueOrder[record.rescueOrder] = record;
  }

  return { currentNames, namesByCatId, namesByRescueOrder };
}
