# Gate 4 conformance and materialization qualification

Status: qualified

Date opened: 2026-08-13

Date qualified: 2026-08-14

Gate 4 reimplements expected-versus-observed comparison and applicable verification profiles over
immutable specification and analysis snapshots. It qualifies memory and SQLite through one shared
transactional suite, including failure and recovery cases, and admits no V1/V2 difference unless
the governed drift ledger explains it.

V1 comparison is contract-based under V2-REV-003. Module ownership, exports, dependencies, package
intent, source coverage, errors, and consumer-visible diagnostics remain exact unless a named
semantic revision says otherwise. The canonical V2 public type surface is qualified directly
against its `.spec` contract and adversarial ttsc fixture; V1 compiler-reduction shapes remain audit
telemetry and may differ only through the fail-closed equivalence class in V2-DRIFT-005. Stable
platform identities are governed by V2-DRIFT-004.

Focused differential runs resolve the complete boundary graph but load only the selected compiler
universe. They cannot write governed evidence. Full-corpus fresh-native runs remain the only Gate 4
parity authority.

Gate 4 authority is bound to `g4-conformance.json`, `g4-module-parity.json`, the exact qualified
native plugin in `ttsc-qualification.json`, store differential evidence, and all six passes in
`g4-reviews.md`.

## Codegraph architectural decision gate

The named Codegraph 3.16.0 source and integration spike is recorded in
`codegraph-spike.json`; focused upstream-suite evidence is recorded in
`codegraph-upstream-tests.json`. It rejects a direct dependency and wholesale fork while retaining
exact reusable machinery and test provenance. V2 remains the semantic authority above `ttsc` and now
owns a normalized, content-addressed SQLite materializer rather than promoting the earlier
whole-generation snapshot-JSON reference store.

The governed operational benchmark is additive evidence: latency cannot waive the failed ingestion,
generation, identity, provenance, completeness, configuration-churn, or cold-equivalence
requirements. In `codegraph-benchmark.json`, body-enabled Codegraph builds of both TypeSpec and
Kernel exceeded the governed 180-second per-corpus limit. The 295 MB, 15-universe TypeSpec semantic
checkpoint parsed in 2.731 seconds and materialized in 29.539 seconds with a 296.6 MB database;
open-plus-first-page median was 72.632 ms and p95 was 762.007 ms. These payloads are not
fact-equivalent, so the measurements are operational evidence rather than a winner-by-size claim.

The normalized materializer block is qualified by `sqlite-qualification.json`: baseline, edit,
create, rename, delete, branch-like churn, and a configuration-derived universe produced identical
normalized facts in incremental SQLite, memory, and clean SQLite. Schema evidence confirms that
generations, content-addressed shards, facts, evidence, and inputs are independently indexed and
that `snapshot_json` is absent.

## Exact native conformance

The authoritative run used native plugin SHA-256
`a7e6cad10e606921c5b1dfad0bbb26607c7cb5be18dfc8ac4bea931677fe563b` and fresh checkpoint SHA-256
`b2134c86eaf862b2fdc36ce9f119556fcd9e7c2cf09b7e2d3e42ce723776b881`. It analyzed 144 modules in
10 project universes and joined them to all 150 current Kernel specifications. Memory and SQLite
projections were exactly identical.

Qualification produced 122 pass, 22 fail, and 6 indeterminate outcomes, with no execution errors.
These are Kernel findings, not test failures: every specification-validity profile passed and each
non-pass outcome retains causal diagnostics and coverage. The six specification-only authentication
leaves without a compiler target remain explicitly indeterminate.

The frozen historical V1 catalog remains immutable at 309 specifications. Under V2-REV-012, the
generic source-identity projection retains the 150 current Kernel specifications and records all
159 out-of-authority historical rows by digest
`95aeb6afd7ccc94f04ab8616861b7c12c59959dd8548f70cfebb18fa6508e31b`.
No current source is absent from the historical witness, and no product-Domain exception or
hard-coded exclusion participates in the projection.

Across all 150 directly comparable rows, V2 introduces zero unexplained findings. The complete 262
difference set has digest `6c68055463c37abe62dfbd234eab08c654408192107dd2d3082af2992b57edf9`
and is an exact subset of the prior repository-wide witness: the 207 removed rows are precisely the
Admin, Shell, Issues, and Events sources that no longer own specifications. Every retained witness
belongs to an exact counted and digested governed group. The qualification digest is
`6d740a8b58d64c403d9939f10c60cc4805f49ea283a4d1fb91cbfbf1fdf6171b`.

## Exit review

All six mandatory perspectives are recorded in `g4-reviews.md`. A maintainability finding on the
large recursive comparison evaluator was not concealed as a semantic failure: V2-CON-005 carried
the hierarchical split into Gate 5, where it was completed before application authority switched.
The enforced leaves now separate module orchestration, declaration comparison, type comparison,
and pure semantic algebra.
