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

The first uncommitted selective-source candidate passed the small SDK extension differential but
failed exact incremental/cold equality on the real Codegraph mirror. It remains diagnostic-only.
The likely causes must be established by evidence; no result from this candidate qualifies V2.

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
