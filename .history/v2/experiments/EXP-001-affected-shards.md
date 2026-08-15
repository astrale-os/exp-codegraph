# EXP-001: affected-shard incremental TypeScript analysis

Status: authorized spike; not authoritative

Frozen: 2026-08-15

## Baseline observation

The first Codegraph self-host diagnostic measured a 93.7 second comment-only edit to the selected
module entrypoint and an 89.7 second cold rebuild for the same semantic result, despite a 0.6
millisecond no-change refresh. This trigger run is not the frozen private-edit benchmark: the runner
selected `modules[0].entrypoint` from the project with the fewest module bindings. The resident
TypeScript-Go program updates incrementally, but the native projection then walks every owned source,
body, module, and diagnostic before content addressing discards unchanged shards.

## Prediction

For a declaration-shape-preserving private edit, variable projection work will scale with the sound
affected source closure rather than all project sources. With approximately 300 project-owned
sources in the baseline corpus, the theoretical variable-work ceiling is about 300 times. After
fixed compiler, protocol, validation, and commit costs, the candidate is predicted to improve the
private-edit wall time by at least 20 times.

The candidate reuses `ttsc`'s resident `Session.Apply`, emitted `DeclarationShapeDigest`,
`DiagnosticsForFiles`, and the invalidation principles already exercised by `ttscgraph`. Codegraph
owns only fact-shard ownership, closure selection, and conservative fallback.

## Frozen acceptance thresholds

- private-edit wall time is at least 20 times faster than the counterbalanced baseline;
- extracted work and transmitted bytes scale with the affected closure, with no unaffected shard
  reload or rewrite;
- normalized incremental output is exactly equal to an independent cold rebuild;
- cold-path wall time regresses by no more than 5 percent;
- create, delete, rename, config/root-set, import-graph, declaration, ambient/global, and uncertain
  changes conservatively rebuild when a smaller closure is not proven;
- barrels, aliases, re-exports, project references, dependent public signatures, diagnostics, and
  cross-file implementation evidence have adversarial cold-equivalence proofs.

Any equality failure rejects the candidate until its generic invalidation cause is understood and
fixed. A corpus exception or weaker equality predicate is forbidden.

## Required attribution

Measure compiler update, declaration-shape analysis, module surface/dependency/diagnostic projection,
body/symbol/occurrence projection, identity hashing, serialization, native transport, validation,
SQLite commit, generated/transmitted bytes by namespace, allocations, heap, and peak RSS. Run both
instrumented attribution and uninstrumented wall-time trials so profiling overhead is visible.

The benchmark uses a declared private implementation fixture, not an entrypoint heuristic. It runs
at least five counterbalanced baseline/candidate pairs after one discarded warm-up and reports every
sample, paired ratios, medians, median absolute deviation, and a bootstrap 95 percent interval. The
20-times edit threshold applies to the paired median; the cold candidate median may be at most 1.05
times baseline and its upper interval must be reported rather than hidden.

## Current spike status

The rejected first selective-source candidate failed exact incremental/cold equality because it
reused a monolithic module fact when body-derived error codes and other source-owned observations
could change. That candidate remains rejected.

The replacement candidate retains compact shard references plus an explicit source-to-shard owner
index, reprojects one source for a private edit, expands public shape changes through TypeScript's
canonical reverse dependency graph, and conservatively rebuilds monolithic module observations. It
publishes commit-late and transmits only the affected upserts/deletes after a base exists. One
diagnostic Codegraph mirror run measured 4,511.53 ms for a private function-body comment versus a
115,924.72 ms independent cold oracle (25.70 times); it projected one source, sent 15 upserts and
four deletes in 699,455 wire bytes, and produced the exact same generation identity. This passes the
single-run wall threshold but is not yet the required counterbalanced qualification.

Eight adversarial microproject changes—private body, public shape, import graph, ambient scope,
create, delete, rename, and configuration—reconstructed facts exactly equal to their cold oracle.
The public change selected the three-source reverse closure; every uncertain/topology case selected
a complete rebuild. An injected application-store failure replayed the pending native candidate and
then matched cold, proving commit-late recovery. Six alternating cold microproject samples per arm
had effectively identical medians (baseline 209.8/208.6 ms; candidate 209.8/208.0 ms), so no cold
regression is visible at fixture scale.

Remaining before graduation: the frozen five-pair Codegraph benchmark with distribution statistics,
the Kernel holdout, SQLite no-rewrite evidence, and full governed qualification. These measurements
remain diagnostic-only until all four are complete.

The qualified post-cleanup attribution baseline contains 303 owned sources and 4,551 shards. One
instrumented cold memory run spent 69.1 seconds in projection: 21.9 seconds discovering symbols,
24.7 seconds emitting occurrences, and 20.4 seconds emitting bodies. It allocated approximately
88.3 GB cumulatively across 1.57 billion allocations before transmitting a 226.9 MB semantic
transaction as 302.5 MB of framed wire data. Memory materialization added 2.6 seconds; SQLite
materialization added 7.1 seconds. Profiling on/off reconstructed identical generations,
transactions, manifests, capabilities, and facts.

This establishes that an affected-source implementation must remove repository-sized work across
projection, transport, validation, and materialization. A source-local compiler extractor followed
by a complete manifest, full transaction reconstruction, or whole-generation rebinding does not
satisfy the scaling invariant even if one wall-time sample improves.
