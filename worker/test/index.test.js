import assert from "node:assert/strict";
import test from "node:test";

import {
  createHandler,
  normalizeAlchemyCatNamedWebhook,
  signAlchemyBody
} from "../src/index.js";

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

const CAT_NAMED_TOPIC = "0xaf93a6d1ccdac374cb23b8a45184a5fbcb33c51e4471f69c088ebc18627fbd0f";
const CAT_ID = "0x00d8523a53";
const CAT_ID_TOPIC = `0x${"0".repeat(54)}${CAT_ID.slice(2)}`;
const NAME_RAW = "0x6361740000000000000000000000000000000000000000000000000000000000";
const TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function webhookPayload() {
  return {
    webhookId: "wh_test",
    id: "whevt_test",
    type: "GRAPHQL",
    event: {
      data: {
        block: {
          number: 22,
          logs: [{
            transaction: {
              hash: TRANSACTION_HASH,
              index: 3,
              logs: [{
                account: {
                  address: "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6"
                },
                topics: [CAT_NAMED_TOPIC, CAT_ID_TOPIC],
                data: NAME_RAW,
                index: 7
              }]
            }
          }]
        }
      }
    }
  };
}

test("normalizes one CatNamed GraphQL log without forwarding the raw webhook", () => {
  assert.deepEqual(normalizeAlchemyCatNamedWebhook(webhookPayload()), {
    eventId: `${TRANSACTION_HASH}:7`,
    transactionHash: TRANSACTION_HASH,
    logIndex: 7,
    blockNumber: 22,
    transactionIndex: 3,
    catId: CAT_ID,
    nameRaw: NAME_RAW,
    removed: false
  });
});

test("valid signature dispatches a normalized provisional event", async () => {
  const calls = [];
  const handler = createHandler({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }
  });
  const response = await handler(
    await signedRequest(JSON.stringify(webhookPayload())),
    ENV
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/mooncatdao/name-index/dispatches");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    event_type: "alchemy-naming-event",
    client_payload: {
      source: "alchemy-custom-webhook",
      provisional: true,
      event: {
        eventId: `${TRANSACTION_HASH}:7`,
        transactionHash: TRANSACTION_HASH,
        logIndex: 7,
        blockNumber: 22,
        transactionIndex: 3,
        catId: CAT_ID,
        nameRaw: NAME_RAW,
        removed: false
      }
    }
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
  const response = await handler(
    await signedRequest(JSON.stringify(webhookPayload())),
    ENV
  );
  assert.equal(response.status, 502);
});

test("wrong contracts, topics, and ambiguous logs are rejected", async () => {
  const handler = createHandler({ fetchImpl: async () => {
    throw new Error("must not dispatch");
  } });
  const wrongContract = webhookPayload();
  wrongContract.event.data.block.logs[0].transaction.logs[0].account.address =
    "0x0000000000000000000000000000000000000001";
  const wrongTopic = webhookPayload();
  wrongTopic.event.data.block.logs[0].transaction.logs[0].topics[0] =
    `0x${"11".repeat(32)}`;
  const ambiguous = webhookPayload();
  ambiguous.event.data.block.logs.push(ambiguous.event.data.block.logs[0]);
  for (const payload of [wrongContract, wrongTopic, ambiguous]) {
    const response = await handler(await signedRequest(JSON.stringify(payload)), ENV);
    assert.equal(response.status, 422);
  }
});

test("oversized signed bodies are rejected before dispatch", async () => {
  const handler = createHandler({ fetchImpl: async () => {
    throw new Error("must not dispatch");
  } });
  const response = await handler(
    await signedRequest("x".repeat(64 * 1024 + 1)),
    ENV
  );
  assert.equal(response.status, 413);
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
