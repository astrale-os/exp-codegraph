# Gate 2 generic foundation qualification

Status: qualified

Date opened: 2026-08-13

Date qualified: 2026-08-13

Gate 2 builds and qualifies the reusable headless fact, pass, snapshot, query, repository, memory,
SQLite, native protocol, and body-IR foundation. Modules in this gate may not import TypeSpec
authoring, compiler, qualification, CLI, server, viewer, or transport code.

The normative module DAG and public contracts must be specified before their implementations advance
to `implemented`. Evidence will include import-boundary checks, memory/SQLite equivalence,
incremental-versus-cold differentials, cancellation and failure tests, and an unrelated TypeScript
fixture proving that the public foundation is not overfit to TypeSpec or the frozen V1 oracle.

## Qualified slices

The following Gate 2 slices now have executable evidence:

- extraction-ready `.spec` contracts for identity, facts, generations, passes, queries, memory,
  SQLite, native protocol, portable policy, TypeScript source/symbol/occurrence/body/value analysis,
  and repository inventory;
- an automated production-import DAG and headless-boundary test;
- deterministic portable identities, non-cyclic semantic shard digests, complete manifests, atomic
  memory materialization, pinned readers, filter-bound pagination cursors, and snapshot sets;
- a SQLite implementation that shares the materializer/query semantics, persists exact snapshots,
  reopens them, and supports recurring content-addressed generation IDs at later commit sequences;
- explicit process construction, framing limits, cancellation, failure, and disposal for native
  JSONL sessions;
- the production TypeScript-Go native module compiled by ttsc with local Go absent from `PATH`;
- production native transactions validated by the generic TypeScript store, stable unchanged
  refreshes, 19-of-32 shard incremental replacement for the adversarial edit, and byte-semantic cold
  equivalence;
- one project, zero diagnostic, 5 source, 67 symbol, 28 occurrence, and 19 body facts over the
  cleanly typechecked unrelated SDK-like fixture, retaining all 17 call occurrences and all 9
  compiler-resolved SDK calls;
- 153 body parent/role relations, every declared CFG edge kind, resolved signatures and
  argument/parameter bindings, callback identities, 18 conservative reaching definitions, and all
  four bounded value states; and
- focused exact-layout qualification for the TypeScript adapter plus the generic foundation unit
  suite and TypeScript typecheck.

The portable pass runner also qualifies staged dependency visibility, externally available base
capabilities and schemas, exact implementation-manifest matching, mandatory abort, and optional
`unavailable` completion materialization. The portable evaluator proves context-sensitive
argument-to-parameter-to-return propagation across two calls to the same helper without conflating
their values. The TypeScript pipeline retains its resident native lineage privately, stages the
portable closure over the complete native manifest, publishes one final transaction, and proves on
the unchanged refresh that the next native base is still the private native generation rather than
the consumer-visible portable generation.

The read-only policy runner validates installed manifests and exact rule output, provides policies
only a pinned query, turns missing or incomplete required evidence into `indeterminate`, and
materializes no facts. Native wire admission validates the complete transaction envelope before
semantic store validation rather than shallow-casting a transaction-shaped object.

The SQLite suite now covers exact memory equivalence and reopening, content-addressed generation
recurrence, renewable cross-connection snapshot leases, lease-safe garbage collection, the v1-to-v2
schema migration, corrupt semantic snapshot quarantine, and clean rebuild from quarantined derived
data.

The native body schema now emits statement-level branch and loop blocks with fallthrough, true,
false, loop, exception, and return edges. The fixture's conditional expression is retained through
the occurrence relation tree and bounded evaluator, but its expression-level branch is still
reported as `partial:CFG_EXPRESSION_BRANCH_PARTIAL`; bounded interprocedural composition is
performed portably through parameter bindings and function summaries.

The full TypeSpec owned suite passed 66 files and 557 tests after a clean build. All 14 analysis
module specifications passed focused exact-layout checks with zero diagnostics. The six required
review perspectives and their finding dispositions are recorded in `g2-reviews.md`.

## Design defects caught during implementation

Seven foundation flaws were corrected before Gate 2 could be treated as qualified:

1. carried semantic shards originally retained the prior generation binding; the materializer now
   atomically rebinds every fact to the committed generation;
2. content-addressed generation identity can legitimately recur after a source revert, so memory
   and SQLite retain commit occurrences by monotonic sequence rather than rejecting a repeated
   semantic ID; and
3. spans and argument lists alone were insufficient for reusable SDK-aware policies, so body IR now
   retains generic parent/child roles (`callee`, indexed argument/property, `name`, `initializer`,
   conditions, and branch arms) plus resolved symbol identity on occurrences.
4. the adversarial project-reference fixture had silently carried TypeScript error 6310 because its
   composite child disabled emit; diagnostic facts exposed it, the fixture now emits declarations
   correctly, and production qualification requires zero diagnostics.
5. committing the native transaction before portable derivation would have exposed an intermediate
   generation and then sent the published portable generation back as a base the resident compiler
   did not produce; the pipeline now keeps native lineage private and publishes the complete staged
   generation atomically.
6. the pass runner existed without the separately ratified read-only policy boundary; the new
   policy runner has no store/transaction port and represents unavailable evidence as indeterminate.
7. process frames were bounded but transaction payloads were only shallow-checked before a typed
   cast; full structural wire admission now precedes semantic transaction validation.

These are V2 contract corrections discovered independently of the V1 oracle; none is accepted as
untracked oracle drift.
