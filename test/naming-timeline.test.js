import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  aggregateNamingTimeline,
  serializeNamingTimeline
} from "../src/naming-timeline.js";

const RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const BLANK = `0x${"0".repeat(64)}`;

function event({ id, timestamp, status = "text", removed = false }) {
  const transactionHash = `0x${id.repeat(64).slice(0, 64)}`;
  return {
    eventId: `${transactionHash}:0`,
    transactionHash,
    logIndex: 0,
    blockNumber: 1,
    transactionIndex: 0,
    catId: "0x00d8523a53",
    nameRaw: status === "blank" ? BLANK : RAW,
    removed,
    decoded: status === "blank"
      ? { rawName: BLANK, status: "blank" }
      : { rawName: RAW, status: "text", text: "cat" },
    ...(timestamp === undefined ? {} : { blockTimestamp: timestamp })
  };
}

test("aggregates UTC months, fills gaps, and excludes non-qualifying events", () => {
  const result = aggregateNamingTimeline([
    event({ id: "a", timestamp: Date.UTC(2020, 2, 1) / 1000 }),
    event({ id: "b", timestamp: Date.UTC(2020, 0, 31, 23, 59) / 1000 }),
    event({ id: "c", status: "blank", timestamp: Date.UTC(2020, 1, 1) / 1000 }),
    event({ id: "d", removed: true, timestamp: Date.UTC(2020, 3, 1) / 1000 }),
    event({ id: "e" }),
    event({ id: "f", timestamp: 1.5 })
  ], { source: "fixture/events.jsonl" });

  assert.deepEqual(result, {
    schemaVersion: 1,
    source: "fixture/events.jsonl",
    metric: "successful-nonblank-namings",
    granularity: "month",
    generatedFromEventCount: 6,
    includedEventCount: 2,
    excludedBlankCount: 1,
    excludedRemovedCount: 1,
    missingTimestampCount: 2,
    firstMonth: "2020-01",
    lastMonth: "2020-03",
    monthly: [
      { month: "2020-01", count: 1 },
      { month: "2020-02", count: 0 },
      { month: "2020-03", count: 1 }
    ]
  });
});

test("aggregation and serialization are deterministic and do not mutate input", () => {
  const events = [event({ id: "b", timestamp: Date.UTC(2021, 0, 1) / 1000 }), event({ id: "a", timestamp: Date.UTC(2020, 11, 31) / 1000 })];
  const before = JSON.stringify(events);
  const first = serializeNamingTimeline(aggregateNamingTimeline(events));
  const second = serializeNamingTimeline(aggregateNamingTimeline(events));
  assert.equal(first, second);
  assert.equal(JSON.stringify(events), before);
});

test("generator check mode validates exact bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "name-index-timeline-"));
  const eventsPath = path.join(directory, "events.jsonl");
  const outputPath = path.join(directory, "timeline.json");
  const events = [event({ id: "a", timestamp: Date.UTC(2022, 5, 1) / 1000 })];
  await writeFile(eventsPath, `${JSON.stringify(events[0])}\n`, "utf8");
  const args = ["scripts/generate-naming-timeline.js", "--events", eventsPath, "--output", outputPath];
  let result = spawnSync(process.execPath, args, { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync(process.execPath, [...args, "--check"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await writeFile(outputPath, `${await readFile(outputPath, "utf8")}\n`, "utf8");
  result = spawnSync(process.execPath, [...args, "--check"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  await rm(directory, { recursive: true, force: true });
});
