import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKFLOW_PATH = ".github/workflows/publish-naming-events.yml";

test("publishing workflow scopes the RPC secret only to the scanner step", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  const jobEnv = workflow.match(/jobs:\n  update:\n[\s\S]*?    env:\n([\s\S]*?)    steps:/);
  assert.ok(jobEnv, "job-level env block should exist");
  assert.doesNotMatch(jobEnv[1], /MOONCAT_RPC_URL/);
  assert.match(jobEnv[1], /CHECKPOINT_CACHE_KEY:/);

  const scannerStep = workflow.match(
    /      - name: Scan finalized naming events\n([\s\S]*?)(?=\n      - name:)/
  );
  assert.ok(scannerStep, "scanner step should exist");
  assert.match(scannerStep[1], /        env:\n          MOONCAT_RPC_URL: \$\{\{ secrets\.MOONCAT_RPC_URL \}\}/);
  assert.doesNotMatch(workflow.replace(scannerStep[0], ""), /MOONCAT_RPC_URL/);
});

test("publishing workflow regenerates and publishes the naming timeline", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");
  const scanIndex = workflow.indexOf("- name: Scan finalized naming events");
  const timelineIndex = workflow.indexOf("- name: Generate naming timeline");
  const validationIndex = workflow.indexOf("- name: Validate generated artifacts");
  assert.ok(scanIndex >= 0);
  assert.ok(timelineIndex > scanIndex);
  assert.ok(validationIndex > timelineIndex);
  assert.match(workflow.slice(timelineIndex, validationIndex), /run: npm run generate:naming-timeline/);

  const detection = workflow.match(/generated_paths=\(([\s\S]*?)\n          \)/);
  assert.ok(detection, "generated path allowlist should exist");
  assert.match(detection[1], /data\/timeline-monthly\.json/);

  const staging = workflow.match(/git add -- \\\n([\s\S]*?)\n          if git diff --cached/);
  assert.ok(staging, "git staging allowlist should exist");
  assert.match(staging[1], /data\/timeline-monthly\.json/);
});
