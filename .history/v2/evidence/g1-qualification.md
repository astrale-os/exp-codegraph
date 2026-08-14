# Gate 1 substrate qualification

Status: qualified

Date opened: 2026-08-13

Date qualified: 2026-08-13

V1 remains authoritative until Gate 5. Gate 1 authorizes implementation of the generic V2
foundation; it does not authorize a TypeSpec consumer cutover.

## Qualified toolchain

- `ttsc` 0.26.2, exact npm integrity pinned in `spec/qualification/v2/ttsc/toolchain.json`;
- `@ttsc/graph` 0.26.2, graph serve protocol 1, snapshot protocol 1, dump schema 6;
- TypeScript-Go / `typescript` 7.0.2 at revision `56ab4af42157`; and
- Darwin arm64 `ttscgraph` SHA-256
  `5d25749de9aec0b27b9fa16b1f9bab7a66ace9156c8295223dec21b5dbe48cf5`; and
- the retained TypeSpec native plugin SHA-256
  `80de7d438bc08d623e926ebeeeaf8a21a530a6431edda4b6b7b30228182dda4d`.

An upgrade to any pinned package, native digest, protocol, schema, or compiler revision reopens this
gate as a qualification event.

## Evidence

The executable qualification is:

```sh
node spec/qualification/v2/ttsc/qualify.ts \
  --installation <isolated-exact-installation> \
  --native-output <retained-native-plugin> \
  --write
```

Its immutable-format result is
`spec/.history/v2/evidence/ttsc-qualification.json` (`status: qualified`). The run proved:

- canonical symbol resolution through aliases and barrels, while rejecting a same-spelled non-SDK
  function;
- referenced-project discovery and distinct production/test project universes;
- resident graph reuse, cancellation, disposal, and direct native protocol behavior;
- byte-equivalent cold versus incrementally materialized graph facts after body edit, file create,
  rename, delete, and configuration change;
- one-shard body-edit upsert with 71 of 72 shards retained in the qualifying fixture;
- source-digest, occurrence-call, argument-source, callback-body, one-hop parameter-binding, and
  bounded value-state facts through the supported `driver.LoadProgram` plus AST/Checker seam;
- two occurrence facts for two same-target calls even though the topology graph correctly carries
  one deduplicated call edge;
- stored, helper-returned, and closure callbacks with portable declaration/body spans;
- all four epistemic results: `known`, `unknown`, `ambiguous`, and `unsupported`;
- deterministic body-fact bytes on a cached rerun; and
- a cold source-plugin compilation and warm execution with local Go absent from `PATH`, plus native
  graph execution under the same condition.

The final exact-binary run compiled the source fixture without local Go in 44,107 ms and reused it
in 1,245 ms. The production TypeSpec plugin compiled in 4,844 ms and reused its cache in 718 ms.
These are evidence measurements, not yet product budgets. Governed conformance evidence may be
written only by the exact retained plugin digest above; a semantically equivalent rebuild with a
different Go build identity is deliberately rejected until it is qualified and rebound here.

## Ownership boundary

`@ttsc/graph` remains the symbol-level topology substrate. Its deduplication of repeated calls is
intentional and is not treated as a compiler defect. V2 owns a separate portable occurrence/body
fact layer built against ttsc's supported driver and TypeScript-Go shim APIs. This keeps compiler
objects and Go implementation types out of downstream contracts while avoiding a second checker.

No fork delta or missing upstream seam was required for Gate 1. If later implementation requires a
new compiler-level seam, V2-TS-012 requires an upstream proposal first; an owned fallback must be a
narrow, named, qualified fork delta.

Production body IR, CFG, def-use, interprocedural evaluation, persistence, and incremental body-fact
refresh remain obligations of later gates. Their absence is not concealed as graph support and does
not weaken their completion criteria.
