# EXP-001: affected-shard incremental TypeScript analysis

Status: qualified; implementation accepted by V2-REV-021

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

The benchmark uses a declared private implementation fixture, not an entrypoint heuristic. The
original frozen method required at least five counterbalanced baseline/candidate pairs after one
discarded warm-up. That method was stopped after three complete measured pairs and one additional
baseline: a candidate cold rebuild took 727,952.98 ms and was immediately followed by a 77,273.04 ms
baseline cold rebuild. Accumulating more alternating whole-repository samples would not cheaply
distinguish candidate overhead from host noise.

The revised method preserves every completed run as diagnostic evidence, uses independent cold
rebuilds only as semantic oracles, and graduates on causal work rather than a long-lived historical
binary: exact incremental/cold equality; affected source, module, shard, fact, byte, allocation, and
SQLite row counters; adversarial fallback proofs; and a small isolated cold-attribution comparison.
The historical binary is not required to produce the same generation identity as the candidate and
is removed after attribution. The candidate still may not graduate with an unexplained cold-path
regression above 5 percent. The method change is explicit rather than a retroactive claim that the
aborted matrix satisfied its original distribution threshold.

The isolated cold-only attribution used the same 310-source, 4,736-shard corpus without an edit loop
or semantic export. The historical binary completed in 107,811.04 ms and the candidate in 78,022.31
ms, making the candidate 27.63 percent faster rather than regressed. Native projection fell from
99.64 seconds to 70.76 seconds and transport from 3.09 seconds to 1.74 seconds while semantic
transaction volume remained effectively unchanged (237,726,584 versus 237,731,170 bytes). The
candidate therefore passes the cold-path threshold; the 727.95 second sample remains disclosed as
host noise rather than being removed from the record.

## Current spike status

The rejected first selective-source candidate failed exact incremental/cold equality because it
reused a monolithic module fact when body-derived error codes and other source-owned observations
could change. Rebuilding all module observations restored soundness but left the Kernel holdout at
15,358.41 ms versus a 28,359.81 ms cold oracle: only 1.85 times faster despite selecting one source.

The first owner-selective module candidate then ran in approximately 805 ms but also failed exact
equality. Exact witnesses showed that a same-offset diagnostic retained its previous source revision
and that one selected module contained 31 inbound dependencies while its cold fact contained 70.
The corrected projector fingerprints source revisions contributing diagnostics and privately retains
canonical outbound edges from unchanged module owners when recomposing the selected public fact.
Public-shape, dependency, global-diagnostic, topology, configuration, plugin, and uncertain changes
still expand conservatively.

Current same-implementation diagnostic results are:

| Corpus | Private edit | Independent cold | Ratio | Scope | Wire bytes | Native cumulative allocation | Exact generation |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| Codegraph | 996.99 ms | 88,031.74 ms | 88.30x | 1 source, 1 module | 699,554 | 420,843,032 | yes |
| Kernel core | 826.69 ms | 24,709.47 ms | 29.89x | 1 source, 1 module | 886,090 | 472,392,776 | yes |

The corrected adversarial fixture now covers private body, private diagnostic, computed dependency,
public shape, static import, ambient scope, create, delete, rename, configuration, and failed-commit
replay. It uses overlapping module boundaries to prove owner selection and retained cross-owner
dependencies. Every scenario reconstructs the exact independent cold generation; uncertain and
topology changes select the complete safe fallback.

The first Kernel SQLite holdout showed that source-local native work alone was insufficient:
incremental refresh took 2,784.15 ms and SQLite commit consumed 1,996.50 ms, dominated by validating
the 492 changed facts one query at a time and repeating that work after the writer lock. Set-oriented
closure admission plus an exact base identity/sequence recheck reduced the same commit phase to
89.57 ms and the end-to-end edit to 1,046.77 ms while preserving the exact cold generation. The
locked causal recheck itself consumed 0.051 ms. Unaffected payloads were neither hydrated nor
rewritten; the transaction contained 14 shard upserts and two deletes against 2,305 manifest entries.
These samples diagnose and remove the persistence bottleneck but remain non-authoritative single
runs.

A second instrumented run attributed the physical database delta exactly: one generation, 14 shard
rows, 492 fact rows, and 14 compressed payload rows were added. The 2,305 unchanged shard payloads
and their facts were not rewritten. SQLite added 2,305 small membership rows for the new immutable
generation; the complete write phase remained 37.12 ms, so a persistent delta-manifest schema is not
currently justified. Set-oriented semantic admission was 23.15 ms, the locked base recheck 0.079 ms,
and total SQLite commit 115.67 ms on that run.

Graduation is complete. Generated evidence records 91.31x Codegraph and 28.73x Kernel private-edit
speedups, exact independent-cold equality, exact changed-payload row deltas, and all eleven
adversarial scenarios. The aborted matrix remains diagnostic-only; the accepted conclusion is in
`.history/v2/evidence/affected-shard-qualification.json` and V2-REV-021.

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
