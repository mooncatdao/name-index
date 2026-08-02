# Seed reconciliation

The committed canonical outputs contain 21,235 naming events and 1,232
current named cats. Comparing `data/current-names.json` with the historical
`data/seed/current-names.json` gives:

- 1,225 exact matches;
- 7 canonical-only records;
- 0 seed-only records; and
- 0 mismatches.

The seven canonical-only records are present in the canonical current-name
artifact and are backed by the following records in `data/events.jsonl`:

| CatID | Rescue order | Decoded name | Status | Block | Transaction hash | Log index |
| --- | ---: | --- | --- | ---: | --- | ---: |
| `0x00cea5e546` | 2094 | `STARLiNK` | `text` | 25410821 | `0x1dab17d8ec43cee440a0229cb0d2171081a69d5d936aba6eeb6b5df3a3e45346` | 77 |
| `0x00e279df43` | 7613 | `Ganjalf the Green` | `text` | 25636559 | `0x6cf20fde5090ae8488b99287bce9c89f1c823bbf7951c7c724c3969f4a758cf9` | 1477 |
| `0x005e73653c` | 10044 | `Cinke` | `text` | 25584098 | `0xdc85c0bfb61334f00c329087fc92237eee60bbfbf705e6ed0836a4e4835b4399` | 94 |
| `0x008db774b2` | 11882 | `Today` | `text` | 25652811 | `0x00f3833c08cd6d4b41fbda35e29fbee53eb14d35e4798a441dc8ad99ddccffbf` | 78 |
| `0x00f24fa124` | 11927 | `Ganjalf the Green on a mission` | `text` | 25638512 | `0x955b9582b15623d05925a430c5c7ba3e307a142c2dee881e602b881d14fc6753` | 534 |
| `0x00a7b95e77` | 18150 | `Squiggle My Ass 🍑💨\n` | `text` | 25648296 | `0xd9e66570de93a4b00ce11031f3d89a70a95cad992be034da39d1d010d9c2f222` | 490 |
| `0x00ba204151` | 19625 | `Smooncatéagol` | `text` | 25638486 | `0x647990de527ee74a4e4c99d2b6a7536a74fcf1045570c1efc89be02786c615a2` | 598 |

The `\n` shown for `Squiggle My Ass 🍑💨` denotes its literal trailing newline
in the canonical decoded text. The report and event records also retain the
raw bytes32 value, event ID, transaction index, and other normalized fields.

## What the repository establishes

All seven records have decoded status `text`, so these additions are not an
example of the historical seed omitting a non-text decoder status. The latest
seed entry has `blockHeight` 25,349,337; every canonical-only event is later,
at block 25,410,821 or above. This is the repository-supported distinction:
the canonical history includes later records than the highest-block record in
the committed seed.

The files do not establish the seed producer's update cadence, publication
cutoff, filtering policy, or the specific reason these later records were not
present. Those remain unknown. The chain-derived event history and its current
name artifacts are therefore authoritative for this repository; the seed is a
historical comparison reference, not a source for canonical data.
