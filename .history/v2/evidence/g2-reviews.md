# Gate 2 review record

Status: qualified

Date: 2026-08-13

Scope: reusable analysis, TypeScript adapter, repository inventory, memory/SQLite materialization,
native protocol, pass/policy execution, and bounded body/value semantics. This review does not
authorize TypeSpec application cutover or claim the Gate 6 Kernel self-hosting proof.

## Pass 1: ownership and import DAG

Evidence: `spec/__tests__/analysis-v2.test.ts`, `spec/__tests__/architecture.test.ts`, and focused
checks for all 14 `spec/analysis` module specifications.

Findings and dispositions:

- The foundation has no imports from TypeSpec compiler, catalog, verification, CLI, server, viewer,
  framework, or application code. Enforced by a production-source import scan.
- A dedicated read-only policy owner was missing even though policy was ratified. Fixed by adding
  `analysis/policy`; policy context exposes a pinned query but no store or transaction capability.
- Native/portable composition initially risked publishing two generations. Fixed by keeping the
  resident native lineage private and publishing one complete staged transaction.
- Public subpaths remain `analysis`, `analysis/typescript`, `analysis/sqlite`, and `repository`;
  internal folders are not accidentally added as package exports.

## Pass 2: incremental and epistemic soundness

Evidence: the production-native portion of `ttsc-qualification.json` plus foundation tests for
repeated semantic generation IDs, carried-shard rebinding, optional/mandatory passes, policy
indeterminacy, contextual helper evaluation, and cold/incremental equivalence.

Findings and dispositions:

- Shard digests correctly omit only the cyclic enclosing generation binding; materialization
  rebinds carried facts at commit.
- A reverted source may reproduce an earlier semantic generation ID. Stores retain occurrences by
  monotonic sequence and resolve a semantic ID to the latest retained occurrence.
- Optional pass failure produces `unavailable`; missing policy evidence produces `indeterminate`;
  neither is converted to absence or a negative match.
- The native edit replaced 19 of 32 shards and was byte-semantically equal to a cold build. Create,
  rename, delete, config edit, and config restore also passed cold differentials.

## Pass 3: native maintenance and trust boundary

Evidence: exact ttsc toolchain pins, source-plugin cold/warm packaging with local Go absent, process
session tests, and regenerated native qualification.

Findings and dispositions:

- No upstream fork is currently required; compiler-near work uses the supported ttsc driver and
  TypeScript-Go shim.
- Wire admission was initially shallow after frame-size validation. Fixed: the process adapter now
  validates the complete generation, producer, manifest, shard, fact, provenance, completeness,
  span, capability, path, and identity envelope before returning a transaction.
- Repository configuration cannot select source plugins. The invoking application supplies an
  explicit installed command and capability set.
- Built multi-platform package delivery remains Gate 6; Gate 2 proves source-plugin construction
  and execution on the qualifying Darwin arm64 platform only.

## Pass 4: language and downstream extension surface

Evidence: exact `.spec` contracts for every analysis submodule, the unrelated adversarial SDK-like
fixture, and the portable pass/policy/value tests.

Findings and dispositions:

- Body IR needed semantic occurrence relations beyond spans and flat arguments. It now retains
  parent/child roles, symbols, calls, parameter bindings, callbacks, summaries, CFG, and conservative
  definition-use.
- The public value algebra remains exactly `known`, `unknown`, `ambiguous`, or `unsupported`.
- Two calls through the same helper remain context-separated by call binding; the evaluator does
  not conflate their arguments or returns.
- Conditional-expression CFG is explicitly partial under `CFG_EXPRESSION_BRANCH_PARTIAL`; this is
  visible completeness, not a hidden negative.

## Pass 5: persistence, failure, and DX

Evidence: memory/SQLite equivalence, reopen, recurring-ID, cross-connection renewable lease,
lease-safe collection, v1-to-v2 schema migration, corruption quarantine/rebuild, cancellation,
disposal, stale-base, atomic pipeline, and deterministic query tests.

Findings and dispositions:

- Both stores share one materializer/query implementation, preventing semantic drift behind
  storage-specific branches.
- SQLite snapshots are derived evidence: invalid payloads are quarantined and the next open permits
  a clean rebuild; incompatible schema fails explicitly.
- Readers remain pinned across commits and renewable leases prevent garbage collection while a
  cross-connection query is live.
- Headless APIs receive roots, stores, sessions, passes, policies, limits, cancellation, and disposal
  explicitly; they write no ordinary output and install no global lifecycle handlers.

## Pass 6: adversarial self-hosting boundary

Evidence: the TypeSpec package builds itself, its production import graph is scanned, all 14
analysis `.spec` contracts compile, and the full owned suite passes 66 files and 557 tests under the
existing test configuration.

Findings and dispositions:

- No foundation import reaches the TypeSpec product/application layers it will later serve.
- The full Kernel semantic self-analysis, suspicious-fact audit, SQLite restart differential, and
  performance thresholds remain explicitly owned by Gate 6 and are not claimed here.

## Commands

```sh
pnpm --dir spec typecheck
pnpm --dir spec test
pnpm spec:check:module spec/analysis
node --import <tsx-loader> spec/qualification/v2/ttsc/qualify.ts \
  --installation /private/tmp/ttsc-sdk-probe.lawPbo --write
node --import <tsx-loader> spec/scripts/check-v2-governance.ts
```

Result: 66 test files and 557 tests passed; all 14 focused analysis specifications reported zero
diagnostics; exact ttsc/native qualification remained `qualified`.
