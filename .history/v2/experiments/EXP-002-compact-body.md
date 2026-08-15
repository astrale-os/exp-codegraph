# EXP-002: compact physical TypeScript body representation

Status: candidate implemented; Codegraph factorial diagnostic complete; original RSS/cold gates fail; holdout qualification pending

Frozen: 2026-08-15

## Baseline observation

The first Codegraph self-host diagnostic retained 70,633 facts occupying 225.7 MB and produced a
333 MB SQLite database. Its five largest body facts were 41.9 to 128.8 times larger than their
function source spans. These pre-cleanup numbers authorize attribution but are not the candidate's
ratio denominator: semantic relations can legitimately exceed source length.

Removing the accidental second copy of the call array is a correctness-preserving preliminary
cleanup, not evidence that the broader hypothesis passes. EXP-002 establishes its measured baseline
from a dedicated post-cleanup commit, so the compact representation receives no credit for that fix.

## Prediction

A private physical encoding using body-local occurrence ordinals, one source/revision/owner header,
a local symbol dictionary, compact CFG/def-use/call references, and shard-level defaults will reduce
body bytes by at least five times while a typed reader reconstructs the existing semantic API.

Literal constants should be retained as syntax facts. Bounded evaluation remains a portable,
budgeted semantic projection rather than an eagerly serialized native value result, unless field
attribution disproves that ownership split.

## Frozen acceptance thresholds

- serialized body bytes fall by at least 5 times;
- total SQLite size or peak RSS falls by at least 2 times;
- cold-path wall time preferably improves by at least 1.5 times and must not regress;
- representative typed queries regress by no more than 10 percent;
- the typed reader reconstructs exactly the same semantic body, CFG, def-use, call, provenance,
  completeness, and portable identities;
- corrupt dictionaries, out-of-range ordinals, duplicate local identities, and incomplete shard
  defaults are rejected before consumer access;
- physical schema versioning and migration do not make the compact encoding part of the generic
  store or public semantic model. The preferred seam is a generic storage/wire codec below semantic
  `Fact` formation; a TypeScript-specific payload stored directly by `AnalysisStore` is a public
  fact-schema change and requires an accepted revision because it changes fact, shard, and generation
  identities.

If field-level attribution shows bodies are not a dominant contributor, the public body redesign is
rejected. A smaller private wire/store encoding may still be evaluated independently.

## Required attribution

Record exact JSON bytes for the body header, occurrences and spans, local/global symbol identities,
relations, blocks, edges, definition-use, calls and parameter bindings, summaries, value maps,
fact/provenance envelopes, and repeated shard defaults. Separate logical reconstructed bytes from
wire bytes, SQLite bytes, allocation volume, heap, RSS, serialization, validation, and query time.
The current self-host runner raises the native transaction ceiling to 512 MiB while the production
default is 256 MiB. Record raw transaction and framed-wire bytes and prove both corpora under the
production default; changing that default requires a separately governed limit decision.

Use at least six counterbalanced post-cleanup-baseline/candidate pairs (three in each order) after one discarded warm-up.
Report every sample, paired ratios, medians, median absolute deviation, and a bootstrap 95 percent
interval. “Must not regress” means the candidate cold median is no greater than baseline and the
upper interval is no greater than 1.05; representative query paired medians must remain at or below
1.10. The 5-times body and 2-times database-or-RSS thresholds use paired medians.

## Measured baseline and accepted spike boundary

The post-cleanup Codegraph baseline retains 70,987 facts occupying 217.7 MB. Its 3,643 body facts
occupy 145.2 MB, or 66.7 percent of semantic fact bytes. The native transaction is 226.9 MB and the
framed wire representation is 302.5 MB; the clean SQLite database is 324.5 MB. The profiling process
reached approximately 2.13 GiB maximum RSS.

Field attribution confirms that repeated occurrence identities, source/revision/owner coordinates,
symbol identities, and CFG block identities dominate body payloads. An independent corpus simulation
of a private body-local ordinal and dictionary encoding projected a 6.0-times whole-body reduction
while preserving every current value result, and a 7.1-times reduction when literal atoms replace
native value classifications. Values are not the primary byte cost.

The first candidate is therefore a versioned physical codec that preserves the complete public
`FunctionBodyIR`, facts, identities, provenance, completeness, and value results after decoding.
Moving value evaluation to a portable derived pass is a separate semantic-schema revision and may
proceed only after the encoding-only candidate qualifies. Body compaction alone projects roughly a
1.6-times SQLite reduction, so the frozen two-times secondary gate applies to retained/peak RSS; a
two-times database claim would require a separately measured store-wide identity/index codec.

## Candidate architecture

The candidate preserves the semantic `Fact` and `FunctionBodyIR` contracts. A generic
`FactPayloadCodec` capability is explicitly composed at the process and durable-store boundaries.
The process adapter advertises supported codec identities; the native producer emits
`typescript.body.packed/1` only when advertised. It computes semantic fact and shard identities
before replacing the wire payload with body-local ordinals, compact identities, shared
source/revision/owner defaults, symbol and text dictionaries, compact CFG/def-use/call references,
and unchanged value results.

Memory and SQLite expose only the decoded semantic `payload`. The physical state is private to the
fact owner and survives generation binding without invoking the payload getter. SQLite schema 7
retains normalized, indexed fact headers, provenance and inputs and can select either per-fact inline
JSON or one ordered, content-addressed Brotli payload array per shard. That store-wide factor is
governed separately by EXP-003. Corrupt blobs, counts, ordinals, dictionaries, identities and
references fail admission. Physical native, codec and storage files are deliberately excluded from
exact `.spec` file inventory; public decoder capabilities and semantic laws remain specified.

## First exact-source diagnostic pair

This pair is diagnostic only. It used the same dirty candidate source, the same native binary
SHA-256 `f320fc8e053c9af127d9f934f1808a92bd20d006d95ef9de3a867e706c24632f`, the production
256 MiB transaction limit, and SQLite schema 6. The semantic run omitted codec negotiation; the
candidate advertised `typescript.body.packed/1`.

| Observation | Semantic physical baseline | Compact candidate | Result |
|---|---:|---:|---:|
| generation | `generation:4bd35786f3f585001f54ae2fc2b289aff97f5be435db8a7e7b3065100163ff93` | identical | exact |
| semantic digest | `328c6102b89d9f0f9e10ce2d0ebbca10a39232cfb34ea73682259a001be22ae1` | identical | exact |
| bound-fact digest | `a26a4f4023011bdf39c15aa477f0e915a09fbe54c5347b79fe81fba8786f4c4a` | identical | exact |
| semantic body facts | 148,416,645 B | 148,416,645 B reconstructed | exact |
| physical body facts | 148,476,085 B | 27,348,653 B | 5.429x smaller |
| native transaction | 231,784,830 B | 110,652,458 B | 2.095x smaller |
| framed wire | 309,049,793 B | 147,538,445 B | 2.095x smaller |
| SQLite file | 164,679,680 B | 162,045,952 B | 1.016x smaller |
| maximum profiling RSS | 1,509,216 KiB | 1,237,936 KiB | 1.219x smaller |
| SQLite cold refresh | 79,124.76 ms | 81,612.22 ms | 3.14% slower |
| full typed canonical query | 49,660.12 ms | 50,785.67 ms | 2.27% slower |

Only the five-times body threshold and ten-percent query ceiling pass this exact-source sample. The
two-times database-or-RSS threshold fails, and the compact run is provisionally slower on the cold
path. The body codec does cut the native transaction and framed wire by more than two times, but
those are attribution results rather than substitutes for the frozen acceptance thresholds.

The earlier 324,476,928-byte database, 2,128,128-KiB RSS, and 89,726.57-ms cold observations belong
to the historical post-cleanup implementation, not this exact-source pair. Comparing them directly
to one current compact run stitched together two implementation changes. SQLite schema 6 also adds
generic Brotli shard-payload materialization and index changes, so it must be isolated from body
packing. Qualification therefore requires a two-by-two factorial comparison—semantic versus packed
body payloads crossed with per-fact versus shard-Brotli storage—on one clean source revision and
corpus. No combined database, RSS, or cold-path claim is accepted before that comparison.

The evidence files are diagnostic artifacts outside Git:
`/private/tmp/codegraph-current-semantic-sqlite.json`,
`/private/tmp/codegraph-current-compact-sqlite.json`, and
`/private/tmp/codegraph-compact-shard-v2-profile.json`.

No governed acceptance is written from this pair. EXP-002 remains open until the factorial isolates
each factor, six counterbalanced clean-revision pairs and bootstrap intervals satisfy the frozen
thresholds, adversarial codec/storage corruption coverage is clean, and the Kernel holdout confirms
the same semantic and operational result.

## Six-pair Codegraph factorial diagnostic

The generated four-condition matrix at
`/private/tmp/codegraph-exp002-003-matrix.json` has SHA-256
`4e3717702c5a1ef2e1c4f6032eed0c7cc353ea3e2b326e8dcfdfbff524c8cb61`. It is bound to analyzer
tree digest `bc8d2344f4dd5c753f5cf9f45348db626ceab5b7c1195b455b1b63ec687037a9`, native binary
SHA-256 `00b42d4ea65e6267f092a2bc1929a52df6bf914639a7955f3e871c78b893d19a`, source manifest
`source-manifest:df6e205c9f9c6cbb532beebffbe91e1e2fb9b2e7f7af713079d9eb3e6d1b69d4`, and six measured
counterbalanced blocks after one discarded warm-up per condition. All 28 runs reconstructed the
same generation, manifest, 73,449 facts, semantic digest, and generation-bound fact digest.

| Observation | Semantic body | Compact body | Paired result |
|---|---:|---:|---:|
| physical body bytes | 150,658,206 B | 27,628,419 B | 5.453x smaller; passes |
| native transaction | 235,075,157 B | 112,040,410 B | 2.098x smaller |
| framed wire | 313,436,977 B | 149,389,049 B | 2.098x smaller |
| process-tree RSS with inline storage | baseline | 0.820 median ratio | 1.219x smaller; fails 2x |
| process-tree RSS with shard storage | baseline | 0.680 median ratio | 1.471x smaller; fails 2x |
| cold time with inline storage | baseline | 0.951 median ratio | upper 95% ratio 1.065; fails confidence |
| cold time with shard storage | baseline | 1.050 median ratio | upper 95% ratio 1.172; fails |

Every representative typed-query median remained within the frozen 1.10 ceiling. With shard
storage, compact bodies had median ratios of 1.039 for full typed export, 1.051 for point lookup,
1.016 for first page, 0.999 for next page, 1.023 for evaluator indexing, 1.059 for evaluation, and
1.010 for policy execution. The wide intervals on millisecond-scale point/evaluation samples are
reported in the generated artifact and are not converted into stronger claims here.

The candidate therefore passes semantic transparency, corruption/admission coverage, the five-times
body target, the wire reduction, and median query compatibility. It does **not** pass the original
two-times database-or-RSS gate on its own or the cold no-regression confidence gate. The physical
representation remains a useful bounded wire/materialization mechanism, but EXP-002 is not
graduated and its frozen thresholds are not revised post hoc. EXP-003 owns the independently measured
store-wide database effect. Kernel holdout evidence remains absent.
