const SIGNATURE_HEADER = "x-alchemy-signature";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_GITHUB_API = "https://api.github.com";
const MAX_WEBHOOK_BYTES = 64 * 1024;
const MOONCAT_RESCUE_ADDRESS = "0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6";
const CAT_NAMED_TOPIC = "0xaf93a6d1ccdac374cb23b8a45184a5fbcb33c51e4471f69c088ebc18627fbd0f";
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/i;

export class ProvisionalPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProvisionalPayloadError";
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      !/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left.charCodeAt(index) | 32) ^ (right.charCodeAt(index) | 32);
  }
  return difference === 0;
}

async function hmacHex(bodyBytes, signingKey, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) {
    throw new Error("Web Crypto SubtleCrypto is required");
  }
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(await cryptoImpl.subtle.sign("HMAC", key, bodyBytes));
}

/** Return the documented Alchemy HMAC-SHA256 signature for test/setup use. */
export async function signAlchemyBody(body, signingKey, cryptoImpl = globalThis.crypto) {
  const bodyBytes = typeof body === "string"
    ? new TextEncoder().encode(body)
    : body;
  return hmacHex(bodyBytes, signingKey, cryptoImpl);
}

export async function verifyAlchemySignature(
  bodyBytes,
  signature,
  signingKey,
  cryptoImpl = globalThis.crypto
) {
  if (!(bodyBytes instanceof ArrayBuffer || ArrayBuffer.isView(bodyBytes)) ||
      typeof signature !== "string" || typeof signingKey !== "string" ||
      signingKey === "") {
    return false;
  }
  const expected = await hmacHex(bodyBytes, signingKey, cryptoImpl);
  return constantTimeHexEqual(expected, signature);
}

function getConfiguration(env) {
  const required = [
    "ALCHEMY_SIGNING_KEY",
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "GITHUB_REPOSITORY",
    "GITHUB_EVENT_TYPE"
  ];
  const missing = required.filter((key) =>
    typeof env?.[key] !== "string" || env[key].trim() === ""
  );
  return missing.length === 0 ? null : missing;
}

function githubDispatchUrl(env, apiBase = DEFAULT_GITHUB_API) {
  return `${apiBase.replace(/\/$/, "")}/repos/${
    encodeURIComponent(env.GITHUB_OWNER)
  }/${encodeURIComponent(env.GITHUB_REPOSITORY)}/dispatches`;
}

/** Dispatch only the independently normalized event, never the raw webhook. */
export async function dispatchGitHubWorkflow(
  env,
  provisionalEvent,
  fetchImpl = globalThis.fetch
) {
  if (!provisionalEvent || typeof provisionalEvent !== "object") {
    throw new TypeError("provisionalEvent is required");
  }
  const response = await fetchImpl(githubDispatchUrl(env, env.GITHUB_API_BASE), {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "mooncat-name-index-alchemy-wake",
      "x-github-api-version": GITHUB_API_VERSION
    },
    body: JSON.stringify({
      event_type: env.GITHUB_EVENT_TYPE,
      client_payload: {
        source: "alchemy-custom-webhook",
        provisional: true,
        event: provisionalEvent
      }
    })
  });
  return response;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProvisionalPayloadError(`${label} must be an object`);
  }
}

function normalizeSafeInteger(value, label) {
  let parsed = value;
  if (typeof value === "string" && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) {
    try {
      parsed = Number(BigInt(value));
    } catch {
      parsed = NaN;
    }
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProvisionalPayloadError(`${label} must be a nonnegative safe integer`);
  }
  return parsed;
}

function normalizeHex(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ProvisionalPayloadError(`${label} has an invalid hexadecimal form`);
  }
  return value.toLowerCase();
}

function getCatIdFromTopic(topic) {
  const normalized = normalizeHex(topic, BYTES32_PATTERN, "CatNamed catId topic");
  if (!/^0x0{54}[0-9a-f]{10}$/.test(normalized)) {
    throw new ProvisionalPayloadError("CatNamed catId topic is not a padded bytes5 value");
  }
  return `0x${normalized.slice(-10)}`;
}

function normalizeMatchingLog(block, transaction, log) {
  assertRecord(transaction, "transaction");
  assertRecord(log, "log");
  assertRecord(log.account, "log.account");
  if (typeof log.account.address !== "string" ||
      log.account.address.toLowerCase() !== MOONCAT_RESCUE_ADDRESS.toLowerCase()) {
    throw new ProvisionalPayloadError("log account does not match MoonCatRescue");
  }
  if (!Array.isArray(log.topics) || log.topics.length !== 2 ||
      typeof log.topics[0] !== "string" ||
      log.topics[0].toLowerCase() !== CAT_NAMED_TOPIC ||
      typeof log.topics[1] !== "string") {
    throw new ProvisionalPayloadError("log is not an unambiguous CatNamed event");
  }
  const transactionHash = normalizeHex(transaction.hash, HASH_PATTERN, "transaction.hash");
  const logIndex = normalizeSafeInteger(log.index, "log.index");
  const blockNumber = normalizeSafeInteger(block.number, "block.number");
  const nameRaw = normalizeHex(log.data, BYTES32_PATTERN, "CatNamed data");
  if (log.removed !== undefined && typeof log.removed !== "boolean") {
    throw new ProvisionalPayloadError("log.removed must be boolean when present");
  }
  const transactionIndex = transaction.index === undefined
    ? undefined
    : normalizeSafeInteger(transaction.index, "transaction.index");
  return {
    eventId: `${transactionHash}:${logIndex}`,
    transactionHash,
    logIndex,
    blockNumber,
    ...(transactionIndex === undefined ? {} : { transactionIndex }),
    catId: getCatIdFromTopic(log.topics[1]),
    nameRaw,
    removed: log.removed ?? false
  };
}

function collectWebhookLogs(block) {
  if (!Array.isArray(block.logs) || block.logs.length === 0) {
    throw new ProvisionalPayloadError("webhook block logs are required");
  }
  const candidates = [];
  for (const entry of block.logs) {
    assertRecord(entry, "block log entry");
    if (entry.transaction !== undefined) {
      assertRecord(entry.transaction, "block log transaction");
      if (Array.isArray(entry.transaction.logs)) {
        if (entry.transaction.logs.length === 0) {
          throw new ProvisionalPayloadError("transaction logs are required");
        }
        for (const log of entry.transaction.logs) {
          candidates.push({ transaction: entry.transaction, log });
        }
      } else if (entry.account !== undefined || entry.topics !== undefined) {
        candidates.push({ transaction: entry.transaction, log: entry });
      } else {
        throw new ProvisionalPayloadError("transaction logs are required");
      }
    } else {
      candidates.push({ transaction: entry.transactionRef ?? entry, log: entry });
    }
  }
  return candidates;
}

/** Normalize exactly one CatNamed log from an Alchemy Custom Webhook payload. */
export function normalizeAlchemyCatNamedWebhook(payload) {
  assertRecord(payload, "webhook payload");
  if (payload.type !== "GRAPHQL") {
    throw new ProvisionalPayloadError("webhook type must be GRAPHQL");
  }
  assertRecord(payload.event, "webhook event");
  assertRecord(payload.event.data, "webhook event data");
  assertRecord(payload.event.data.block, "webhook block");
  const block = payload.event.data.block;
  const candidates = collectWebhookLogs(block);
  if (candidates.length !== 1) {
    throw new ProvisionalPayloadError("webhook must contain exactly one log");
  }
  const [{ transaction, log }] = candidates;
  if (!transaction || transaction.hash === undefined) {
    throw new ProvisionalPayloadError("transaction hash is required");
  }
  if (!log || typeof log !== "object" || Array.isArray(log)) {
    throw new ProvisionalPayloadError("log must be an object");
  }
  if (!log.account || typeof log.account.address !== "string" ||
      log.account.address.toLowerCase() !== MOONCAT_RESCUE_ADDRESS.toLowerCase()) {
    throw new ProvisionalPayloadError("webhook log is unrelated to MoonCatRescue");
  }
  if (!Array.isArray(log.topics) || log.topics.length === 0 ||
      typeof log.topics[0] !== "string" ||
      log.topics[0].toLowerCase() !== CAT_NAMED_TOPIC) {
    throw new ProvisionalPayloadError("webhook log is not CatNamed");
  }
  return normalizeMatchingLog(block, transaction, log);
}

export function createHandler({ fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  return async function handle(request, env) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }
    const missing = getConfiguration(env);
    if (missing) {
      return jsonResponse({ error: "worker is not configured" }, 503);
    }

    const bodyBytes = await request.arrayBuffer();
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_WEBHOOK_BYTES) {
      return jsonResponse({ error: "webhook body is too large" }, 413);
    }
    if (bodyBytes.byteLength > MAX_WEBHOOK_BYTES) {
      return jsonResponse({ error: "webhook body is too large" }, 413);
    }
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!await verifyAlchemySignature(bodyBytes, signature, env.ALCHEMY_SIGNING_KEY, cryptoImpl)) {
      return jsonResponse({ error: "invalid signature" }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
    } catch {
      return jsonResponse({ error: "malformed JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse({ error: "webhook body must be a JSON object" }, 400);
    }

    let provisionalEvent;
    try {
      provisionalEvent = normalizeAlchemyCatNamedWebhook(payload);
    } catch (error) {
      return jsonResponse({
        error: error instanceof ProvisionalPayloadError
          ? error.message
          : "invalid CatNamed webhook"
      }, 422);
    }

    let githubResponse;
    try {
      githubResponse = await dispatchGitHubWorkflow(env, provisionalEvent, fetchImpl);
    } catch {
      return jsonResponse({ error: "GitHub dispatch failed" }, 502);
    }
    if (!githubResponse.ok) {
      return jsonResponse({ error: "GitHub dispatch failed" }, 502);
    }
    return jsonResponse({ accepted: true }, 202);
  };
}

const handler = createHandler();

export default {
  fetch: (request, env, context) => handler(request, env, context)
};
