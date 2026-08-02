const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CAT_ID_PATTERN = /^0x[0-9a-fA-F]{10}$/i;

/** The all-zero bytes32 value skipped by the historical naming extractor. */
export const BLANK_NAME = `0x${"0".repeat(64)}`;

/** Stable result statuses returned by decodeMoonCatName(). */
export const NAME_STATUS = Object.freeze({
  BLANK: "blank",
  TEXT: "text",
  INVALID_UTF8: "invalid-utf8",
  LEADING_NULL: "leading-null",
  REDACTED: "redacted"
});

export const REDACTED_CAT_ID = "0x0008d4ecd0";
export const REDACTED_CAT_IDS = new Set([REDACTED_CAT_ID]);
const REPLACEMENT_CHARACTER = "\ufffd";

function normalizeBytes32(value) {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    throw new TypeError("rawName must be a 0x-prefixed 32-byte hexadecimal string");
  }
  return value.toLowerCase();
}

function normalizeCatId(value) {
  if (typeof value !== "string" || !CAT_ID_PATTERN.test(value)) {
    throw new TypeError("catId must be a 0x-prefixed bytes5 hexadecimal string");
  }
  return value.toLowerCase();
}

function hexToBytes(rawName) {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(rawName.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

function getOptions(options) {
  if (options === undefined) {
    return {};
  }
  if (typeof options === "string") {
    return { catId: options };
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("decoder options must be an object or CatID string");
  }
  return options;
}

function isRedacted(catId, redactedCatIds) {
  if (!redactedCatIds || typeof redactedCatIds[Symbol.iterator] !== "function") {
    throw new TypeError("redactedCatIds must be an iterable of CatIDs");
  }
  const normalizedCatId = catId === undefined ? undefined : normalizeCatId(catId);
  for (const candidate of redactedCatIds) {
    if (normalizeCatId(candidate) === normalizedCatId) {
      return true;
    }
  }
  return false;
}

/**
 * Decode an on-chain bytes32 MoonCat name without losing its raw value.
 *
 * The returned shape is `{ rawName, status }` for non-text results and
 * `{ rawName, status, text }` when status is `text` or `redacted`. `rawName`
 * is canonical lowercase hex. Options may contain `catId` and an iterable
 * `redactedCatIds`; passing a CatID string is shorthand for `{ catId }`.
 */
export function decodeMoonCatName(rawName, options) {
  const normalizedRawName = normalizeBytes32(rawName);
  const { catId, redactedCatIds = REDACTED_CAT_IDS } = getOptions(options);

  if (normalizedRawName === BLANK_NAME) {
    return { rawName: normalizedRawName, status: NAME_STATUS.BLANK };
  }

  if (isRedacted(catId, redactedCatIds)) {
    return {
      rawName: normalizedRawName,
      status: NAME_STATUS.REDACTED,
      text: REPLACEMENT_CHARACTER
    };
  }

  const bytes = hexToBytes(normalizedRawName);
  const firstNull = bytes.indexOf(0);
  if (firstNull === 0) {
    return { rawName: normalizedRawName, status: NAME_STATUS.LEADING_NULL };
  }

  const textBytes = firstNull === -1 ? bytes : bytes.slice(0, firstNull);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(textBytes);
    return { rawName: normalizedRawName, status: NAME_STATUS.TEXT, text };
  } catch {
    return { rawName: normalizedRawName, status: NAME_STATUS.INVALID_UTF8 };
  }
}
