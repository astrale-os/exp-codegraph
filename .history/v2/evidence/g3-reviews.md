# Gate 3 review record

Status: qualified

Date: 2026-08-14

Scope: immutable specification compilation, complete authoring-language disposition, frozen-corpus
shadow comparison, and governed oracle drift. This review does not authorize application cutover.

## Pass 1: ownership and import DAG

Evidence: `spec/specification/.spec`, the production import-DAG check, and snapshot typecheck.

- Specification compilation depends on inventory, source/schema parsing, declaration compilation,
  and static authoring syntax only. It does not import analysis stores, native sessions,
  conformance, catalog, CLI, server, or viewer code.
- Normative resource loading is owned by `specification/snapshot`; V2 does not widen private V1
  loader helpers into a shared accidental API.
- The public `@astrale-os/spec/specification` boundary exposes the snapshot compiler and immutable
  model without exposing mutable catalog or compiler handles.

## Pass 2: semantic and epistemic soundness

Evidence: `specification-snapshot.test.ts` and `specification-audit.json`.

- Static diagnostics belong to compilation; implementation, test, and physical-layout observations
  do not.
- Authored evidence references remain promises even when the referenced test is absent; the missing
  file becomes an observation diagnostic only in V1/downstream qualification.
- The complete 150-module Kernel audit reports zero authored differences and zero unattributed static
  diagnostics.

## Pass 3: native and trust boundary

Evidence: descriptor collision/alias fixtures and static resource loaders.

- Specification compilation has no native-process dependency and executes no repository module.
- Exact authoring package identity plus local import binding is sufficient for this deliberately
  closed language; repository barrels and arbitrary helper evaluation are not admitted syntax.
- Untrusted paths are bounded beneath the declared root and symbolic links in normative sources are
  rejected.

## Pass 4: language and downstream consumers

Evidence: the artifact disposition and full-corpus comparator.

- Every current artifact has an explicit semantic owner. No authoring syntax defect requiring a
  corpus rewrite was found.
- Aliased canonical helpers remain accepted and same-spelled local helpers remain rejected.
- Since there is no authoring syntax migration in Gate 3, the 150-source Kernel corpus and its direct
  consumers require no compatibility form; published-package consumer proof remains Gate 5.

## Pass 5: persistence, DX, failure, and performance

Evidence: deterministic identity tests, full-corpus audit, and V1 oracle rerun.

- Snapshot compilation is a headless function with explicit root and `.spec` directory inputs; it
  writes no output and owns no global process lifecycle.
- Deep immutability prevents downstream consumers from smuggling observations into normative state.
- Architecture-only edits do not churn normative identity. This corrects the tracked V1 defect
  without weakening authored-resource invalidation.

## Pass 6: adversarial self-hosting and oracle review

Evidence: all 150 current Kernel specifications compiled in shadow, plus the immutable historical
V1 witness projected by exact current source identity.

- The historical witness retains all 309 pre-cut specifications, while the current comparison
  projects it onto 150 Kernel-owned sources and records 159 excluded historical sources by digest.
- Effective package-root intent remains tested as a derived snapshot projection; authored parity
  compares the package resources once at their semantic owner.
- An invalid full-corpus audit now fails before governed evidence can be replaced and retains only a
  temporary candidate for diagnosis.
- The audit itself excludes shadow roots at discovery time, so later V2 submodules cannot alter the
  frozen Gate 3 input universe.
- Full TypeSpec/Kernel fact self-analysis remains Gate 6 and is not claimed here.
