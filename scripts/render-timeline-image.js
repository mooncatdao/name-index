import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const REPO_ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "docs/images/naming-timeline.png");
const VIEWPORT = { width: 1400, height: 800 };
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"]
]);

function requestFilePath(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" || pathname === "/timeline" || pathname === "/timeline/"
    ? "timeline/index.html"
    : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("requested path escapes repository root");
  }
  return filePath;
}

function createStaticServer(root) {
  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    try {
      const filePath = requestFilePath(root, request.url ?? "/");
      const contents = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": MIME_TYPES.get(path.extname(filePath)) ?? "application/octet-stream"
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        response.end(contents);
      }
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found" : "Bad request");
    }
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function renderTimelineImage({ root = REPO_ROOT, output = DEFAULT_OUTPUT } = {}) {
  await mkdir(path.dirname(output), { recursive: true });
  const server = createStaticServer(root);
  const port = await listen(server);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      colorScheme: "light",
      deviceScaleFactor: 1,
      viewport: VIEWPORT
    });
    await context.route("**/*", (route) => {
      const requestOrigin = new URL(route.request().url()).origin;
      const localOrigin = `http://127.0.0.1:${port}`;
      return requestOrigin === localOrigin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/timeline/?embed=1`, {
      waitUntil: "load"
    });
    await page.waitForFunction(() =>
      document.documentElement.dataset.timelineReady === "true" ||
      document.documentElement.dataset.timelineError === "true",
      undefined,
      { timeout: 15_000 }
    );
    if (await page.locator("html[data-timeline-error='true']").count() > 0) {
      throw new Error("timeline page reported a rendering error");
    }
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: output
    });
    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    await close(server);
  }
  console.log(`Rendered naming timeline image: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderTimelineImage().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { createStaticServer, renderTimelineImage, requestFilePath };
