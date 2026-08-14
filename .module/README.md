# Semantic-intelligence design module

This private TypeSpec design module records the bottom-up consumer pressure for the reusable V2
analysis platform. It deliberately specifies capability meaning before CLI commands or TypeScript
factory names.

- `intelligence-taxonomy.schema.json` is the structural authority for taxonomy version 1.
- `intelligence-capabilities.yml` is a selected, ambitious candidate catalog classified through
  that taxonomy. Its `roadmap` records the V1 proof slice, named future integration families, and
  explicit capability dispositions. It is design input, not yet a ratified V2 requirement or
  public API.
- `typespec-platform-public-api.md` explores and refines the generic TypeSpec platform surface.
- `consumer-sdk-cli-api.md` explores and refines the downstream business SDK and intent-driven CLI.
  The two API documents share pressure identifiers and must be revised together.

## Classification laws

1. One catalog row describes one atomic result-producing step and therefore has exactly one
   operator.
2. `MODEL` and `EVALUATE` belong to the `STATIC` semantic world. Their conclusions exist without a
   caller question even if an implementation computes them lazily.
3. `EXPLORE`, `PREDICT`, and `STABILIZE` belong to the `RUNTIME` semantic world because they require
   an explicit selection, scenario, or target invariant. This use of runtime is distinct from the
   `DYNAMIC` program-analysis dimension.
4. Every capability crosses at least two dimensions. `TEMPORAL` and `SPATIAL` normally qualify
   structural, semantic, or dynamic content rather than replacing it.
5. A lens is listed only when the capability explicitly analyzes that quality. It is not a generic
   assertion that implementation should be secure, fast, observable, or pleasant.
6. `MODEL` is descriptive. `EVALUATE` owns governed pass, fail, indeterminate, and error outcomes.
   Counts and graph metrics are never automatic quality scores.
7. `STABILIZE` requires an explicit desired invariant, reviewable preconditioned changes, and
   subsequent re-modeling and re-evaluation.
8. Every nontrivial conclusion must eventually expose evidence, provenance, completeness, and its
   derivation or explanatory path. Unknown, ambiguous, unsupported, unavailable, and stale remain
   first-class outcomes.
9. Installation, indexing, sync, freshness, locking, daemon lifecycle, telemetry, and upgrades are
   control-plane concerns. They do not receive semantic operators and must not masquerade as
   repository health.
10. CLI, library, MCP, IDE, CI, viewer, and agent surfaces are projections over these capabilities;
    none is the semantic authority.

The catalog is intentionally broader than the first implementation slice. Its purpose is to make
missing generic APIs visible before TypeSpec V2 overfits its own immediate consumers.

## Roadmap laws

1. The default state is `catalogued`; absence from V1 is neither rejection nor an implementation
   claim.
2. `kernel-supported` means current public primitives can compose the capability in architecture,
   not that a production consumer has proven it.
3. `v1-proof` identifies the deliberately small adversarial set used to qualify a platform
   foundation or extension role. It does not turn the whole capability catalog into V1 scope.
4. `product-integrated` requires a real independently packaged consumer using only public exports.
5. `deferred` names the milestone and missing specialized contract; `blocked` names a concrete
   missing primitive or unresolved semantic decision.
6. Milestones form a dependency DAG. A future family may extend public definitions and roles only
   through compatibility, differential, scale, failure, and published-consumer evidence.
7. Capability dispositions are unique overrides. Every undisposed capability inherits
   `catalogued`, so the roadmap stays exhaustive without pretending that all ideas are scheduled.
8. `proof` values are stable qualification-case identities, not prose claims. The implementation
   qualification manifest must resolve every case to fixtures, asserted semantics, exercised
   roles/capabilities, applicable stores/providers, and retained evidence.
