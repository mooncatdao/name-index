/** Ethereum mainnet chain ID. */
export const CHAIN_ID = 1;

/** Original MoonCatRescue contract. */
export const MOONCAT_RESCUE_ADDRESS =
  "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6";

/** First block scanned by the existing MoonCat naming snapshot script. */
export const NAMING_START_BLOCK = 4_140_409n;

/** Total number of rescued MoonCats. */
export const MOONCAT_COUNT = 25_440;

/** Inclusive rescue-order bounds. */
export const MIN_RESCUE_ORDER = 0;
export const MAX_RESCUE_ORDER = MOONCAT_COUNT - 1;

/** Event signature used to retrieve naming logs. */
export const CAT_NAMED_EVENT = {
  type: "event",
  name: "CatNamed",
  inputs: [
    { indexed: true, name: "catId", type: "bytes5" },
    { indexed: false, name: "catName", type: "bytes32" }
  ]
};

/** Storage getter used for future current-state reconciliation. */
export const CAT_NAMES_FUNCTION = {
  type: "function",
  name: "catNames",
  stateMutability: "view",
  inputs: [{ name: "", type: "bytes5" }],
  outputs: [{ name: "", type: "bytes32" }]
};

export const MOONCAT_NAMING_ABI = [CAT_NAMED_EVENT, CAT_NAMES_FUNCTION];
