# Gate 4 review record

Status: qualified

Date: 2026-08-14

Scope: exact native TypeScript module facts, immutable conformance, governed V1 comparison, and
memory/SQLite materialization parity over the Kernel corpus. This review does not authorize the
Gate 5 application cut or claim Gate 6 package release and full TypeSpec self-analysis.

## Pass 1: ownership and import DAG

Evidence: `spec/__tests__/architecture.test.ts`, `spec/__tests__/analysis-v2.test.ts`, static cycle
checks, and the full TypeSpec test suite.

- Analysis remains headless and imports no specification, conformance, catalog, CLI, server, or
  viewer code. Conformance consumes immutable analysis and specification contracts and owns no
  compiler or store mutation path.
- The top-level enforcement map omitted legitimate one-way V2 declaration-surface and semantics
  edges. The map now records them explicitly while the static cycle check and the stricter analysis
  extraction boundary remain green.
- The conformance oracle was an avoidable mixed-responsibility file. It is now partitioned beneath
  `qualification/v2/conformance/oracle` into model, digest, comparison, classification, and policy
  leaves.
- `conformance/module/comparison/evaluator.ts` was a 4,135-line recursive implementation leaf. Gate
  5 immediately split it into a 460-line module orchestrator, 1,583-line declaration evaluator,
  1,334-line type evaluator, and 901-line pure semantic algebra. V2-CON-005 and an automated
  2,000-line leaf ceiling prevent the monolith from returning.

## Pass 2: incremental and epistemic soundness

Evidence: `g4-conformance.json`, `g4-module-parity.json`, `sqlite-qualification.json`, and focused
conformance/store tests.

- The governed run binds 150 specifications to one exact 10-universe, 144-module native checkpoint.
  Six authentication leaves without a compiler universe are `indeterminate`; no missing fact is
  fabricated as a mismatch or pass.
- Qualification reports 122 pass, 22 fail, and 6 indeterminate modules, with no execution errors. All 150
  specification-validity profiles pass.
- Memory and SQLite return exact identities, manifests, capabilities, completeness, facts, and
  query digests for all 10 universes.
- Normalized incremental results equal clean rebuilds after edit, create, rename, delete,
  configuration, and branch-like churn. Repeated semantic IDs and pinned readers remain coherent.

## Pass 3: native maintenance and release boundary

Evidence: `ttsc-qualification.json`, the retained native plugin, and guarded writers in
`module-parity.ts` and `corpus.ts`.

- Governed evidence now records both the upstream `ttscgraph` digest and the exact custom TypeSpec
  plugin digest. A rebuild with different Go build identity cannot silently write authoritative
  conformance evidence even when its semantic payload happens to match.
- The final native SHA-256 is
  `a7e6cad10e606921c5b1dfad0bbb26607c7cb5be18dfc8ac4bea931677fe563b`; the exact checkpoint digest
  is `b2134c86eaf862b2fdc36ce9f119556fcd9e7c2cf09b7e2d3e42ce723776b881`.
- No compiler fork or second checker is present. Multi-platform packaged binaries remain the
  explicit Gate 6 obligation V2-TS-013.

## Pass 4: specification language and downstream contract

Evidence: the 150-spec governed Kernel audit, TypeSpec authoring typecheck, specification snapshot
tests, and governed module conformance.

- The governed specification audit reports 150 current Kernel specifications and zero authored,
  static, observation, or unattributed diagnostics. Governance reports 82 requirements, 7 gates,
  26 drift decisions, and zero diagnostics.
- Callable aliases, optional alias structure, algebraic types, branded/asserted returns, dependency
  closure, and precise observation issues are represented by the canonical V2 surface rather than
  V1 reduction artifacts.
- No application consumer is switched in Gate 4. CLI, JSON, HTTP, catalog, editing, reveal, and
  viewer migration remain one coordinated Gate 5 authority cut.

## Pass 5: persistence, failure, performance, and DX

Evidence: `codegraph-spike.json`, `codegraph-upstream-tests.json`, `codegraph-benchmark.json`,
`sqlite-qualification.json`, and the shared transactional suite.

- The named Codegraph gate rejects a direct dependency and wholesale fork. TypeSpec owns its
  normalized content-addressed materializer and currently copies no Codegraph source; reuse is
  classified as conceptual operational influence with pinned Apache provenance.
- Normalized generations, shards, fact envelopes, evidence, and inputs are independently indexed;
  production schema v3 contains no whole-generation `snapshot_json` value.
- Cross-process writer serialization, renewable leases, retention, crash rollback, v1/v2
  migration, corruption quarantine, advisory memory fallback, and durable-store failure all have
  direct evidence.
- Codegraph and TypeSpec payloads are not treated as fact-equivalent. Their timings remain
  operational evidence, never a semantic waiver or an efficiency ratio.

## Pass 6: adversarial self-hosting and oracle review

Evidence: the exact 150-spec Kernel corpus, 144 compiler-observed modules, adversarial ttsc fixture,
and fail-closed oracle policy.

- The immutable 309-spec historical V1 witness is projected generically by current canonical source
  identity: 150 Kernel sources are retained, 159 out-of-authority historical sources are excluded
  with an exact digest, and no current source is absent.
- All 150 directly comparable V1/V2 rows contain zero newly detected unexplained findings. All 262
  differences belong to exact counted and digested policy groups; the oracle has zero unexplained
  witnesses.
- Twenty V1 findings are corrected rather than copied into V2. The retained policy also accounts
  exactly for 223 coverage refinements, 12 unavailable-leaf witnesses, 5 diagnostic refinements,
  and 2 status refinements.
- The Kernel conformance corpus is qualified here. Full TypeSpec fact self-analysis, SDK-extension
  persistence, release packaging, and final suspicious-fact reruns remain Gate 6 and are not claimed.

## Reproducible verification

- `pnpm --dir spec typecheck`
- `pnpm --dir spec test`
- `node --import <tsx-loader> spec/qualification/v2/specification/audit.ts --check` — 150 current Kernel specifications, zero diagnostics or authored differences
- `node --import <tsx-loader> spec/scripts/check-v2-governance.ts` — 82 requirements, 7 gates, 26 drift decisions, zero diagnostics
- `pnpm --dir spec exec vitest run __tests__/architecture.test.ts __tests__/analysis-v2.test.ts __tests__/conformance-v2.test.ts __tests__/v2-governance.test.ts --testTimeout 30000 --maxWorkers 2` — 61 tests
- `shasum -a 256 spec/.history/v2/evidence/g4-conformance.json` —
  `12e444397e41d772c1872d507a10387973386b1888838e2e630f1c8f72fd25ce`
- `shasum -a 256 spec/.history/v2/evidence/g4-module-parity.json` —
  `eda772985012d11daf1f13163e899fff1f43d12063103eba88936fbe15c12b45`
