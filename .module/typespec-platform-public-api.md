# Candidate: TypeSpec semantic-platform public API

Status: broad-to-refined co-design input; not a ratified V2 contract.

Companion: [`consumer-sdk-cli-api.md`](./consumer-sdk-cli-api.md).

Taxonomy: [`intelligence-taxonomy.schema.json`](./intelligence-taxonomy.schema.json).

Capability pressure: [`intelligence-capabilities.yml`](./intelligence-capabilities.yml).

## Goal

Expose the smallest complete, extraction-ready semantic-analysis kernel from which an unrelated
downstream project can implement valuable analysis now and integrate materially new analysis later
without replacing the kernel, importing TypeSpec product internals, touching a compiler or
database, casting unknown fact payloads, matching private namespace strings, or waiting for
TypeSpec itself to adopt the downstream domain.

“Without a blocker” does not mean the platform predicts every future analysis. It means that a
consumer can either:

1. compose an answer from typed public models and algorithms;
2. add a portable typed extension over existing public models; or
3. add a versioned compiler-near capability through an explicit trusted extension boundary.

No ordinary extension receives live TypeScript-Go AST or Checker pointers. Compiler-sensitive
questions become versioned portable facts, not ad hoc synchronous Checker RPC.

V1 is not required to implement every catalog capability or pre-design every future analyzer. It
must make the architectural center correct: typed semantic definitions, coherent snapshots,
extension registration and planning, efficient incremental derivation, graph/query composition,
evaluation, explicit trust tiers, compatibility, and public qualification. Future capability
families may add contracts at those deliberate seams without bypassing them.

## Paired design method

The platform and consumer are designed as a feedback loop rather than a stack completed in order:

```text
consumer intent
    -> generic semantic requirement
        -> candidate platform primitive
            -> simpler consumer journey
                -> attempted real rule/impact/stabilization
                    -> exposed missing primitive or over-generalization
                        -> revise both sides and repeat
```

Every downstream pressure has a stable `D-*` identifier. The companion consumer document uses the
same identifiers. A platform concept survives refinement only when at least one valuable consumer
journey needs it and it remains generic across plausible consumers.

## Ownership boundary

### The platform owns

- exact source, repository, project-universe, package, module, document, symbol, occurrence, body,
  control-flow, definition-use, type, value, and evidence models;
- immutable snapshots, cross-universe snapshot sets, semantic diffs, provenance, completeness,
  freshness, verified source text, and source-safe edits;
- typed schemas and readers for built-in and extension facts;
- typed graph projections and generic graph algorithms;
- typed selectors, query composition, explanation paths, and bounded traversals;
- generic evaluation and diagnostic contracts, plus bounded typed query inputs and results in V1;
- versioned scenario, prediction, and stabilization-plan contracts when those reserved families are
  introduced;
- explicit extension registration, capability planning, isolation, validation, and testing;
- control-plane lifecycle required to make a coherent semantic snapshot available; and
- transport-neutral result models usable by libraries, CLI, CI, MCP, IDEs, viewers, and agents.

### The platform does not own

- Astrale SDK builder names, canonical SDK identities, or business semantics;
- Astrale architecture, security, experience, performance, or observability rules;
- downstream severity, policy presets, suppressions, organization configuration, or release policy;
- business command names, workflows, prose, ranking defaults, or interactive presentation;
- whether a proposed change is desirable for a particular product;
- repository-selected executable extensions; or
- a universal quality, risk, health, centrality, maintainability, or impact score.

### The consumer owns

The companion SDK/CLI owns the downstream semantic vocabulary, rules, journeys, defaults, and
presentation. It may publish typed domain facts through platform extensions, but those facts remain
owned and versioned by that consumer rather than becoming TypeSpec built-ins.

## Semantic classification contract

- `MODEL` and `EVALUATE` capabilities belong to the `STATIC` semantic world. Their meaning exists
  for an exact snapshot and effective configuration without a caller question, even when computed
  lazily.
- `EXPLORE`, `PREDICT`, and `STABILIZE` capabilities belong to the `RUNTIME` semantic world because
  they require an explicit selection, scenario, or target invariant.
- The `DYNAMIC` dimension describes possible program behavior and is independent of the `RUNTIME`
  semantic world.
- Control-plane operations have no semantic operator. Refreshing, persisting, or serving an answer
  cannot change its operator, dimensions, lenses, evidence, or authority.

## Load-bearing extension kernel

The extension kernel is an independent platform subsystem, not a convenience wrapper around the
current portable-pass callback. It has six authorities:

```text
typed definitions -> registry -> capability planner -> execution coordinator
                                               |                |
                                               v                v
                                      effective plan       staged outputs
                                                               |
                                         atomic snapshot <- admission
                                               |
                                     typed query and graph views
```

1. **Definition** owns globally named, versioned, runtime-admitted semantic kinds and capabilities.
2. **Registry** owns explicitly installed extensions, producer uniqueness, trust, and compatibility.
3. **Planner** owns capability closure, dependency order, configuration identity, invalidation, and
   effective limits.
4. **Execution** owns partitions, deltas, bounded readers, cancellation, scheduling, and isolation;
   extensions own semantic derivation only.
5. **Admission and materialization** own validation, provenance, completeness, and atomic snapshot
   publication.
6. **Query and graph** own generation-pinned typed access shared by first- and third-party
   consumers.

An extension never owns stores, cache paths, worker pools, process signals, generation commits, or
query indexes. Those mechanics may evolve without changing extension semantics.

### Stable semantic definitions

The V1 kernel needs typed public definitions for at least:

- `EntityKind<Identity, Attributes>`;
- `FactKind<Subject, Payload>`;
- `EdgeKind<From, To, Payload>`;
- `Capability<Version>`;
- typed selectors and graph projections; and
- operation and result definitions carrying the locked classification and result algebra.

Each definition has a globally namespaced identity, an independent schema version, runtime
admission, identity/equality rules, and a compatibility policy. Extension version, capability
version, fact-schema version, and output-projection version are distinct. An extension upgrade
cannot silently reinterpret persisted bytes or identities.

One generation plan selects exactly one authoritative producer for each produced kind. An
extension may derive a distinct perspective or relationship, but it cannot silently override a
built-in or another extension. Missing producers, collisions, incompatible schema ranges, cycles,
or ambiguous versions fail planning causally.

### Minimal extension roles

V1 should stabilize four roles rather than one unlimited plugin interface:

| Role | Semantic responsibility | Publication |
|---|---|---|
| Materialized model | Derive reusable `STATIC` model facts and edges | Atomically materialized in the semantic snapshot |
| Evaluation rule | Evaluate governed `STATIC` criteria over an immutable model | Separate evaluation snapshot pinned to model and rule configuration |
| Query algorithm | Perform bounded `RUNTIME` exploration or prediction over immutable typed views | Ephemeral typed result unless explicitly recorded as evidence |
| Projection | Convert an operation result to a versioned transport or presentation model | Never semantic authority |

A trusted compiler-near provider is a fifth privilege tier, not an ordinary role. It supplies exact
portable facts required by materialized models. V1 must publish its capability and compatibility
contract and qualify at least one consumer-defined provider, while installation and binary
distribution remain explicitly host controlled.

Document adapters use the materialized-model role plus an owned source port in V1. Future external
evidence ingestors should reuse that role plus a separately governed evidence-admission port. A
dedicated external-engine execution provider, generalized scenario overlays, and first-class
stabilization providers are planned extensions of the kernel rather than requirements to complete
V1.

An extension bundle only groups separately defined roles, kinds, configuration schemas, and
compatibility declarations. It does not replace their individual contracts with one untyped
`run(context)` callback.

### Manifest and planning contract

Every extension role declares typed, inspectable planning metadata. The base manifest is shared;
its `execution` field is a closed discriminated contract for materialized model, evaluation rule,
request-time query algorithm, or projection. This avoids both an unlimited callback and optional
fields whose meaning changes by convention:

```ts
interface ExtensionManifest {
  readonly id: ExtensionId
  readonly version: ExtensionVersion
  readonly hostApi: CompatibilityRange
  readonly role: ExtensionRoleRequirement
  readonly configuration: ConfigurationSchema
  readonly requires: readonly CapabilityRequirement[]
  readonly provides: readonly CapabilityProvision[]
  readonly reads: readonly SemanticKindRequirement[]
  readonly writes: readonly SemanticKindProvision[]
  readonly scope: ExtensionScope
  readonly execution: ExtensionExecutionContract
  readonly limits: AnalysisLimits
  readonly trust: ExtensionTrust
}
```

Semantic capability definitions—not projections—carry the locked intelligence classification.
Materialized and evaluation execution contracts declare partitions and deltas; query algorithms
declare typed request and result definitions plus request bounds; projections declare accepted
result definitions and output schema without permission to reinterpret classification or semantic
state. Role-specific builders make invalid combinations unrepresentable.

References are typed definitions and version ranges, not namespace strings. Effective
configuration is admitted once, normalized, digested, and returned by the plan. Any configuration
field that affects meaning participates in invalidation and provenance.

V1 uses a closed, useful set of partition scopes—source, symbol/function, module, project, and
repository. Cross-repository and custom partition providers may be added later without changing
the fact, snapshot, or capability contracts. An extension declares the narrowest correct scope; it
cannot claim per-source incrementality while reading untracked repository-wide state.

### Compatibility and evolution

Compatibility is negotiated before planning, never discovered halfway through execution. An
extension declares the supported host API and role-contract ranges; capability requirements and
semantic kind requirements independently declare their accepted versions. The effective plan
returns the exact selected versions and configuration digests.

An additive TypeScript declaration is not automatically a semantic compatibility promise. A
change to identity, equality, derivation meaning, completeness, partition ownership, or serialized
interpretation requires the corresponding definition version to change. Cached or persisted
outputs are reused only when the host can prove semantic compatibility; otherwise their owning
derived partitions rebuild from admitted inputs. No extension-provided migration code may mutate a
committed generation in place.

New extension roles begin as explicitly experimental contracts and graduate only with a real
consumer, conformance suite, differential evidence, scale evidence, failure/isolation cases, and a
documented compatibility policy. Existing stable roles are extended additively where honest or by
a new version where not; a speculative future feature is not a reason to weaken a V1 type into an
unvalidated optional bag.

### Incremental execution contract

Incrementality is semantic behavior of the extension kernel, not an optional cache optimization.
The coordinator provides each materialized extension:

- the exact immutable input snapshot;
- typed added, changed, and removed input identities for its selected partitions;
- the reason each partition was selected;
- bounded batch readers and graph traversal for declared inputs;
- verified source access only where declared;
- a typed emitter restricted to declared output kinds;
- effective limits, cancellation, and execution context; and
- no mutable state whose correctness survives only inside an extension process.

A materialized model or evaluation rule emits complete replacement output for selected partitions.
The platform validates stable identities, ordering, schemas, declared kinds, provenance,
completeness, and cardinality, then atomically combines replaced and retained partitions. Removed
inputs therefore cannot leave orphan derived facts. Query algorithms and projections never commit
through this path; they return their declared bounded result types.

Cold construction and every incremental sequence must produce byte-semantically equivalent model
outputs after normalizing non-semantic commit metadata. If an extension cannot implement a sound
delta, it declares repository scope and remains correct; it may not advertise false locality.

### Determinism and side effects

Admitted semantic output is a pure function of exact input snapshot identities, effective semantic
configuration, selected definition/provider versions, and explicitly admitted external inputs.
Ordinary extensions cannot derive hidden meaning from wall clocks, ambient environment variables,
unverified filesystem reads, undeclared network calls, process-global caches, or task scheduling.
The coordinator may parallelize, retry, or relocate work; normalized output and diagnostics remain
identical.

All semantic reads participate in dependency tracking. Any future effectful or external provider
must isolate effects behind a versioned port and turn returned material into identified input or
evidence before semantic admission. This boundary is what makes caching, durable reopen, replay,
and incremental equivalence trustworthy rather than merely fast.

### Query and graph performance contract

Extensions must not discover their inputs through repeated unbounded `facts()` scans or per-fact
asynchronous lookups. Public readers need:

- typed predicate and identity filtering with storage pushdown;
- batched lookup and indexed joins by subject, source, symbol, entity, and kind;
- bounded, streaming scans with explicit ordering and continuation;
- evidence-preserving graph neighbors, traversal, paths, and projection composition;
- projection of required fields where the backing model supports it;
- cancellation, backpressure, and explicit truncation; and
- query-plan or diagnostic evidence sufficient to find accidental full scans and N+1 behavior.

The public API specifies these observable capabilities, not a particular index or storage engine.
Memory and durable stores must implement equivalent semantics and representative complexity
behavior.

### Limits, failure, and isolation

Every extension receives enforceable effective limits for wall time, output cardinality, traversal,
alternatives, evaluation steps, and buffered data; memory and external-process limits are enforced
where the execution provider can measure them. A declared bound produces `partial`. Cancellation,
invalid output, undeclared access, schema failure, or unexpected defects produce attributable
extension failure.

Optional capability failure publishes explicit unavailability for that capability. Mandatory base
or capability failure aborts the candidate generation. No failure becomes an empty fact set, false
pass, or stale success. The previous committed generation remains separately identifiable.

Portable extension code is trusted host code in V1, but receives least-authority platform services.
Native compiler providers and future external execution providers have separate trust and
distribution identities. Repository configuration contains admitted data only and cannot load code
or escalate an extension's trust tier.

### Extension execution evidence

Every execution records structured, non-semantic operational evidence:

- selected, retained, replaced, and failed partitions;
- invalidation reasons;
- input and output counts by kind;
- bounded-query and traversal summaries;
- execution and admission time;
- effective limits and truncation;
- peak or bounded memory when measurable; and
- producer, extension, configuration, plan, and snapshot identities.

This evidence answers why an extension ran, why it was slow, and why a capability is unavailable.
It never becomes a quality score or changes semantic output.

### First-party parity

Except for compiler adaptation, admission, materialization, execution providers, and storage,
TypeSpec first-party document models, graph algorithms, rules, and projections use the same public
extension contracts as third parties. First-party code receives no private reader, emitter,
registration, invalidation, or performance hook. This parity is proven by production-import scans
and shared contract suites, not documentation alone.

## Pass 0: deliberately broad candidate surface

This pass inventories every plausible public facility before consolidation. It is intentionally too
wide.

### Workspace and lifecycle candidates

- Project discovery and explicit project descriptors.
- Repository and multi-repository workspaces.
- Automatic and explicit refresh.
- Immutable current snapshots and exact historical snapshots.
- Cross-universe snapshot sets.
- Cold, incremental, and proposed-overlay snapshots.
- Capability negotiation and effective configuration.
- Cancellation, disposal, freshness, status, and recovery.
- Memory and durable storage selection without storage-specific consumers.
- Watch subscriptions and semantic change notifications.
- Snapshot export/import for remote or cross-process consumers.

### Model candidates

- Branded repository, universe, project, package, module, file, document, section, symbol,
  occurrence, function, block, fact, rule, scenario, change, and evidence identities.
- Repository classification and ownership.
- Package exports, entrypoints, delivery, dependencies, and project references.
- Module boundaries, facades, internals, aliases, and dependency occurrences.
- Document syntax, headings, anchors, links, code, mentions, and resolved semantic references.
- Canonical TypeScript symbols, declarations, aliases, barrels, overloads, implementations, types,
  references, occurrences, calls, bodies, CFG, def-use, summaries, and bounded values.
- Specification and qualification models where TypeSpec itself is a consumer.
- Evidence, provenance, completeness, freshness, confidence, heuristic status, and derivation.
- External evidence snapshots for tests, traces, benchmarks, incidents, and qualification records,
  with producer, environment, workload, revision, trust, time, and subject correlation.
- Semantic snapshot differences and cross-revision entity correspondence.

### Query and graph candidates

- Typed entity and fact readers.
- Structured selectors and predicates.
- Text, symbol, reference, and semantic search.
- First-class typed multigraph views.
- Neighbor, edge, path, slice, reachability, and closure queries.
- Strongly connected components, condensation, topological layers, dominators, centrality,
  communities, cuts, motifs, and graph diffs.
- Generic joins across code, documents, specifications, tests, evidence, packages, and ownership.
- Explanations containing the exact derivation path.
- Pagination, streaming, bounded materialization, and deterministic ordering.

### Evaluation candidates

- Typed rule definitions and rule packs.
- Static selectors plus per-match and aggregate checks.
- Pass, fail, indeterminate, error, skipped, and suppressed outcomes.
- Related locations, causal paths, help, severity, categories, evidence, and completeness.
- Rule configuration schemas and effective configuration.
- Suppression policy and waiver evidence.
- Fix or stabilization-provider attachment.
- Coverage and rule-to-model dependency declaration.

### Prediction candidates

- Typed scenarios and overlays.
- Change-set, entrypoint, runtime-assumption, and counterfactual inputs.
- Generic impact-family composition.
- Before/after model, evaluation, reachability, and completeness comparison.
- Explainable consequence paths and non-impact proofs.
- Confidence and conservative over-approximation without an opaque score.

### Stabilization candidates

- Typed desired invariants.
- Candidate changes, edit preconditions, dependencies, alternatives, conflicts, and risks.
- Verified source revisions and source-safe text edits.
- File move, rename, create, delete, and structured semantic edit descriptions.
- Plan preview, validation, application adapter, rollback description, and post-change checks.
- Explicit separation between a diagnostic, a suggestion, a plan, and applied mutation.

### Extension candidates

- Typed fact kinds with schemas and codecs.
- Entity and edge kinds.
- Repository classifiers and document-language adapters.
- Portable model passes and compiler-near native passes.
- Selectors, graph projections, algorithms, evaluators, rules, scenarios, predictors,
  stabilizers, renderers, and transports.
- Capability manifests, dependency DAGs, invalidation, limits, provenance, and completeness.
- Extension bundles, explicit host registration, compatibility negotiation, and isolation policy.
- Extension fixtures and contract test kits.
- Evidence adapters and correlators that cannot mutate or impersonate source-derived semantic facts.

This is broader than the final API. The next passes decide which concepts are true semantic owners
and which are merely conveniences or implementation mechanics.

## Dance 1: consumer pressure on the platform

| Pressure | Downstream need | Required generic platform response |
|---|---|---|
| `D-01` | Open one repository and ask a business question without assembling stores, sessions, binaries, universes, and pass plans | A high-level `AnalysisWorkspace` factory with explicit configuration and effective resolved configuration |
| `D-02` | Use a custom fact without string namespaces or `Fact<unknown>` casts | `FactKind<T>` plus schema admission, typed readers, typed emitters, and typed capability handles |
| `D-03` | Traverse module, call, document, evidence, and custom graphs uniformly | Evidence-preserving typed `GraphView<N, E>` and composable projections |
| `D-04` | Match the actual imported SDK builder through aliases and barrels | Canonical symbol selectors and resolved call/argument/body readers |
| `D-05` | Understand argument forwarding and callback behavior | Public body, CFG, def-use, call-binding, summary, and bounded-value services |
| `D-06` | Index Markdown and auto-resolve references | Generic document model, parser-adapter extension, semantic reference resolver, and verified source access |
| `D-07` | Add an SDK-specific semantic model without changing TypeSpec | Portable typed model extensions with their own entity/fact/edge kinds and dependency manifests |
| `D-08` | Add a compiler-sensitive fact missing from the portable model | Explicit trusted native capability extension producing versioned portable facts |
| `D-09` | Implement rules that explain failure and uncertainty | Rule SDK with typed selectors, evidence paths, completeness-aware outcomes, diagnostics, and test fixtures |
| `D-10` | Compute impact across code, tests, docs, packages, rules, and owners | Scenario overlays, graph composition, semantic diff, consequence paths, and impact-family extension points |
| `D-11` | Suggest coherent migrations or repairs | Desired-invariant and stabilization-plan model with revision-safe changes and postcondition evaluation |
| `D-12` | Compare commits, branches, releases, and proposed edits | Exact snapshots, entity correspondence, semantic diff, and overlay snapshots |
| `D-13` | Reuse the same semantics in CLI, CI, MCP, IDE, viewer, and agents | Transport-neutral typed results plus versioned projection/serialization extensions |
| `D-14` | Prove why a result exists | Every derived result can reference facts, spans, rules, limits, inputs, and a derivation or path |
| `D-15` | Avoid false confidence | Complete, partial, unavailable, stale, ambiguous, unsupported, heuristic, and indeterminate remain structural states |
| `D-16` | Query all relevant project and test universes coherently | Repository snapshots compose exact universe generations and preserve universe identity on every fact |
| `D-17` | Apply organization policy without repository code execution | Explicit host-installed portable extensions and data-only repository configuration |
| `D-18` | Build graph algorithms not anticipated by TypeSpec | Public immutable graph primitives and an algorithm result contract; no obligation to persist every result |
| `D-19` | Build analysis once and expose several business views | One semantic operation can feed multiple consumer projections without reinterpreting authority |
| `D-20` | Qualify a downstream package against real public APIs | Published-package extension test kit and no-internal-import negative proof |
| `D-33` | Relate tests, traces, benchmarks, incidents, and qualification records to code and rules | Typed external-evidence snapshots, admission, correlation, trust, environment, and temporal identity |
| `D-35` | Extend every semantic layer that TypeSpec itself extends | Every first-party semantic role uses its applicable public extension contract; future predictor or stabilizer roles must establish the same parity before adoption |

## Dance 2: platform pressure back on the consumer

The generic platform deliberately constrains the downstream product:

| Pressure | Platform truth | Required consumer response |
|---|---|---|
| `D-21` | Facts describe evidence; they do not contain Astrale policy | SDK and CLI rule packages own every business conclusion |
| `D-22` | `MODEL` and `EVALUATE` are static semantic operations | CLI filters or refreshes their results; it does not redefine them as request-specific commands |
| `D-23` | `EXPLORE`, `PREDICT`, and `STABILIZE` require explicit intent | Consumer methods and commands require typed selections, scenarios, or target invariants |
| `D-24` | Graph algorithms return observations unless a rule interprets them | Consumer cannot label centrality, cycles, coupling, or reachability as defects without an explicit rule |
| `D-25` | Missing or bounded evidence is not a negative match | Consumer preserves indeterminate and unavailable results in CLI, CI, agents, and reports |
| `D-26` | Prediction is scenario-relative | `impact` must show scenario, scope, path families, limits, and blind spots rather than one magic list or score |
| `D-27` | Stabilization is not automatic mutation | Consumer separates findings, suggestions, plans, preview, approval, application, and post-check |
| `D-28` | A snapshot is immutable and exact | Consumer never mixes facts, rules, source text, or display from different generations silently |
| `D-29` | Control-plane lifecycle is not semantic health | Consumer status/doctor surfaces remain separate from code health and rule findings |
| `D-30` | Extension execution is a trust decision | Consumer installs and registers code explicitly; repository configuration may select only allowed data presets |
| `D-31` | Generic identities are not UI labels | Consumer owns human disambiguation, aliases, relevance, language, and navigation while retaining canonical IDs |
| `D-32` | Public model evolution is versioned | Consumer declares accepted capability/schema ranges and fails causally on incompatible semantics |
| `D-34` | Source models and observed execution evidence have different authority | Consumer may use observations as evidence but cannot infer static unreachability or correctness from missing traces |

## Dance 3: candidate API families

This pass turns the pressure into possible public concepts. Names remain candidate; responsibility
is the important part. Sections 1–9 and 12–13 pressure the V1 kernel directly. Scenario and
stabilization sections describe deliberate future integration seams; V1 examples may implement
bounded impact or plan-shaped results as query algorithms without prematurely stabilizing those
full families.

### 1. Workspace facade

```ts
const workspace = await openAnalysisWorkspace({
  root,
  projects: discoverTypeScriptProjects(),
  extensions: [documents(), consumerExtension],
  capabilities: requested,
  persistence: { kind: 'durable', fallback: 'memory' },
  signal,
})

const refresh = await workspace.refresh({ changes, signal })
const snapshot = refresh.snapshot
```

The ordinary consumer supplies a root, projects or discovery policy, trusted extensions, requested
capabilities, and optional platform services. It does not construct a store, native process, pass
plan, transaction, producer identity, or generation.

The facade returns effective configuration, exact snapshot identity, changes, invalidations,
diagnostics, freshness, and available/unavailable capabilities. Low-level lifecycle contracts may
remain on an advanced subpath for platform implementers.

### 2. Immutable semantic snapshot

```ts
interface SemanticSnapshot {
  readonly identity: SnapshotIdentity
  readonly freshness: Freshness
  capabilities(): CapabilitySet
  entities: EntityReader
  facts: TypedFactReader
  graph: GraphProjector
  source: VerifiedSourceService
  typescript?: TypeScriptSemanticModel
  documents?: DocumentSemanticModel
  diff(other: SemanticSnapshot): Promise<SemanticDiff>
  dispose(): Promise<void>
}
```

One snapshot may compose several universes but never erases their identities. Every read is pinned
to the same snapshot set. An extension obtains only immutable readers for its declared inputs.

### 3. Typed fact and capability definitions

```ts
const sdkCall = defineFactKind<SdkCall>({
  id: 'acme.sdk.call',
  version: 1,
  schema: sdkCallSchema,
  subject: semanticEntity,
})

const sdkModel = defineCapability({
  id: 'acme.sdk.model',
  version: 1,
  classification: {
    operator: 'MODEL',
    world: 'STATIC',
    dimensions: ['SEMANTIC', 'DYNAMIC', 'SPATIAL'],
    lenses: [],
  },
  requires: [typescript.calls.v1, typescript.bodies.v1],
  provides: [sdkCall],
})
```

Typed definitions carry runtime admission, schema version, identity, completeness behavior, and
serialization. Ordinary consumer code reads `snapshot.facts.of(sdkCall)` rather than a namespace
string and receives `Fact<SdkCall>` without a cast.

Every atomic intelligence capability and operation result structurally carries exactly one locked
operator, its semantic world, at least two dimensions, and its applicable lenses. This metadata is
typed public vocabulary rather than free-form tags. It enables capability negotiation and
downstream filtering without letting a renderer reinterpret semantic ownership.

### 4. Entities, references, and verified source

The platform should expose generic entities with stable kind-specific identities, display hints,
exact source spans, cross-universe participation, and typed references. Source access is digest and
revision checked. Consumers can request excerpts, lines, syntax roles, or edit preconditions without
reading arbitrary paths behind the snapshot.

Built-in entity families should cover repository, project, package, module, source, document,
section, TypeScript symbol, occurrence, function, and evidence. Extension-defined entity kinds are
allowed when their identity and admission schemas are explicit.

### 5. Typed multigraph

```ts
const modules = snapshot.graph.project(moduleDependencyProjection)
const runtime = modules.whereEdges(edge => edge.kind.is(runtimeDependency))

for await (const path of runtime.paths({ from, to, maximumDepth: 8 })) {
  // Every node and edge retains evidence and completeness.
}

const components = algorithms.stronglyConnectedComponents(runtime)
```

The graph is a typed evidence-preserving multigraph. It must not collapse two call or dependency
occurrences merely because they share endpoints. A projection may explicitly deduplicate to a
relationship view while retaining links to all occurrences.

The minimum generic algorithm kernel is likely:

- neighbors and incident edges;
- bounded traversal and reachability;
- explanatory paths;
- slices and closure;
- strongly connected components and condensation;
- topological layers;
- graph and projection diff; and
- composition/join across compatible entity identities.

Dominator, cut, centrality, community, motif, and domain-specific algorithms should begin as public
algorithm extensions rather than bloating the kernel. The extension mechanism, however, must make
them first-class and ergonomic.

### 6. Language and document semantic models

`TypeScriptSemanticModel` should provide typed indexes and selectors for canonical symbols,
declarations, types, occurrences, calls, bodies, CFG, def-use, summaries, and bounded values. A
consumer must not manually scan all facts to answer ordinary semantic questions.

`DocumentSemanticModel` should expose documents, blocks, headings, anchors, links, mentions, code,
and reference-resolution states. Parsers are adapters; the fact ontology is document-generic.
Markdown is the first adapter rather than the permanent owner of documents.

Neither model accepts downstream business names. Consumers build SDK or documentation semantics
through selectors and portable model extensions.

### 7. Evidence and observation inputs

Externally produced evidence is admitted through versioned types rather than inserted as ordinary
compiler facts. An `EvidenceSnapshot` identifies its producer, time, environment, workload or test
selection, source/semantic revision when known, trust status, and subject correlations. Test
results, execution traces, benchmarks, incidents, coverage, and qualification records can therefore
join the semantic graph without becoming source authority.

Semantic snapshots and evidence snapshots remain independently identified. A consumer operation
composes an exact input set and records it in its result. Correlation may be exact, conservative, or
heuristic and exposes that derivation. Missing observations never prove that a statically reachable
path did not execute or cannot execute.

### 8. Selector and explanation layer

```ts
const builder = ts.symbols.canonicalExport({ package: sdkPackage, name: 'defineMutation' })
const calls = ts.calls.to(builder).within(scope)
const explanation = await snapshot.explain(call, { through: [aliases, barrels, bindings] })
```

Selectors are typed, composable, bounded, and introspectable. A selector can become a rule input,
graph seed, scenario seed, or explanation subject without losing identity. Explanation is a generic
derivation/path result, not preformatted prose.

### 9. Evaluation SDK

```ts
const rule = defineRule({
  id: 'acme.sdk.mutation-options',
  requires: [sdkModel],
  select: sdk.calls.mutations(),
  evaluate(match, context) { /* business semantics */ },
})
```

The generic rule result is a closed discriminated state: `pass`, `fail`, `indeterminate`, `error`,
or explicitly `suppressed` by downstream policy. Diagnostics carry code, subject, evidence,
related evidence, causal explanation, inputs, completeness, help identity, and optional stabilization
providers. Severity and business wording belong to the rule package.

Rules cannot mutate model snapshots. Static rule suites may be continuously evaluated and
materialized as separate evaluation snapshots pinned to their semantic inputs.

### 10. Reserved future scenario and prediction SDK

```ts
const scenario = defineScenario({
  base: snapshot,
  changes: proposedContractChange,
  assumptions,
  scope,
})

const prediction = await predict(scenario, {
  families: [compileImpact, callImpact, testImpact, documentationImpact],
})
```

A scenario has an exact base, typed inputs, explicit assumptions, scope, limits, and optional
overlay. A predictor returns consequence claims with paths, confidence category, completeness, and
non-impact evidence where available. Predictors compose by identity rather than flattening all
consequences into a single score.

### 11. Reserved future stabilization SDK

```ts
const plan = await stabilize({
  snapshot,
  target: desiredInvariant,
  providers,
  constraints,
})

const preview = await plan.preview()
const verification = await plan.verify({ mode: 'overlay' })
```

The platform owns a generic immutable plan: alternatives, ordered changes, preconditions, conflicts,
expected outcomes, residual findings, verification, and application adapter boundary. The consumer
owns what target is desirable and which providers are trusted. Applying changes is always explicit
and outside static evaluation.

### 12. Extension bundle

```ts
const sdkCall = defineFactKind<SdkCall>({ /* identity, schema, subject */ })

const sdkModel = defineModelExtension({
  manifest: {
    id: 'acme.sdk.model',
    requires: [typescript.calls.v1, typescript.bodies.v1],
    writes: [sdkCall],
    scope: 'function',
    incremental: { partitionBy: 'function' },
    limits: sdkModelLimits,
  },
  derive(context) { /* typed delta, readers, emitter */ },
})

const sdkRules = defineRulePack({ /* immutable static evaluation */ })
const sdkImpact = defineQueryAlgorithm({ /* explicit scenario -> typed result */ })

const extension = defineExtensionBundle({
  id: 'acme.sdk-intelligence',
  version: '1.0.0',
  kinds: [sdkCall],
  models: [sdkModel],
  rules: [sdkRules],
  algorithms: [sdkImpact],
})
```

The bundle is declarative grouping and compatibility metadata. Each role retains its own public
contract, classification, typed dependencies, invalidation, limits, and tests. Repository data may
configure an allowlisted bundle but cannot name a filesystem module to load. Native extensions have
a separate trusted distribution and compatibility boundary; a portable extension cannot silently
escalate itself to compiler access.

Except for the compiler adapter, transaction validator, materializer, and transport implementation,
first-party TypeSpec extensions receive no privileged semantic hook. If a first-party document
adapter, graph algorithm, rule, or projection cannot be implemented through the published V1
extension API, that API is incomplete. The same gate applies before TypeSpec adopts a future
predictor, stabilizer, evidence, or external-engine role.

### 13. Extension test kit

The public V1 test kit should construct small admitted snapshots and offer fixtures for canonical
symbols, aliases, barrels, same-named collisions, calls, callbacks, forwarding, CFG, value states,
documents, reference ambiguity, completeness, multiple universes, semantic diffs, bounded impact
inputs, and verified source revisions. It should also run cold/incremental equivalence,
serialization compatibility, failure isolation, and query-efficiency checks for an extension
without requiring TypeSpec internal test helpers. Future families add their own scenario,
stabilization, evidence, or engine conformance suites rather than weakening this base kit.

Each published extension or proof package supplies a machine-readable qualification manifest. It
names stable case IDs, extension roles and capabilities under test, fixtures and change sequences,
semantic assertions, required store/provider combinations, limits or measured budgets, and the
evidence artifact produced. Case kinds include semantic, incremental, compatibility, scale,
failure/isolation, package-boundary, and first-/third-party parity. Test results record exact host,
extension, definition, provider, fixture, configuration, and snapshot identities.

Every `proof` ID assigned by the capability roadmap must resolve to one of these cases. One case may
qualify several capabilities, but a passing unit test without the declared matrix and evidence
cannot advance a roadmap disposition. Numeric budgets are versioned only after reproducible
baselines; semantic equivalence and bounded behavior remain hard gates from the beginning.

## Dance 4: cuts and consolidation

The broad pass creates too many potential root concepts. These are removed or demoted:

1. **No universal query DSL as the primary API.** Typed readers, selectors, and graph projections
   own common use. A lower-level predicate/stream escape hatch remains for advanced algorithms.
2. **No separate persisted graph product.** Graphs are projections over immutable typed models.
   Consumers may materialize derived facts, but correctness does not require a graph database.
3. **No built-in catalog of every graph algorithm.** The kernel supplies traversal, paths, SCC,
   condensation, layers, composition, and diff; richer algorithms qualify the extension API.
4. **No generic `health`, `quality`, `risk`, or `impactScore`.** Those are downstream products or
   individually attributable rule/predictor aggregates.
5. **No platform-owned business command framework.** Projection contracts are generic; command
   naming and workflows belong to the consumer.
6. **No repository-loaded plugins.** Explicit host registration remains the only executable
   extension authority.
7. **No rule mutation or implicit fix.** Evaluation, suggestion, plan, application, and
   post-evaluation remain distinct.
8. **No raw AST escape hatch.** Missing compiler facts use the native capability extension seam.
9. **No requirement that every exploration be precomputed.** Static models are authoritative;
   exploration may query them at request time.
10. **No requirement that every prediction be persisted.** Scenario-relative results remain
    ephemeral unless a consumer explicitly records them as evidence.
11. **No UI-centric document representation.** HTML and rendered Markdown are projections from a
    document-semantic model.
12. **No ordinary consumer dependency on stores, shards, transactions, native sessions, producer
    IDs, or pass plans.** These remain advanced platform implementation contracts.

## Converged public layers

The candidate architecture is deliberately smaller than Pass 0. Its V1 kernel and future families
are distinguished so foundational APIs are not delayed by speculative breadth.

### V1 public kernel

| Layer | Ordinary public responsibility |
|---|---|
| `workspace` | Open, discover, configure, refresh, subscribe, snapshot, dispose, and report exact freshness/capabilities |
| `model` | Typed identities, entity/fact/edge kinds, provenance, completeness, evidence, source, typed readers, and emitters |
| `graph` | Typed multigraph projections, traversal, paths, SCC, condensation, layers, composition, and diff |
| `typescript` | Canonical symbols, occurrences, calls, bodies, flow, def-use, summaries, types, and values |
| `documents` | Document structure, anchors, links, mentions, code, and semantic-reference resolution |
| `query` | Typed readers, selectors, search, joins, slices, explanations, pagination, and streaming |
| `evaluation` | Rules, suites, diagnostics, coverage, configuration, suppression inputs, and evaluation snapshots |
| `extension` | Definitions, model/rule/algorithm/projection roles, manifests, registry, planning, deltas, limits, trust, and compatibility |
| `testing` | Admitted fixtures, extension contracts, cold/incremental equivalence, performance checks, and package-boundary proof |
| `advanced` | Stores, shards, transactions, pass orchestration, protocol, and materialization for platform implementers |

The first Markdown adapter qualifies `documents` through the public model-extension boundary; the
document ontology is not coupled to HTML or TypeSpec presentation. A bounded impact example
qualifies query algorithms over graph composition without requiring the complete future scenario
framework.

### Reserved future families

| Family | Architectural seam stabilized in V1 | Deferred specialized contract |
|---|---|---|
| External evidence | Typed kinds, provenance, temporal identity, trust, and model ingestion | General evidence-provider lifecycle and exact runtime correlation protocols |
| External engines | Execution-provider separation, framed native protocol principles, typed admission | Language-neutral producer protocol, sandboxing, remote execution, and provider distribution |
| Scenario and prediction | Query-algorithm inputs, immutable snapshots, semantic diff, graph paths, classification | General overlays, assumptions, impact-family composition, and non-impact proofs |
| Stabilization | Verified source revisions, typed diagnostics, plan-shaped results, explicit mutation boundary | Desired-invariant registry, alternative plans, overlays, conflict resolution, and application adapters |
| Multi-repository analysis | Portable repository identity and snapshot-set composition | Discovery, authorization, federation, cross-repository correspondence, and retention |
| Rich graph analytics | Immutable typed graph and public algorithm role, already qualified by one downstream centrality model | Optimized built-in or provider contracts for dominators, cuts, motifs, centrality, communities, and domain-specific kernels |

These may remain submodules of one package initially. Extraction readiness is proven by import laws,
published subpaths, and consumer fixtures rather than package count. Adding one of the reserved
families must extend the kernel through a versioned semantic owner; it may not expose storage,
compiler, or orchestration internals as a shortcut.

## Required cross-cutting result algebra

Every layer reuses a small set of structural truths:

- exact snapshot and universe identity;
- exactly one operator plus the locked semantic world, dimensions, and applicable lenses;
- stable entity identity with explicit stability scope;
- evidence spans against exact source revisions;
- provenance and derivation inputs;
- complete, partial, unavailable, and stale capability state;
- known, unknown, ambiguous, and unsupported semantic result where applicable;
- exact versus conservative versus heuristic derivation kind;
- deterministic ordering and bounded cardinality;
- cancellation and asynchronous disposal for live services; and
- versioned serialization only where values cross a process or persistence boundary.

The API must not approximate this algebra through optional bags or prose diagnostics.

## V1 extension qualification gate

V1 qualifies the kernel deeply through a small adversarial proof matrix rather than shallowly
implementing every catalog idea:

| Proof extension | Kernel surfaces under pressure | Required adversarial cases |
|---|---|---|
| SDK semantic model | Typed kinds, model role, TypeScript selectors, body/value readers, per-function deltas | aliases, barrels, spelling collision, callbacks, helper forwarding, known/unknown/ambiguous/unsupported |
| Architecture rule pack | Graph projection, evaluation, diagnostics, completeness | multi-edge dependencies, permitted and forbidden cycles, unavailable module facts, suppression policy |
| Markdown reference model | Document adapter, model role, verified source, graph join | duplicate headings, ambiguous mentions, broken/stale references, incremental rename and deletion |
| Impact algorithm | Query-algorithm role, typed input/result, graph composition, bounded traversal | module/symbol change, path explanation, truncation, dynamic escape, no opaque score |
| Custom graph algorithm | Public graph kernel and first-/third-party parity | weighted centrality/coupling model absent from TypeSpec, large sparse and cyclic fixtures, cancellation and deterministic output without implicit judgment |
| Compiler-near capability | Trusted provider boundary and portable admission | new exact compiler fact, compatibility mismatch, invalid output, no Checker leakage or local-Go requirement |
| Hostile extension | Limits, isolation, failure, planning, and observability | timeout, cancellation, excessive output, undeclared kind, producer collision, cycle, stale schema, accidental full scan |

All materialized proof extensions must pass cold/incremental equivalence across edit, create, delete,
rename, configuration change, extension configuration change, and extension version change. Memory
and durable stores must return identical semantic results. Representative scale fixtures must prove
partition retention, bounded query behavior, absence of N+1 access, attributable execution
evidence, and enforcement of effective limits.

The first-party Markdown model and third-party SDK model run through the same registry, planner,
reader, emitter, invalidation, admission, and qualification contracts. Published-package tests and
negative scans reject internal imports, raw payload casts, private namespace literals, compiler or
storage handles, native wire types, and TypeSpec product imports.

If a proof requires a TypeSpec fork, direct source parsing outside an owned adapter, an internal
hook, a privileged first-party reader, or flattening an epistemic state, the V1 public extension
kernel remains unqualified.

## Capability integration roadmap

The 61-item catalog is a pressure inventory, not a V1 checklist. Every capability receives one
machine-trackable disposition:

| State | Meaning |
|---|---|
| `catalogued` | Valuable idea classified by the locked taxonomy; no delivery commitment yet |
| `kernel-supported` | Existing public primitives are sufficient in architecture, but no representative downstream proof exists |
| `v1-proof` | Selected to qualify a load-bearing V1 extension role or foundation |
| `product-integrated` | Implemented and qualified in a real downstream product journey |
| `deferred` | Intentionally scheduled behind a named future family or prerequisite |
| `blocked` | A specific missing public primitive or unresolved semantic decision prevents honest implementation |

The machine-readable `roadmap` in
[`intelligence-capabilities.yml`](./intelligence-capabilities.yml) is the maintained integration
ledger. It records capability ID, disposition, owning extension role, required public primitives,
proof fixture, and rationale; implementation evidence adds the exact primitive versions,
performance/correctness qualification, known limits, and any blocking decision. A capability may
become `kernel-supported` only after a design trace shows how it composes existing roles. It becomes
`product-integrated` only through a real consumer using public package exports.

Future integration follows this governed sequence:

1. classify the consumer intent and decide whether it is generic mechanism or downstream meaning;
2. attempt composition from current typed models, graph/query, rules, and execution roles;
3. if exact source semantics are missing, add a narrow versioned compiler-near or adapter
   capability rather than a private query escape;
4. if no existing role can own the lifecycle honestly, propose one new semantic extension role
   with compatibility, trust, incremental, and failure semantics;
5. add schema evolution, cold/incremental differential, scale, failure, and published-consumer
   evidence; and
6. advance the ledger state without silently broadening V1 completion claims.

New roles require the same governance as a public architecture change. New facts, rules,
algorithms, and projections normally do not.

## Current V2 delta

The current V2 implementation is strong substrate evidence, not yet this converged surface.

Already present:

- immutable facts, generations, stores, snapshot sets, queries, passes, policies, provenance, and
  completeness;
- compiler-resolved TypeScript modules, symbols, occurrences, calls, bodies, CFG, def-use,
  summaries, and bounded values;
- memory/SQLite materialization, native protocol, verified source text, and repository inventory;
- capability-aware pass planning and explicit native versus portable execution.

Still required to qualify the V1 kernel:

- ordinary workspace facade and coherent multi-universe discovery;
- typed fact kinds, typed readers/emitters, and capability handles;
- generic entity/reference and graph APIs;
- document-semantic modeling and adapter extensions;
- high-level TypeScript selectors/readers over raw fact payloads;
- explanation/derivation paths;
- richer evaluation diagnostics, configurations, and suppressions;
- the load-bearing extension registry, typed manifests, planner, deltas, bounded readers, emitters,
  execution evidence, testing, and native-capability packaging as public consumer seams;
- the V1 proof matrix; and
- the machine-maintained capability integration ledger in
  [`intelligence-capabilities.yml`](./intelligence-capabilities.yml).

Tracked after V1, without being smuggled into V1 completion:

- external evidence admission, exact identity, trust, environment, and semantic correlation;
- external-engine providers and portable result admission;
- generalized scenarios, overlays, prediction families, stabilization plans, and application
  adapters;
- multi-repository federation and historical lineage; and
- richer graph algorithms whose measured needs exceed the public V1 algorithm role.

V1 must preserve the semantic definition, compatibility, trust, execution-provider, snapshot, and
result-algebra seams these families will extend. It need not publish their specialized APIs before
representative downstream pressure can qualify them.

## Open decisions to pressure with the companion design

1. Whether the V1 query-algorithm role uses one generic operation envelope plus typed results or
   separate typed operation definitions.
2. Whether evaluation snapshots are platform materializations or consumer-owned projections over a
   semantic snapshot.
3. Which graph algorithms belong in the kernel after real consumer implementations measure the
   extension ergonomics.
4. The exact V1 partition vocabulary and whether a safe custom-partition provider belongs in V1 or
   the next compatibility version.
5. Whether document references use one generic semantic entity identity or typed target unions.
6. How native extension distribution and compatibility work without making local Go a consumer
   requirement.
7. Which execution metrics and memory bounds can be enforced portably versus merely observed.
8. Which models deserve dedicated public subpaths versus namespaces inside a smaller extraction
   package.

These remain open because the companion consumer must exercise them. They are not reasons to expose
the current low-level machinery as the permanent ordinary API.
