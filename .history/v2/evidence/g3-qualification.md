# Gate 3 specification and language qualification

Status: qualified

Date opened: 2026-08-13

Date qualified: 2026-08-14

Gate 3 establishes a single immutable normative specification value without changing the admitted
authoring language. V1 remains operationally authoritative until Gate 5; the V2 compiler runs only
as a shadow comparator over the current Kernel-owned corpus.

## Qualified result

- `.spec/api.d.ts` remains the mandatory convention anchor and the inventory rejects unknown
  top-level artifacts, wrong file types, empty owned directories, symbolic links, and paths outside
  the declared repository root.
- descriptor modules are parsed but never imported or executed; calls are admitted only through a
  named binding imported from the exact `@astrale-os/spec/authoring` package identity, including
  aliases, while a same-spelled local function is rejected;
- `SpecificationSnapshot` is deeply frozen and content-addressed from portable normative resources
  plus static diagnostics; it contains no implementation binding, resolved test evidence, layout
  observation, verification result, architecture/history content, or presentation state;
- authored test references and intended layout remain normative inputs while their resolution and
  filesystem observation remain downstream evidence;
- the explicit artifact disposition covers API and internal declarations, ports, schemas,
  capabilities, flows, laws, states, limits, layouts, examples, benchmarks, package intent,
  architecture, history, icons, implementation bindings, test resolution, and layout observation;
- a full-corpus field-by-field comparison covers all 150 current Kernel convention modules and
  reports zero authored differences, zero legacy directories, zero static diagnostics, and zero
  unattributed diagnostics; and
- no authoring syntax change was ratified, so Gate 3 requires no corpus compatibility alias or
  mechanical source rewrite. Future authoring changes remain contract-first under `V2-MIG-003`.

## Oracle discipline

The historical V1 witness remains immutable at 309 repository specifications. Under
V2-REV-012, current authored discovery selects the 150 Kernel specifications that remain owned by
this repository; Admin, Shell, Issues, and Events rows stay visible in history but are not current
Gate 3 authority. V2 foundation specifications remain exact shadow roots for later self-analysis.

The refresh also exposed two audit defects. Effective package-root intent and its authority are
derived snapshot projections, so authored parity compares their owning package resources instead
of treating inherited child-module values as new authored fields. Invalid audit candidates are now
written only to a temporary diagnostic path and can no longer overwrite governed evidence.

These are comparator-boundary fixes, not accepted product drift. The one semantic difference found
by the language audit is separately governed as `V2-DRIFT-002`: V1 makes `architecture.md`
part of the normative revision. V2 correctly keeps rationale outside normative identity, as
ratified by `V2-REV-001` and protected by a rationale-only edit regression.

## Evidence

- `spec/.history/v2/evidence/specification-audit.json`
- `spec/__tests__/specification-snapshot.test.ts`
- `spec/__tests__/v1-oracle.test.ts`
- `spec/scripts/capture-v1-baseline.ts`
- `spec/.history/v2/drift.tsv`
- `spec/.history/v2/revisions/V2-REV-001.md`
- `spec/.history/v2/revisions/V2-REV-012.md`
- `spec/.history/v2/evidence/g3-reviews.md`

Commands:

```sh
pnpm --dir spec typecheck
pnpm --dir spec test:file __tests__/specification-snapshot.test.ts __tests__/v1-oracle.test.ts __tests__/v2-governance.test.ts
node --import <tsx-loader> spec/qualification/v2/specification/audit.ts --check
node --import <tsx-loader> spec/scripts/capture-v1-baseline.ts --check
pnpm spec:check:module spec/specification
node --import <tsx-loader> spec/scripts/check-v2-governance.ts
```
