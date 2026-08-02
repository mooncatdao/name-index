const SIGNATURE_HEADER = "x-alchemy-signature";
const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_GITHUB_API = "https://api.github.com";

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

/** Dispatch a fixed workflow wake-up without forwarding webhook contents. */
export async function dispatchGitHubWorkflow(env, fetchImpl = globalThis.fetch) {
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
      client_payload: { source: "alchemy-custom-webhook" }
    })
  });
  return response;
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

    let githubResponse;
    try {
      githubResponse = await dispatchGitHubWorkflow(env, fetchImpl);
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
