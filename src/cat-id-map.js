import mapping from "../data/reference/cat-id-to-rescue-order.json" with {
  type: "json"
};

const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;
const rescueOrderByCatId = mapping.rescueOrderByCatId;
const catIdsByRescueOrder = mapping.catIdsByRescueOrder;

/** Normalize a bytes5 CatID to lowercase, 0x-prefixed form. */
export function normalizeCatId(value) {
  if (typeof value !== "string") {
    throw new TypeError("CatID must be a string");
  }

  const hex = value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
  const normalized = `0x${hex.toLowerCase()}`;
  if (!CAT_ID_PATTERN.test(normalized)) {
    throw new TypeError(
      "CatID must be exactly 5 bytes (10 hexadecimal characters)"
    );
  }
  return normalized;
}

function assertRescueOrder(rescueOrder) {
  if (typeof rescueOrder !== "number" || !Number.isInteger(rescueOrder)) {
    throw new TypeError("Rescue order must be an integer number");
  }
  if (rescueOrder < 0 || rescueOrder >= mapping.count) {
    throw new RangeError(
      `Rescue order must be between 0 and ${mapping.count - 1}`
    );
  }
}

/** Return the rescue order for a known CatID. */
export function getRescueOrderByCatId(value) {
  const catId = normalizeCatId(value);
  const rescueOrder = rescueOrderByCatId[catId];
  if (rescueOrder === undefined) {
    throw new RangeError(`Unknown CatID: ${catId}`);
  }
  return rescueOrder;
}

/** Return the normalized CatID at a rescue order. */
export function getCatIdByRescueOrder(rescueOrder) {
  assertRescueOrder(rescueOrder);
  return catIdsByRescueOrder[rescueOrder];
}

// Short aliases parallel the names used by the reference LibMoonCat bundle.
export const getRescueOrder = getRescueOrderByCatId;
export const getCatId = getCatIdByRescueOrder;

export const CAT_ID_MAP_COUNT = mapping.count;
