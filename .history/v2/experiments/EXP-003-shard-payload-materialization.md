# EXP-003: bounded shard payload materialization

Status: closed; explicit archival layout retained, interactive default rejected by V2-REV-023

Frozen: 2026-08-15

## Boundary

This experiment is distinct from EXP-002. EXP-002 changes only the private physical representation
of TypeScript body payloads. EXP-003 changes the generic SQLite materializer for every namespace:
instead of repeating one semantic payload JSON value in each fact row, it stores an explicitly
tagged, ordered payload array once per immutable shard and retains ordinals in the normalized fact
rows. The array is Brotli-compressed at rest. Semantic `Fact`, shard, generation, provenance,
completeness, and query contracts do not change.

The store supports both `inline-json` and `shard-brotli` materializations so the two physical factors
can be isolated on one source revision:

| Body transport | SQLite materialization |
|---|---|
| semantic | inline JSON |
| compact | inline JSON |
| semantic | shard Brotli |
| compact | shard Brotli |

## Prediction

Repeated payload structure and identities dominate the retained JSON. Shard materialization should
reduce the SQLite file by at least 1.5 times independently of body packing. It should also move the
payload share visible through `dbstat` from fact rows into a smaller shard-payload table. Encoding
before `BEGIN IMMEDIATE` should avoid increasing locked writer time.

## Frozen acceptance thresholds

- SQLite bytes fall by at least 1.5 times for semantic bodies and for compact bodies;
- cold materialization median does not regress and the paired bootstrap upper ratio is at most 1.05;
- generation, manifest, semantic, and bound-fact digests are exact across both layouts;
- point, first-page, next-page, full typed export, evaluator indexing/evaluation, and policy query
  medians regress by no more than 10 percent;
- one pinned reader's decompressed cache is byte-bounded and remains correct when a page spans more
  shards than the cache can retain;
- each compressed shard has an explicit layout, exact count, and complete ordinal membership;
  missing blobs, corrupt streams, decompression bombs, duplicate or out-of-range ordinals, and
  unknown encodings are rejected and quarantined rather than inferred;
- unrestricted semantic payload keys cannot collide with physical metadata;
- compression and preparation occur before the cross-process SQLite writer lock;
- schema migrations converge on one schema and index set regardless of whether the database came
  from inline schema 4/5, legacy compressed schema 6, or a fresh schema 7 database.

Use at least six counterbalanced, fresh-process pairs after one discarded warm-up. Report every
sample, process-tree RSS, Node/native memory, SQLite `dbstat` attribution, paired ratios, medians,
median absolute deviation, and deterministic paired bootstrap 95 percent intervals. Run Codegraph
first and Kernel as the clean holdout. No governed acceptance is written from a partial matrix.

## Layering constraints

The stable seam is the generic SQLite materialization option and its transparency, boundedness, and
corruption laws. Brotli calls, tuple records, ordinal mechanics, caches, profilers, and experiment
harnesses remain private implementation leaves under the thin `.spec` spine. TypeScript-specific
packing stays in `analysis/typescript/physical`; SQLite never imports TypeScript semantics.

## Six-pair Codegraph factorial diagnostic

The generated matrix and its analyzer/native/source bindings are recorded in EXP-002. Across six
measured counterbalanced blocks after one discarded warm-up per condition, both SQLite layouts and
both body transports reconstructed the exact same generation, manifest, source manifest, semantic
digest, generation-bound fact digest, and 73,449 facts.

| Comparison | Inline JSON | Shard Brotli | Paired result |
|---|---:|---:|---:|
| semantic-body SQLite | 336,273,408 B | 176,312,320 B | 1.907x smaller; passes |
| compact-body SQLite | 336,273,408 B | 173,338,624 B | 1.940x smaller; passes |
| semantic-body cold time | baseline | 0.940 median ratio | upper 95% ratio 1.034; passes |
| compact-body cold time | baseline | 0.994 median ratio | upper 95% ratio 1.233; confidence fails |

Every store-layout query median remained within the 1.10 ceiling. Shard materialization was neutral
or faster for point, page, evaluator-index, policy, and full typed workloads in both body conditions;
the largest median ratio was 1.010 for compact full typed export. The exact paired samples and wide
outlier-sensitive confidence intervals remain in the generated artifact.

The Codegraph matrix proves the deterministic size target, semantic transparency, and median query
compatibility. It did not prove the compact-layout cold-confidence requirement.

## Short isolated Kernel decision trial

After the noisy historical matrices were retired, one same-revision semantic-body comparison was
run on Kernel core to decide the production default. Both layouts reconstructed the same generation,
source manifest, manifest digest, semantic digest, generation-bound fact digest, and 27,976 facts.

| Observation | Inline JSON | Shard Brotli | Result |
| --- | ---: | ---: | --- |
| SQLite bytes | 128,303,104 B | 66,236,416 B | shard is 1.937x smaller |
| cold analysis | 25,639.45 ms | 25,794.74 ms | shard is 0.61% slower |
| exact point hydration | 2.37 ms | 9.49 ms | shard is 4.00x slower |
| first hydrated page | 43.48 ms | 333.67 ms | shard is 7.67x slower |
| evaluator indexing | 470.59 ms | 1,591.58 ms | shard is 3.38x slower |
| full typed export | 7,003.41 ms | 7,827.31 ms | shard is 11.77% slower |

Diagnostic artifacts are `/private/tmp/codegraph-exp003-kernel-inline.json` with SHA-256
`e7f5beff6752f311c7f693da1c1b27fe633a8b65aa4974c751e1d9f79a3ae5b2` and
`/private/tmp/codegraph-exp003-kernel-shard.json` with SHA-256
`9880cb993c6d1ed9fdedfe07b7a38505cb3e933b7a277878928b9c45a61ac571`.
They are diagnostic decision inputs, not release qualification.

## Decision

The size reduction is real, but monolithic shard compression violates the intended interactive
complexity boundary: one selected payload requires reconstructing unrelated sibling payloads. The
default therefore returns to independently addressable inline JSON. `shard-brotli` remains an
explicit, bounded option for archival and predominantly full-scan workloads.

No bounded-block redesign is introduced during the application cutover. It would be a distinct
schema/query experiment and should proceed only if a measured consumer needs both compression and
low-latency selective hydration.
