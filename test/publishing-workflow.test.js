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
