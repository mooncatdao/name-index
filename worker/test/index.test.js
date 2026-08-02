import assert from "node:assert/strict";
import test from "node:test";

import { createHandler, signAlchemyBody } from "../src/index.js";

const SIGNING_KEY = "test-alchemy-signing-key";
const ENV = {
  ALCHEMY_SIGNING_KEY: SIGNING_KEY,
  GITHUB_TOKEN: "github-token",
  GITHUB_OWNER: "mooncatdao",
  GITHUB_REPOSITORY: "name-index",
  GITHUB_EVENT_TYPE: "alchemy-naming-event"
};

async function signedRequest(body, signingKey = SIGNING_KEY) {
  const signature = await signAlchemyBody(body, signingKey);
  return new Request("https://worker.example/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alchemy-signature": signature
    },
    body
  });
}

test("valid signature dispatches a fixed GitHub wake-up payload", async () => {
  const calls = [];
  const handler = createHandler({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }
  });
  const response = await handler(
    await signedRequest(JSON.stringify({ id: "alchemy-delivery", event: { ignored: true } })),
    ENV
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/mooncatdao/name-index/dispatches");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    event_type: "alchemy-naming-event",
    client_payload: { source: "alchemy-custom-webhook" }
  });
  assert.equal(calls[0].init.headers.authorization, "Bearer github-token");
});

test("invalid signatures are rejected without a GitHub call", async () => {
  let calls = 0;
  const handler = createHandler({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    }
  });
  const request = new Request("https://worker.example/webhook", {
    method: "POST",
    headers: { "x-alchemy-signature": "0".repeat(64) },
    body: "{}"
  });
  const response = await handler(request, ENV);
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("validly signed malformed requests are rejected without a GitHub call", async () => {
  let calls = 0;
  const handler = createHandler({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    }
  });
  const response = await handler(await signedRequest("{"), ENV);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("GitHub dispatch failures return a gateway error", async () => {
  const handler = createHandler({
    fetchImpl: async () => new Response("no", { status: 500 })
  });
  const response = await handler(await signedRequest("{}"), ENV);
  assert.equal(response.status, 502);
});

test("missing configuration is rejected before signature processing", async () => {
  const handler = createHandler({ fetchImpl: async () => {
    throw new Error("must not call GitHub");
  } });
  const response = await handler(await signedRequest("{}"), {
    ...ENV,
    GITHUB_TOKEN: ""
  });
  assert.equal(response.status, 503);
});
