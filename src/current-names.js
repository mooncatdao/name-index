import { MOONCAT_COUNT } from "./constants.js";
import { getRescueOrderByCatId } from "./cat-id-map.js";
import { mergeEvents } from "./event-store.js";

export class CurrentNameConflictError extends Error {
  constructor(catId) {
    super(`Multiple nonblank naming events assign CatID ${catId}`);
    this.name = "CurrentNameConflictError";
  }
}

function toCurrentNameRecord(event, rescueOrder) {
  return {
    catId: event.catId,
    rescueOrder,
    eventId: event.eventId,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    ...(Object.hasOwn(event, "transactionIndex")
      ? { transactionIndex: event.transactionIndex }
      : {}),
    nameRaw: event.nameRaw,
    status: event.decoded.status,
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
    assignmentsByCatId.set(
      event.catId,
      toCurrentNameRecord(event, rescueOrder)
    );
  }

  const currentNames = [...assignmentsByCatId.values()]
    .sort((left, right) => left.rescueOrder - right.rescueOrder);
  const namesByCatId = Object.fromEntries(
    [...assignmentsByCatId.keys()]
      .sort()
      .map((catId) => [catId, assignmentsByCatId.get(catId)])
  );
  const namesByRescueOrder = Array(MOONCAT_COUNT).fill(null);
  for (const record of currentNames) {
    namesByRescueOrder[record.rescueOrder] = record;
  }

  return { currentNames, namesByCatId, namesByRescueOrder };
}
