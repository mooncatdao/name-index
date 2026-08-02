# LibMoonCat reference bundle

This directory contains the reference bundle used by the CatID mapping
generator. The bundle is an unmodified upstream snapshot; do not edit it
manually.

Complete the provenance fields below when the source details are available:

- Original source URL: https://gitlab.com/mooncatrescue/libmooncat/-/blob/master/dist-js/libmooncat-limited.js
- Retrieval date: 2026-08-01
- Upstream commit or revision: Add canonical CatID rescue-order mapping
- SHA-256: b4d36703a58ce07c61606518010aad05b0e89dc3d11ce0f33a241a7ab35ac85e
- License or permission status: AGPL v3 (https://gitlab.com/mooncatrescue/libmooncat/-/blob/master/LICENSE)
- Local-use rationale: Various utility functions

The generator consumes this file as a deterministic, network-free reference
input. Keep provenance updates in this README and preserve the bundle bytes.

## Naming reference snapshots

The following files are also preserved as unmodified upstream snapshots. Do
not edit them manually; update their provenance fields here instead.

### `mooncat_named.json`

- Original source URL: `[TODO: provide the canonical upstream URL]`
- Retrieval date: `[TODO: YYYY-MM-DD]`
- Upstream commit or revision: `[TODO: provide commit, tag, or revision]`
- SHA-256 (calculated locally): `336260e3c47da731938df20c70f417c16c59690869ed316de98fb4e96216a3e4`
- License or permission status: `[TODO: verify and record license or permission]`
- Local-use rationale: `[TODO: explain why this snapshot is retained locally]`

This is the authoritative current-name seed snapshot. Its records preserve
the source's `name` values, including boolean `true` for undecodable names.

### `mooncat_names.js`

- Original source URL: `[TODO: provide the canonical upstream URL]`
- Retrieval date: `[TODO: YYYY-MM-DD]`
- Upstream commit or revision: `[TODO: provide commit, tag, or revision]`
- SHA-256 (calculated locally): `353485956dd9002c15e9dc38da4107eda44befe8657cc8d04518c9fc3b088144`
- License or permission status: `[TODO: verify and record license or permission]`
- Local-use rationale: `[TODO: explain why this snapshot is retained locally]`

The extraction script skips blank bytes32 names. Consequently, the generated
seed represents successful naming state, not complete `CatNamed` event
history; blank-name attempts are intentionally absent until a separate event
history workflow is implemented.
