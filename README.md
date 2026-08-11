# MoonCat name index

This repository keeps an up-to-date index of MoonCat names by reading
`CatNamed` events from the original MoonCatRescue contract.

![MoonCat naming timeline](docs/images/naming-timeline.png)

For most apps, you only need one of the generated JSON files listed below.
`data/events.jsonl` is the canonical event history; the current-name files are
derived from it. `data/seed/current-names.json` is only a historical comparison
reference and is never merged into the canonical data.

For a human-readable newest-first activity view, see the
[recent namings feed](RECENT-NAMINGS.md). Provisional rows are marked clearly
and may disappear or become finalized after reconciliation.

## Find the right data file

Most projects should start with `data/names-simple.json` or
`data/current-names.json`.

| File | Best for | What it contains |
| --- | --- | --- |
| [`data/names-simple.json`](data/names-simple.json) | Simple websites, bots, and CatMoon | The easiest display-ready map: decimal rescue order to name, such as `{ "6": "mister moo" }`. |
| [`data/current-names.json`](data/current-names.json) | Apps that need full details | One finalized current-name record per named MoonCat, including raw and decoded name information plus available metadata. |
| [`data/names-by-cat-id.json`](data/names-by-cat-id.json) | Looking up a MoonCat by on-chain CatID | The detailed finalized current-name records indexed by CatID. |
| [`data/names-by-rescue-order.json`](data/names-by-rescue-order.json) | Looking up a MoonCat by rescue order | The detailed finalized current-name records indexed by decimal rescue order. |
| [`data/events.jsonl`](data/events.jsonl) | History, auditing, or rebuilding the index | The canonical finalized naming-event history, including blank naming attempts. |
| [`data/metadata.json`](data/metadata.json) | Checking index status | Finalized index and scan metadata. |

### Need the newest provisional data?

The finalized files above are the safest choice for archives and applications
that prefer confirmed results. Lower-latency consumers can use the live files,
which combine finalized data with recent provisional webhook events:

| File | What it contains |
| --- | --- |
| [`data/names-simple-live.json`](data/names-simple-live.json) | The simple rescue-order-to-name map with provisional updates included. |
| [`data/current-names-live.json`](data/current-names-live.json) | Detailed current-name records with provisional updates included. |
| [`data/names-by-cat-id-live.json`](data/names-by-cat-id-live.json) | Live detailed records indexed by CatID. |
| [`data/names-by-rescue-order-live.json`](data/names-by-rescue-order-live.json) | Live detailed records indexed by rescue order. |
| [`data/pending-events.json`](data/pending-events.json) | Recent provisional events waiting for reconciliation. |
| [`data/metadata-live.json`](data/metadata-live.json) | Finalized and provisional counts for the live view. |

Provisional records are marked with `provisional: true`. They may be removed if
reconciliation finds that an event was orphaned or replaced.

### Other useful outputs

| File | What it contains |
| --- | --- |
| [`data/timeline-monthly.json`](data/timeline-monthly.json) | Monthly successful naming counts used by the timeline graph. |
| [`RECENT-NAMINGS.md`](RECENT-NAMINGS.md) | The latest successful nonblank naming events, including clearly marked provisional rows. |
| [`reports/seed-comparison.json`](reports/seed-comparison.json) | A reproducible comparison between the canonical current names and the historical seed. |

## How updates work

1. An Alchemy webhook detects a matching `CatNamed` event and sends it through a
   small Cloudflare Worker.
2. GitHub Actions publishes a provisional live update immediately.
3. A later reconciliation scan checks the finalized chain, promotes confirmed
   events, removes orphaned entries, and regenerates the finalized and live
   files.

The finalized files never treat webhook data alone as canonical. Blank naming
attempts remain in the event history but do not create current-name records.
Duplicate deliveries are safe to process more than once.

## Important data notes

- `data/names-simple.json` is deliberately minimal and display-oriented.
  Invalid UTF-8 and leading-null records remain available in the detailed files
  but are omitted from the simple map.
- Blank naming attempts remain in `data/events.jsonl`, but are excluded from
  current-name files and the monthly timeline.
- Detailed nonblank records may include `namedOrder`, a 1-based ordering derived
  from block number, transaction index, and log index.
- Detailed records may include `namedYear`, derived from the canonical block
  timestamp in UTC.
- Detailed records may include `namer`, the immediate Ethereum transaction
  sender. It may be a wallet or contract and should not be treated as the human
  chooser or beneficial owner.

## Technical operation

The repository requires Node.js 22 or newer.

### Automated publishing

The production path is:

```text
Alchemy Custom Webhook -> Cloudflare Worker -> GitHub Actions
```

Repository dispatch publishes provisional data immediately. Reconciliation
waits about 15 minutes, scans the existing 64-confirmation finalized range,
then refreshes both finalized and live artifacts. Manual and six-hour scheduled
runs reconcile immediately without the wait.

Provisional publication and reconciliation use separate serialized job lanes,
so a reconciliation delay does not block later provisional events. Their short
writes to `main` fetch, rebase, and retry; an unresolvable race fails rather
than overwriting newer commits.

Publishing commits generated artifacts directly to `main`; it does not open a
pull request. Branch rules therefore need to allow the workflow's normal push
while still blocking force pushes and branch deletion.

Deployment, required secrets, Alchemy filter setup, manual dispatch testing,
checkpoint cache behavior, and recovery steps are documented in
[docs/automated-publishing.md](docs/automated-publishing.md).

### Backfill the event history

Set `MOONCAT_RPC_URL` (preferred) or `ETH_RPC_URL`.

Run one bounded batch first:

```sh
npm run backfill -- --max-blocks 100000
```

Then use the resumable foreground loop when ready:

```sh
npm run backfill:all -- --max-blocks 100000
```

The default outer batch limit is 100,000 blocks. The scanner starts from the
canonical naming block (`4,140,409`) for a new checkpoint, or from the existing
overlap resume point. It clamps its target to `latest - confirmations` and does
not query unfinalized history.

Persistence happens in this order:

```text
events -> current-name artifacts -> checkpoint
```

Interruptions are safe to retry. Event IDs make overlap scans idempotent, and
the checkpoint advances only after the event and artifact writes succeed. If a
public RPC rejects large ranges, lower `--max-blocks`; the checkpoint's
`chunkSize` still limits each individual `eth_getLogs` request.

Both backfill commands also support `--checkpoint`, `--events`,
`--current-names`, `--names-by-cat-id`, `--names-by-rescue-order`, and
`--metadata` path overrides.

### Enrich older events

Add missing canonical block timestamps in bounded batches:

```sh
npm run enrich:timestamps -- --max-blocks 250
```

Each unique missing block is fetched once per run. Rerun until
`remainingBlockCount` is zero.

Add missing immediate transaction senders without rescanning logs:

```sh
npm run enrich:namers -- --max-transactions 250
```

Each unique missing transaction hash is fetched at most once per run. Rerun
until `remainingTransactionCount` is zero.

Both commands persist enriched events before regenerating detailed artifacts.
Future scans and backfills use the same timestamp and transaction-sender
enrichment paths.

### Validate the repository

```sh
npm test
npm run check
npm run validate:current-names
```

The backfill tests use mocked block/log clients and persistence dependencies;
they do not perform live RPC calls.

### Generate the timeline

Generate and validate the deterministic UTC-month timeline:

```sh
npm run generate:naming-timeline
npm run validate:naming-timeline
npm run render:timeline-image
```

The timeline includes only nonremoved, successful nonblank naming events with a
valid canonical `blockTimestamp`, and includes zero-count months between the
first and last included month. It does not use live RPC data or clock-derived
fields during generation.

To use the interactive page locally, serve the repository root over HTTP:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/timeline/`.

### Compare against the historical seed

```sh
npm run compare:seed
npm run validate:seed-comparison
```

The reproducible report is written to `reports/seed-comparison.json` and groups
records into:

- `exactMatches`: canonical and seed raw/status/text values agree
- `canonicalOnly`: a canonical current name has no seed record
- `seedOnly`: a seed record has no canonical current name
- `mismatches`: both records exist but their raw/status/text values differ

Each category is keyed as `<catId>@<rescueOrder>` and retains the relevant raw
bytes and decoded details. See
[docs/seed-reconciliation.md](docs/seed-reconciliation.md) for the reconciliation
notes and evidence limits around seed coverage.

## License

Original project code and documentation are licensed under the Apache License
2.0 (SPDX: `Apache-2.0`); see [LICENSE](LICENSE).

Generated index data and derived data artifacts produced by this repository are
dedicated to the public domain under CC0 1.0 Universal (SPDX: `CC0-1.0`) to
the extent copyright, database, or related rights apply; see
[DATA-LICENSE](DATA-LICENSE). This does not claim ownership of the underlying
blockchain facts.

Bundled third-party and upstream reference material under `references/` remains
subject to its own original licenses and terms and is not relicensed by this
repository.
