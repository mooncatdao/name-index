# Automated naming-index publishing

The production wake-up path is:

```text
Alchemy Custom Webhook -> Cloudflare Worker -> GitHub repository_dispatch
  -> Actions provisional commit -> delayed finalized reconciliation
  -> validation -> explicit finalized/live-artifact commit
```

The Worker verifies the Alchemy signature and accepts only one strictly
validated `CatNamed` log from the MoonCatRescue contract. It sends GitHub only
the normalized event needed for provisional ingestion; it never forwards the
raw webhook body or advances the finalized scanner. The repository-dispatch
path immediately writes the explicitly provisional
`data/pending-events.json` store and the five `*-live.json` artifacts. The
reconciliation path waits about 15 minutes only for repository dispatch, then
checks out the latest `main`, performs the existing finalized overlap-aware
scan, reconciles pending entries against finalized RPC logs, regenerates live
artifacts, and runs the full validation suite. A six-hour schedule covers
missed or delayed notifications and reconciles immediately.

For repository-dispatch runs, the Actions log step named `Log provisional event
summary` prints the event ID, transaction and block identifiers, cat ID,
removal flag, optional transaction index, and derived blank/nonblank status. It
does not print the raw name bytes or the full dispatch payload.

The workflow has separate job-level concurrency lanes for provisional
publication and reconciliation; there is no workflow-wide lock spanning the
reconciliation sleep. Provisional deliveries therefore continue through their
own short publication lane while reconciliation waits. Both commit steps fetch
and rebase with `--autostash` onto `origin/main` before retrying the push up to
three times. This preserves an unstaged scanner checkpoint change for the later
cache-save step without adding it to the explicit generated-artifact commit. An
unresolvable rebase conflict fails that run without overwriting newer commits;
the next serialized run can retry from the resulting `main` state.

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
   than committed from `state/`. The workflow allowlist contains the finalized
 artifacts, the monthly timeline, the generated timeline image, the pending
 store, and the five live artifacts. It never stages `state/`, reports,
references, or secrets. Reconciliation installs the lockfile's Playwright
 Chromium browser, renders the existing local timeline page in embed mode, and
 stages `docs/images/naming-timeline.png` with the other generated artifacts.

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
After authentication it requires a GraphQL Custom Webhook payload containing
exactly one log with the MoonCatRescue address, the exact `CatNamed` topic,
two correctly padded topics, a bytes32 name, transaction hash/index, block
number, and log index. Wrong contracts/topics, unrelated or multiple logs,
malformed fields, and bodies over the bounded request size are rejected. The
GitHub payload contains only `provisional: true` and the normalized event.
Invalid signatures return 401, malformed JSON returns 400, invalid event
payloads return 422, oversized bodies return 413, and GitHub failures return
502 so Alchemy can retry.

Copy the deployed Worker URL into an Alchemy Custom Webhook. Configure the
webhook for Ethereum mainnet and filter the MoonCatRescue contract's
`CatNamed` event. The exact GraphQL filter should be created and checked in the
Alchemy dashboard for the deployed webhook; the Worker does not trust the
filter or payload for canonical correctness.

## Local Worker test

Use Wrangler's local development mode to verify the signature and GitHub
dispatch path before relying on a live Alchemy delivery. Put the required
local-only bindings in `.dev.vars`: the test signing key, repository-scoped
GitHub token, repository owner, repository name, and the
`alchemy-naming-event` event type. Keep that file untracked.

Start the Worker locally:

```sh
npx wrangler dev
```

In a second terminal, sign and send the exact same raw JSON body:

```sh
BODY='{"type":"GRAPHQL","event":{"data":{"block":{"number":22000000,"logs":[{"transaction":{"hash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","index":0,"logs":[{"account":{"address":"0x60cd862c9C687A9dE49aecdC3A99b74A4fc54aB6"},"topics":["0xaf93a6d1ccdac374cb23b8a45184a5fbcb33c51e4471f69c088ebc18627fbd0f","0xd8523a5300000000000000000000000000000000000000000000000000000000"],"data":"0x6361740000000000000000000000000000000000000000000000000000000000","index":0}]}}]}}}}'
SIGNING_KEY='test-signing-key'
SIGNATURE=$(printf '%s' "$BODY" \
  | openssl dgst -sha256 -hmac "$SIGNING_KEY" \
  | awk '{print $2}')

curl -i \
  -X POST http://localhost:8787 \
  -H "content-type: application/json" \
  -H "x-alchemy-signature: $SIGNATURE" \
  --data-raw "$BODY"
```

The `SIGNING_KEY` value must match the local signing-key binding in
`.dev.vars`. A successful end-to-end local test must send a representative
GraphQL `CatNamed` payload and returns `202` with `{"accepted":true}`; it
starts the provisional publishing workflow through a `repository_dispatch`
event. A `401` means signature verification failed, `422` means the
authenticated payload was not one unambiguous CatNamed log, and `502` means
the signature and event passed but GitHub rejected the dispatch. Restart
Wrangler after changing `.dev.vars` so the new bindings are loaded.

The `.dev.vars` file and `.wrangler/` runtime state are local-only and must not
be committed.

To inspect authenticated webhook schema rejections without exposing request
contents or credentials, tail the deployed Worker and look for the structured
`MoonCat naming webhook rejected (422)` warning:

```sh
npx wrangler tail mooncat-name-index-wake
```

The warning contains only the static validation reason and coarse request
context. Successful requests, signature failures, malformed JSON, and oversized
bodies do not emit this validation warning.

## Operations and recovery

- Duplicate webhook deliveries are safe: workflow concurrency serializes runs,
  the pending store is keyed by `transactionHash:logIndex`, exact duplicates
  are no-ops, and the finalized scanner remains authoritative. Provisional
  writes and reconciliation writes have separate job locks so the delayed
  reconciliation lane does not queue later provisional deliveries.
- A pending event is promoted when the finalized scan contains the same event
  ID and compatible fields. Entries newer than the finalized height remain
  provisional. Entries at or below that height that are absent from finalized
  logs are removed as orphaned/reorged. Removed webhook logs are never added to
  the pending store.
- Finalized artifacts remain finalized-only. Live artifacts are a deliberate
  opt-in overlay; consumers must not silently replace finalized filenames with
  live filenames.
- The scheduled run is the fallback for missed notifications. It uses the same
  scan, reconciliation, enrichment, validation, cache, and explicit commit path
  but does not sleep.
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
