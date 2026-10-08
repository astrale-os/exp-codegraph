# Position-first semantic navigation

An editor cursor or diagnostic can select a canonical symbol, its owned
declarations and its authored usages without knowing an export name or building
a consumer-side compiler/index. This extends the structural-inspection frontier
at `866e8fe3643937799b0bbcf9250b099d50b71cf1` (PR #86).

```ts
const structure = await code.structure()
const position = { path: 'src/routes.ts', offset: 120 }
const selected = await structure.symbolAt(position)
const uses = await structure.references({ target: position })
// selected.symbols: canonical identity + name + declarations[{ path, span }]
```

`typescript.structure` alone suffices. The native producer, protocol and default
capabilities are unchanged. Both operations share one position selector; a
SourceId lookup table joins declaration locations in the existing persistent
structural graph. There is no second graph, parser or result cache.

## Correctness

The durable suites are `typescript-structural-navigation.test.ts` and
`typescript-structural-navigation-unit.test.ts` (22 cases). The public consumer
imports the package API; its independent oracle uses the TypeScript checker.

- Private helpers/members, shadowed parameters/locals, aliases, shorthand,
  namespace/literal access and every canonical overload declaration agree with
  the oracle. Full declaration-node ranges use UTF-16 offsets.
- Nested, unsorted rows select the narrowest containing site. Computed
  properties remain uncertain; equal candidates retain ambiguity.
- Expected revision mismatches return `stale` without symbols or usages.
  Source joins never attach old declaration spans to newer text.
- Missing, added, edited, relocated and deleted selections are tracked.
  Incremental reports equal fresh reports; unrelated edits reuse the callback,
  old pins remain exact and structural-only reads never load body/value facts.
- Source ownership rejects duplicate identities atomically and supports swaps
  and reused fact-ID relocation. Expired/cancelled readers reject publication.
- The isolated packed consumer typechecks exported declarations without source
  aliases, checks compatibility with verified-source reads, runs navigation and
  preserves the existing reference/dependency, cache and cold-equality checks.

The complete package suite passes **132 files / 1,115 tests**, with one existing
skip. All public/qualification typechecks and the governed architecture checks
pass. The isolated packed API artifact has SHA-256
`d96cbb4b6a2cb0fcf60b44bbd3202ed2cf4ba940ea1ebe940eccb9bfa943b1eb`.
The local shared-dependency checkout uses an OXC `tsconfig: false` test override;
the repository compiler settings remain unchanged.

## Observed cost

macOS ARM64, Node 26.8.1; an isolated synthetic index with 1,000 sources and 2,000
references. Fifteen builds per process, first three discarded; retained index
heap after explicit GC excludes the already allocated input facts. Existing
reference selection uses one file; query medians discard 500 warm-up reads.

| Observation | PR #86 baseline | Navigation candidate |
| --- | ---: | ---: |
| Index construction median | 5.36 ms | 6.59 ms |
| Retained index heap median | 1,288,400 B | 1,466,840 B |
| Existing reference-query median | 0.00137 ms | 0.00146 ms |
| Existing reference-query p95 | 0.00254 ms | 0.00246 ms |

The extra source table costs about 178 KB for this corpus and adds no duplicated
fact payloads. `symbolAt` scans only its source's references/symbols and joins its
declarations, O(R_file + S_file + D) with indexed source lookups; it does not walk
every project file. Existing whole-project reference queries retain their prior
scope-coverage and enumeration costs. These samples are observations, not a
production latency/RAM bound or a claim of an overall speedup.

The implementation adds **126 production lines** (models + owner + reader) and
about **6.8 KB generated JavaScript**, replacing the old private target-resolution
branch with the shared selector. The normative contract and generated types are
updated alongside it.

## Real-code calibration

Two copied files from Domains `services/utils/http-readiness`: `accept.ts`
(`75602572ec5aa5e7eccb7912f75b92fbf73818c314eff5ea73690eebc442944f`) and `index.ts`
(`7a6de9374e23fb38c3bc23c9864818f0aaf289209a5081c1e567d8978d942f32`).

The private `invalid()` helper resolves to **one canonical symbol, one declaration
and three references**, all agreeing with the independent oracle. Original input
hashes were reverified after the read-only calibration. A single sample gave
38.9 ms refresh, 5.86 ms initial inspection and 0.47 ms repeated computation;
the callback executed once. This small copied project uses `noLib`, so omitted
builtins correctly retain partial coverage; it is not a full-Domains benchmark.

The unchanged native artifact has SHA-256
`5c58b7b1fda5e9296bee6ed40fff58315a502e03fdd739d93045e6a1f3c939f2`.
Local receipts and situational memory/lifetime probes remain under
`.cache/navigation-evidence/`; durable correctness tests live in the PR.

## Scope

Positions address represented identifier/private-identifier/literal-access
tokens in loaded project-owned non-declaration sources. String/numeric property
declaration names and module-request strings are outside this symbolic-token
projection. `missing` means no represented site; external or `.d.ts` symbols can
resolve while their declarations remain outside the inventory. References are
authored bindings, not a safe automatic-rename plan or runtime call graph.

[Product usage and exact position semantics](../../../docs/typescript-structure.md)
· [Public contract](../../../analysis/typescript/structure/model.ts).
