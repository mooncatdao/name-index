import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { requestFilePath } from "../scripts/render-timeline-image.js";

test("timeline renderer serves only repository-relative files", () => {
  const root = path.resolve("/tmp/name-index-render-test");
  assert.equal(
    requestFilePath(root, "/timeline/"),
    path.join(root, "timeline/index.html")
  );
  assert.equal(
    requestFilePath(root, "/data/timeline-monthly.json"),
    path.join(root, "data/timeline-monthly.json")
  );
  assert.throws(() => requestFilePath(root, "/%2f..%2fsecrets.txt"));
});

test("timeline page exposes embed styling and an explicit ready signal", async () => {
  const html = await readFile("timeline/index.html", "utf8");
  assert.match(html, /classList\.add\("embed"\)/);
  assert.match(html, /html\.embed/);
  assert.match(html, /dataset\.timelineReady = "true"/);
});
