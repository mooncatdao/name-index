# MoonCat name index

This repository indexes `CatNamed` events from the original MoonCatRescue
contract. The event JSONL is canonical; current-name JSON artifacts are
derived from that event history. `data/seed/current-names.json` is a historical
comparison reference only and is never merged into canonical events.

## One backfill batch

Set `MOONCAT_RPC_URL` (preferred) or `ETH_RPC_URL`, then run one bounded batch:

```sh
npm run backfill -- --max-blocks 100000
```

The default batch limit is 100,000 blocks. `--max-blocks` controls the outer
backfill window and is independent of the checkpoint's RPC `chunkSize`.
Each batch scans from the canonical naming start block (`4,140,409`) for a new
checkpoint, or from the existing overlap resume point thereafter. It clamps
the target to the finalized block (`latest - confirmations`) and never queries
unfinalized history.

The command emits one JSON object. It uses the existing atomic persistence
pipeline in this order:

```text
events -> current-name artifacts -> checkpoint
```

An interruption is safe to retry. Event IDs make overlap retries idempotent,
and a checkpoint advances only after the event and artifact writes succeed.

## Full resumable backfill

Use the foreground loop after testing a single batch:

```sh
npm run backfill:all -- --max-blocks 100000
```

The loop stops when the finalized target is reached or when an invocation
makes no progress. It does not busy-loop on a stalled RPC or an already
persisted range. All canonical path overrides are available on both commands:
`--checkpoint`, `--events`, `--current-names`, `--names-by-cat-id`,
`--names-by-rescue-order`, and `--metadata`.

Public RPC services commonly limit `eth_getLogs` range size, request rate, and
historical availability. Lower `--max-blocks` when a provider rejects a batch;
the checkpoint's `chunkSize` still bounds each individual logs request. A
provider failure leaves the last durable checkpoint available for restart.

## Validation

```sh
npm test
npm run check
npm run validate:current-names
```

The backfill tests use mocked block/log clients and persistence dependencies;
they do not perform live RPC calls.

## Seed comparison

Compare only the committed canonical current-name artifact with the historical
seed:

```sh
npm run compare:seed
npm run validate:seed-comparison
```

The report is `reports/seed-comparison.json`. `--check` performs an exact-byte
comparison and the report contains no clock-derived fields. Its categories are
objects keyed as `<catId>@<rescueOrder>`:

- `exactMatches`: canonical and seed raw/status/text values agree.
- `canonicalOnly`: a canonical current name has no seed record.
- `seedOnly`: a seed record has no canonical current name.
- `mismatches`: both records exist but their raw/status/text values differ.

Each category retains canonical or seed details, including raw bytes and
decoded status/text where available. The current report has 1,225 exact
matches, seven `canonicalOnly` records, and zero `seedOnly` records or
mismatches. See [the seed reconciliation note](docs/seed-reconciliation.md)
for the seven records and the evidence limits around seed coverage.
