import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKFLOW_PATH = ".github/workflows/publish-naming-events.yml";

test("publishing workflow scopes the RPC secret only to the scanner step", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  const jobEnv = workflow.match(/  reconcile:\n[\s\S]*?    env:\n([\s\S]*?)    steps:/);
  assert.ok(jobEnv, "reconciliation job env block should exist");
  assert.doesNotMatch(jobEnv[1], /MOONCAT_RPC_URL/);
  assert.match(jobEnv[1], /CHECKPOINT_CACHE_KEY:/);

  const scannerStep = workflow.match(
    /      - name: Scan finalized naming events\n([\s\S]*?)(?=\n      - name:)/
  );
  assert.ok(scannerStep, "scanner step should exist");
  assert.match(scannerStep[1], /        env:\n          MOONCAT_RPC_URL: \$\{\{ secrets\.MOONCAT_RPC_URL \}\}/);
  assert.doesNotMatch(workflow.replace(scannerStep[0], ""), /MOONCAT_RPC_URL/);
});

test("provisional publication is not blocked by the delayed reconciliation lane", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  assert.doesNotMatch(workflow, /^concurrency:\n/m, "workflow-wide concurrency must not cover the reconciliation wait");
  const provisional = workflow.match(/  provisional:\n([\s\S]*?)(?=\n  reconcile:)/);
  const reconcile = workflow.match(/  reconcile:\n([\s\S]*)/);
  assert.ok(provisional, "provisional job should exist");
  assert.ok(reconcile, "reconciliation job should exist");
  assert.match(provisional[1], /    concurrency:\n      group: mooncat-naming-provisional-publish/);
  assert.match(reconcile[1], /    concurrency:\n      group: mooncat-naming-reconcile/);
  assert.notEqual(
    provisional[1].match(/group: ([^\n]+)/)[1],
    reconcile[1].match(/group: ([^\n]+)/)[1]
  );
  assert.match(provisional[1], /git fetch origin main/);
  assert.match(provisional[1], /git rebase origin\/main/);
  assert.match(provisional[1], /for attempt in 1 2 3/);
  assert.match(reconcile[1], /git fetch origin main/);
  assert.match(reconcile[1], /git rebase origin\/main/);
  assert.match(reconcile[1], /for attempt in 1 2 3/);
});

test("publishing workflow regenerates and publishes the naming timeline", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  const scanIndex = workflow.indexOf("- name: Scan finalized naming events");
  const reconcileIndex = workflow.indexOf("- name: Reconcile provisional naming events");
  const timelineIndex = workflow.indexOf("- name: Generate naming timeline");
  const validationIndex = workflow.indexOf("- name: Validate generated artifacts", reconcileIndex);
  assert.ok(scanIndex >= 0);
  assert.ok(reconcileIndex > scanIndex);
  assert.ok(timelineIndex > reconcileIndex);
  assert.ok(validationIndex > timelineIndex);
  assert.match(workflow.slice(timelineIndex, validationIndex), /run: npm run generate:naming-timeline/);

  const detectionMatches = [...workflow.matchAll(/generated_paths=\(([\s\S]*?)\n          \)/g)];
  const detection = detectionMatches.at(-1);
  assert.ok(detection, "generated path allowlist should exist");
  assert.match(detection[1], /data\/timeline-monthly\.json/);

  const stagingMatches = [...workflow.matchAll(/git add -- \\\n([\s\S]*?)\n          if git diff --cached/g)];
  const staging = stagingMatches.at(-1);
  assert.ok(staging, "git staging allowlist should exist");
  assert.match(staging[1], /data\/timeline-monthly\.json/);
});

test("repository dispatch publishes provisional artifacts before delayed reconciliation", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  assert.match(workflow, /provisional:\n    if: github\.event_name == 'repository_dispatch'/);
  const ingestIndex = workflow.indexOf("- name: Ingest provisional naming event");
  const liveIndex = workflow.indexOf("- name: Generate live naming artifacts");
  const provisionalCommitIndex = workflow.indexOf("chore: publish provisional MoonCat naming event");
  const reconcileJobIndex = workflow.indexOf("  reconcile:\n");
  assert.ok(ingestIndex >= 0);
  assert.ok(liveIndex > ingestIndex);
  assert.ok(provisionalCommitIndex > liveIndex);
  assert.ok(reconcileJobIndex > provisionalCommitIndex);
  assert.match(workflow, /PROVISIONAL_EVENT_JSON: \$\{\{ toJson\(github\.event\.client_payload\) \}\}/);

  const waitIndex = workflow.indexOf("- name: Wait for finalized reconciliation window");
  const checkoutIndex = workflow.indexOf("- name: Check out repository", reconcileJobIndex);
  const scanIndex = workflow.indexOf("- name: Scan finalized naming events");
  const reconcileIndex = workflow.indexOf("- name: Reconcile provisional naming events");
  assert.ok(waitIndex > reconcileJobIndex);
  assert.ok(checkoutIndex > waitIndex);
  assert.ok(scanIndex > checkoutIndex);
  assert.ok(reconcileIndex > scanIndex);
  assert.match(workflow.slice(waitIndex, checkoutIndex), /if: github\.event_name == 'repository_dispatch'/);
  assert.match(workflow.slice(checkoutIndex, scanIndex), /ref: main/);
});

test("workflow allowlists pending and live artifacts for both publication jobs", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  for (const file of [
    "data/pending-events.json",
    "data/current-names-live.json",
    "data/names-by-cat-id-live.json",
    "data/names-by-rescue-order-live.json",
    "data/names-simple-live.json",
    "data/names-timestamp-live.json",
    "data/metadata-live.json"
  ]) {
    const escaped = file.replaceAll(".", "\\.");
    assert.equal(workflow.match(new RegExp(escaped, "g"))?.length, 4, `${file} should be detected and staged in both paths`);
  }
});
