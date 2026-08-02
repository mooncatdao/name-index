const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function isValidTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function monthFromTimestamp(timestamp) {
  if (!isValidTimestamp(timestamp)) {
    return null;
  }
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthToDate(month) {
  if (!MONTH_PATTERN.test(month)) {
    throw new TypeError(`invalid YYYY-MM month: ${month}`);
  }
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

function monthsBetween(firstMonth, lastMonth) {
  const first = monthToDate(firstMonth);
  const last = monthToDate(lastMonth);
  const months = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${String(cursor.getUTCFullYear()).padStart(4, "0")}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** Aggregate canonical naming events into deterministic UTC calendar months. */
export function aggregateNamingTimeline(events, options = {}) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("timeline options must be an object");
  }
  const source = options.source ?? "data/events.jsonl";
  if (typeof source !== "string" || source === "") {
    throw new TypeError("timeline source must be a non-empty string");
  }

  const counts = new Map();
  let includedEventCount = 0;
  let excludedBlankCount = 0;
  let excludedRemovedCount = 0;
  let missingTimestampCount = 0;
  for (const event of events) {
    if (event?.decoded?.status === "blank") {
      excludedBlankCount += 1;
      continue;
    }
    if (event?.removed !== false) {
      if (event?.removed === true) {
        excludedRemovedCount += 1;
      }
      continue;
    }
    const month = monthFromTimestamp(event?.blockTimestamp);
    if (month === null) {
      missingTimestampCount += 1;
      continue;
    }
    counts.set(month, (counts.get(month) ?? 0) + 1);
    includedEventCount += 1;
  }

  const sortedMonths = [...counts.keys()].sort();
  const firstMonth = sortedMonths[0] ?? null;
  const lastMonth = sortedMonths.at(-1) ?? null;
  const monthly = firstMonth === null
    ? []
    : monthsBetween(firstMonth, lastMonth).map((month) => ({
      month,
      count: counts.get(month) ?? 0
    }));
  return {
    schemaVersion: 1,
    source,
    metric: "successful-nonblank-namings",
    granularity: "month",
    generatedFromEventCount: events.length,
    includedEventCount,
    excludedBlankCount,
    excludedRemovedCount,
    missingTimestampCount,
    firstMonth,
    lastMonth,
    monthly
  };
}

export function serializeNamingTimeline(timeline) {
  return `${JSON.stringify(timeline, null, 2)}\n`;
}
