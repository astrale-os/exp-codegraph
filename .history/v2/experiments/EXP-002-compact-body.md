# EXP-002: compact physical TypeScript body representation

Status: authorized spike; not authoritative

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

Use at least five counterbalanced post-cleanup-baseline/candidate pairs after one discarded warm-up.
Report every sample, paired ratios, medians, median absolute deviation, and a bootstrap 95 percent
interval. “Must not regress” means the candidate cold median is no greater than baseline and the
upper interval is no greater than 1.05; representative query paired medians must remain at or below
1.10. The 5-times body and 2-times database-or-RSS thresholds use paired medians.
