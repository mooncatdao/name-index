# Automated naming-index publishing

The production wake-up path is:

```text
Alchemy Custom Webhook -> Cloudflare Worker -> GitHub repository_dispatch
  -> Actions scanner -> validation -> explicit canonical-artifact commit
```

The Alchemy request is only a notification. The Worker never copies webhook
fields into `data/`. The Actions job performs the existing finalized,
overlap-aware scan, obtains block timestamps and transaction senders through the
configured RPC client, regenerates detailed artifacts, and runs the full
validation suite. A six-hour schedule covers missed or delayed notifications.

## GitHub Actions setup

1. In the repository settings, add the `MOONCAT_RPC_URL` Actions secret. The
   workflow exposes it only to the finalized-event scanner step. Use a mainnet
   HTTPS RPC endpoint that supports historical `eth_getLogs`,
   `eth_getBlockByNumber`, and `eth_getTransactionByHash`.
2. Ensure Actions are enabled and the repository's workflow permission allows
   read/write contents for this workflow. The workflow declares only
   `contents: write`; it does not request pull-request, issue, or deployment
   permissions.
3. The workflow file is
   `.github/workflows/publish-naming-events.yml`. It accepts the
   `alchemy-naming-event` repository-dispatch type, manual `workflow_dispatch`,
   and `0 */6 * * *` UTC schedule events.
4. Scanner checkpoint continuity is kept in the GitHub Actions cache rather
   than committed from `state/`. The canonical generated allowlist is limited
   to the six `data/` artifacts listed in the workflow.

Run a manual test from the Actions tab with `workflow_dispatch`. A no-change
run succeeds, validates the repository, updates the cached checkpoint, and
does not create a commit.

## Cloudflare Worker setup

From the repository root, authenticate Wrangler and deploy the Worker:

```sh
npx wrangler login
npx wrangler deploy
```

Set these Worker secrets; none are stored in `wrangler.toml`:

```sh
npx wrangler secret put ALCHEMY_SIGNING_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_OWNER
npx wrangler secret put GITHUB_REPOSITORY
npx wrangler secret put GITHUB_EVENT_TYPE
```

Use a GitHub fine-grained token scoped only to this repository with Actions
workflow/repository-dispatch capability sufficient for
`POST /repos/{owner}/{repo}/dispatches`. Set `GITHUB_EVENT_TYPE` to
`alchemy-naming-event`, matching the workflow.
`GITHUB_API_BASE` is optional for local tests and defaults to
`https://api.github.com`; it is not a credential.

The Worker validates the raw request body against the
`X-Alchemy-Signature` HMAC-SHA256 hex digest using `ALCHEMY_SIGNING_KEY`.
After a valid JSON-object body is authenticated, it sends GitHub only a fixed
wake-up payload containing `source: alchemy-custom-webhook`; the Alchemy event
contents are not forwarded or interpreted as canonical data. Invalid
signatures return 401, malformed JSON returns 400, and GitHub failures return
502 so Alchemy can retry.

Copy the deployed Worker URL into an Alchemy Custom Webhook. Configure the
webhook for Ethereum mainnet and filter the MoonCatRescue contract's
`CatNamed` event. The exact GraphQL filter should be created and checked in the
Alchemy dashboard for the deployed webhook; the Worker does not trust the
filter or payload for canonical correctness.

## Operations and recovery

- Duplicate webhook deliveries are safe: repository dispatch is only a wake-up,
  workflow concurrency serializes runs, event IDs make overlap scans
  idempotent, and the scanner's confirmation/reorg rules remain authoritative.
- The scheduled run is the fallback for missed notifications. It uses the same
  scan, enrichment, validation, cache, and explicit commit path.
- If the RPC fails, the job fails before a checkpoint cache save or commit;
  retry after correcting `MOONCAT_RPC_URL`.
- If validation fails, inspect the job logs and fix the repository or provider
  before retrying. The workflow never stages `state/`, reports, references, or
  secrets.
- If dispatch returns 401/403, rotate or correct `GITHUB_TOKEN` and verify the
  owner, repository, and event type bindings. If the Worker returns 401, use
  the Alchemy signing key belonging to that exact webhook and preserve the raw
  body when testing signatures.

Local Worker tests run without Cloudflare or GitHub resources:

```sh
node --test worker/test/index.test.js
```
