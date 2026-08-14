# Candidate: downstream semantic-intelligence SDK and CLI

Status: broad-to-refined co-design input; not a ratified SDK, CLI, or TypeSpec contract.

Companion: [`typespec-platform-public-api.md`](./typespec-platform-public-api.md).

Taxonomy: [`intelligence-taxonomy.schema.json`](./intelligence-taxonomy.schema.json).

Capability pressure: [`intelligence-capabilities.yml`](./intelligence-capabilities.yml).

## Goal

Build a downstream product that uses only the public TypeSpec semantic platform while owning all
Astrale-specific meaning. Its programmatic SDK lets applications, CI, editors, agents, and custom
tools compose business intelligence. Its CLI exposes genuine engineering intents—not fact-store,
compiler, index, database, graph-schema, namespace, shard, or pass-orchestration mechanics.

The product should feel more useful than a code graph because it connects code, behavior,
architecture, tests, evidence, documents, specifications, packages, security, experience,
performance, observability, history, and proposed change. It should remain more trustworthy than a
magic answer because every conclusion exposes its evidence, path, completeness, assumptions, and
authority.

The complete SDK and CLI below are the product direction, not the first delivery checklist. V1 of
the downstream work is a published proof package and small demonstration CLI whose primary purpose
is to qualify the TypeSpec extension kernel under real business semantics, incremental changes,
scale, failure, and package boundaries. Product capabilities expand through the governed catalog
roadmap after that foundation passes.

## Ownership boundary

### This downstream product owns

- canonical Astrale SDK package and symbol identities;
- SDK builder, options, callback, forwarding, lifecycle, and migration semantics;
- Astrale architecture, module-boundary, security, experience, performance, observability,
  evidence, release, and documentation rules;
- organization or repository rule presets, configured scopes, suppressions, and accepted waivers;
- product vocabulary, command names, intent admission, defaults, ranking, help, output, exit
  behavior, and interactivity;
- curated impact families and stabilization providers;
- the relationship between findings and recommended business action;
- CI, editor, agent, MCP, and CLI projections; and
- installation of trusted TypeSpec analysis extensions.

### This downstream product does not own

- TypeScript compiler/session lifecycle, AST/Checker access, source identity, fact storage, or
  incremental invalidation;
- generic source, symbol, occurrence, body, CFG, def-use, type, value, document, graph, provenance,
  completeness, snapshot, scenario, or verified-edit contracts;
- a duplicate parser, resolver, graph store, project service, Markdown ontology, or impact engine;
- generic graph algorithms that are reusable without Astrale semantics;
- mutable catalog objects that mix static facts, rules, and presentation; or
- hidden normalization of partial, unavailable, ambiguous, unsupported, stale, or heuristic results.

## Semantic worlds

The product preserves the locked taxonomy even when one CLI invocation refreshes data before
answering:

| World | Product behavior |
|---|---|
| `STATIC` | `MODEL` and `EVALUATE` continuously derive repository truth and governed findings from each exact snapshot. They do not require a user question. |
| `RUNTIME` | `EXPLORE`, `PREDICT`, and `STABILIZE` require a selected subject, scenario, proposed change, or desired invariant. |
| Control plane | Discovery, refresh, persistence, locks, daemon lifecycle, compatibility, and recovery establish usable snapshots but do not define semantic health. |

A command may request freshness and then filter static results. That does not make the static rule a
runtime semantic operation. Similarly, a cached prediction remains scenario-relative and does not
become a static fact.

## Pass 0: deliberately broad consumer possibilities

This pass starts too wide so that platform gaps surface early.

### Understanding and navigation

- Repository, package, project, module, file, document, section, symbol, callable, rule, diagnostic,
  test, evidence, and release dossiers.
- Symbol, text, semantic, documentation, specification, and finding search.
- Callers, callees, implementations, references, imports, exports, dependencies, dependents, and
  public consumers.
- Explanatory paths across modules, calls, values, references, tests, evidence, and ownership.
- Forward and backward semantic slices.
- Semantic snapshot and branch comparisons.
- “Why?” explanations for dependencies, findings, values, references, impact, and omitted evidence.

### Always-on evaluation

- Architecture and module-boundary conformance.
- SDK usage and lifecycle rules.
- Public API consistency and evolution.
- Documentation references, drift, and coverage.
- Test/evidence coverage and analysis completeness.
- Security source/sink, trust-boundary, and authorization rules.
- Error handling, hidden fallback, diagnosability, and silent-failure rules.
- Resource lifecycle and cancellation rules.
- Performance static-cost and workload-budget rules.
- Package, delivery, release, and compatibility rules.
- Cross-cutting repository health as an attributable view over individual rules—never one score.

### Prediction

- Change impact across compile, dependencies, runtime reachability, values, tests, specifications,
  documentation, packages, releases, security, experience, performance, observability, and owners.
- Affected tests and minimum defensible test plans.
- Entrypoint reachability.
- Signature, builder, module, package, documentation, security, and release change impact.
- Counterfactual graph changes, cycle-breaking candidates, graph cuts, and moves.
- Patch review and residual-risk prediction.

### Stabilization

- Architecture boundary restoration.
- SDK migrations and codemod plans.
- Reference and documentation repair.
- Public API stabilization.
- Evidence-gap plans.
- Error/observability remediation plans.
- Security guard and sanitization candidates.
- Module split, move, merge, facade, and cycle-breaking plans.
- Complete implementation plans for explicit desired outcomes.

### Product surfaces

- Programmatic SDK.
- Human CLI.
- Stable JSON/NDJSON output.
- CI annotations and exit semantics.
- MCP tools for agents.
- IDE navigation, diagnostics, code actions, and impact previews.
- Viewer/graph explorer.
- Agent context bundles and patch review.

This inventory is product pressure, not a promise that every item deserves a top-level command.

## Dance 1: downstream requirements imposed on TypeSpec

The following shared pressure IDs correspond to the platform companion:

| Pressure | Consumer journey | Platform facility needed |
|---|---|---|
| `D-01` | `openProject(root)` and immediately ask for health, a module dossier, or impact | High-level workspace and snapshot facade |
| `D-02` | Read and publish `SdkCall`, `SdkBuilder`, and `AstraleModule` facts as real types | Typed fact/entity definitions, admission, readers, and emitters |
| `D-03` | Reuse one graph vocabulary for modules, calls, docs, tests, rules, and owners | Typed evidence-preserving graph projections and composition |
| `D-04` | Match real Astrale builders through alias and barrel indirection | Canonical symbol/export selectors |
| `D-05` | Inspect callbacks, forwarded arguments, return paths, and lifecycle | Typed body, flow, def-use, binding, summary, and value APIs |
| `D-06` | Resolve and repair Markdown references to semantic subjects | Generic document/reference facts and verified edits |
| `D-07` | Add Astrale semantics without upstream patches | Portable model extension API |
| `D-08` | Obtain a new exact compiler fact when portable models cannot prove it | Trusted versioned native capability extension |
| `D-09` | Author explainable business rules without plumbing fact pages | Rule SDK, typed selectors, diagnostics, completeness, and fixtures |
| `D-10` | Run one impact request across all intelligence domains | Scenarios, semantic diffs, graph composition, and predictor families |
| `D-11` | Turn a finding or goal into a reviewable plan | Desired invariants, preconditioned changes, overlays, and verification |
| `D-12` | Compare current, historical, proposed, and release snapshots | Snapshot correspondence, semantic diff, and overlay model |
| `D-13` | Project identical semantics to SDK, CLI, CI, MCP, IDE, and viewer | Typed transport-neutral results and versioned projections |
| `D-14` | Show “why” for every conclusion | Generic derivation and explanatory path model |
| `D-15` | Never lie when analysis cannot prove an answer | Closed epistemic/completeness states throughout the API |
| `D-16` | Include implementation, tests, tools, and project-reference universes coherently | Exact cross-universe snapshot sets and entity membership |
| `D-17` | Use data configuration safely in repositories | Host-installed code extensions plus data-only allowlisted configuration |
| `D-18` | Implement a specialized graph algorithm locally | Public immutable graph kernel and algorithm result contract |
| `D-19` | Reuse one semantic operation in several journeys | Operation results independent of presentation and command structure |
| `D-20` | Publish the consumer independently | Public package fixture, extension test kit, and negative boundary scans |
| `D-33` | Combine tests, traces, benchmarks, incidents, and qualification records with static semantics | Typed external-evidence snapshots and explicit correlation authority |
| `D-35` | Build rich downstream models, rules, algorithms, predictions, repairs, and projections without second-class hooks | First-party and third-party extension parity outside the compiler/materializer substrate |

If one of these requires a TypeSpec-internal import, string namespace, raw payload cast, direct
filesystem parse, SQLite access, native process call, or consumer-maintained compiler, the public
platform is still blocking the product.

## Dance 2: platform truths imposed on the consumer

| Pressure | Consumer design consequence |
|---|---|
| `D-21` | All Astrale conclusions live in downstream rule/model packages, never generic TypeSpec facts |
| `D-22` | Static models and evaluations run as snapshot intelligence; CLI commands only refresh and select their results |
| `D-23` | Every exploration, prediction, or stabilization admits an explicit selection, scenario, or target invariant |
| `D-24` | Metrics and algorithms are observations until a named Astrale rule interprets them |
| `D-25` | Human and machine output preserve indeterminate, unavailable, partial, stale, ambiguous, unsupported, and heuristic states |
| `D-26` | `impact` is a structured family of consequence paths, not an opaque score or unqualified blast radius |
| `D-27` | Findings, suggestions, plans, previews, approvals, applications, and post-checks are separate user journeys |
| `D-28` | Every result and source excerpt displays or carries the exact snapshot identity; mixed generations fail |
| `D-29` | Operational `status` and semantic `health` remain distinct commands and result schemas |
| `D-30` | Extensions are installed by the host product; repository configuration cannot load arbitrary code |
| `D-31` | UI labels and fuzzy selection resolve to canonical platform identities with ambiguity exposed |
| `D-32` | The product pins accepted capability/schema ranges and produces a causal compatibility failure |
| `D-34` | Observed execution evidence can support a claim but missing traces never prove static unreachability or correctness |

## Pass 1: broad programmatic SDK

This first SDK sketch is intentionally generous:

```ts
const intelligence = defineIntelligenceProduct({
  id: 'astrale.code-intelligence',
  extensions: [astraleSdkModel, astraleDocuments, astraleArchitecture],
  rulePacks: [sdkRules, architectureRules, securityRules, experienceRules],
  predictors: [impactPredictors, testPredictors, releasePredictors],
  stabilizers: [sdkMigrations, referenceRepair, architectureRepair],
  configuration: astraleConfigurationSchema,
})

await using project = await intelligence.open({ root, configuration, signal })
const current = await project.current({ freshness: 'required' })

const module = await current.explore.module(moduleSelector)
const health = await current.evaluate.health({ scope })
const impact = await current.predict.impact(changeScenario)
const plan = await current.stabilize.finding(findingId, constraints)
```

Candidate SDK families:

### `project`

- `open`, `current`, `refresh`, `status`, `subscribe`, and `dispose`.
- Resolves trusted extensions and business configuration once.
- Does not expose stores, native sessions, pass plans, generations as mutable state, or caches.

### `model`

- Astrale SDK builders, calls, resources, services, domains, module roles, public contracts, trust
  boundaries, evidence obligations, and documentation subjects.
- Typed selectors over canonical TypeSpec entities.
- Business model extensions remain versioned and attributable to this product.

### `evaluate`

- Named rule packs: architecture, SDK, API, documents, evidence, security, experience,
  observability, performance, delivery, and release.
- `health` is a view over selected rule outcomes and coverage; it adds no hidden score.
- Configuration selects severity, scope, required evidence, and accepted suppressions without
  rewriting rule semantics silently.

### `explore`

- `overview`, `find`, `entity`, `module`, `symbol`, `document`, `finding`, `references`, `paths`,
  `slice`, `callers`, `callees`, `dependencies`, `dependents`, `tests`, `evidence`, and `diff`.
- Every result can request or link to a structured explanation.
- Fuzzy selectors can return `resolved`, `ambiguous`, or `not-found`; they never select the first
  textual match silently.

### `predict`

- `impact`, `affectedTests`, `testPlan`, `entrypointReachability`, `patchReview`,
  `releaseImpact`, `securityImpact`, and `counterfactualArchitecture`.
- Business predictors compose generic platform consequence paths and add curated relevance,
  policy, language, and grouping.

### `stabilize`

- `finding`, `architecture`, `sdkMigration`, `references`, `documentation`, `publicApi`,
  `evidence`, and `implementationPlan`.
- Returns immutable alternative plans; no method applies a change unless an explicit mutation
  adapter and approval are supplied.

### `projections`

- Human/CLI, JSON, CI, MCP, editor, viewer, and agent projections.
- Projections consume SDK operation results; they do not query TypeSpec facts independently.

This breadth is useful for pressure, but it creates too many methods and risks mirroring every
catalog capability as a permanent SDK member. Later passes consolidate it.

## Pass 2: broad intent-driven CLI

The command prefix remains deliberately unratified; examples use `code-intel`. The important design
is the business intent after the prefix.

### Explore candidates

```text
code-intel overview [scope]
code-intel find <query> [--kind ...] [--scope ...]
code-intel show <entity>
code-intel explain <entity|finding|relation>
code-intel path <from> <to> [--through ...]
code-intel callers <callable>
code-intel callees <callable>
code-intel dependencies <module|package>
code-intel dependents <module|package>
code-intel references <entity>
code-intel tests <entity>
code-intel evidence <entity|rule>
code-intel compare <left> <right>
```

### Static evaluation views

```text
code-intel health [scope]
code-intel findings [scope] [--rule ...] [--lens ...] [--status ...]
code-intel check architecture [scope]
code-intel check sdk [scope]
code-intel check api [scope]
code-intel check docs [scope]
code-intel check evidence [scope]
code-intel check security [scope]
code-intel check experience [scope]
code-intel check observability [scope]
code-intel check performance [scope]
```

These commands do not own the evaluation. They require a current static evaluation snapshot and
project a selected business view from it.

### Prediction candidates

```text
code-intel impact <entity|change|ref> [--family ...] [--scope ...]
code-intel affected-tests <files-or-change...>
code-intel test-plan <change> [--confidence ...] [--budget ...]
code-intel reachability <entrypoint> [--runtime ...]
code-intel review <patch|commit|branch>
code-intel release-impact <ref>
code-intel security-impact <change>
code-intel architecture-impact <change>
```

### Stabilization candidates

```text
code-intel stabilize <finding|goal> [--constraints ...]
code-intel migrate sdk <target-version> [scope]
code-intel repair references [scope]
code-intel repair architecture [scope]
code-intel repair evidence [scope]
code-intel plan <goal>
```

All stabilization commands default to a plan and preview. Application requires an explicit
approval-bearing mode and displays preconditions, affected files, residual findings, and post-checks.

### Control-plane candidates

```text
code-intel status
code-intel doctor
code-intel configure
```

Normal semantic commands establish the required freshness automatically. `index`, `sync`,
`unlock`, daemon selection, store migration, and native binary details are not ordinary user
journeys. If exposed for operations or debugging, they live beneath a clearly separate `system`
surface and never share result semantics with `health`.

## Dance 3: pressure through concrete journeys

### Journey A: understand a module before editing

1. User selects a module approximately by name or path.
2. Consumer resolves it to a canonical identity or returns ambiguity.
3. One dossier includes purpose, public surface, dependencies, dependents, calls, tests, docs,
   specifications, findings, ownership, history, and completeness.
4. User asks why one dependency exists and receives an exact explanatory path.

Pressure back to SDK: many leaf navigation methods should probably converge on `dossier`, `search`,
and `explain` with typed subjects rather than dozens of root methods.

Pressure back to TypeSpec: dossier composition requires cross-domain identities, joins, typed graph
paths, verified excerpts, and exact snapshot coherence.

### Journey B: enforce an SDK rule continuously

1. The Astrale model extension selects the canonical builder through aliases and barrels.
2. It derives typed SDK call facts from resolved calls, arguments, bindings, callbacks, bodies, and
   values.
3. A rule evaluates every static snapshot automatically.
4. CI and CLI project the same finding with evidence and completeness.
5. A same-named non-SDK function does not match; unknown forwarding is indeterminate rather than a
   false pass.

Pressure back to SDK: business selectors and rules belong in one extension package, but generic
rule execution and diagnostic structure should not be reimplemented.

Pressure back to TypeSpec: typed fact definitions, selectors, body/value readers, rule fixtures,
and native-capability escape must be public.

### Journey C: predict a change

1. User selects or describes a proposed signature/module/package change.
2. Consumer constructs an exact scenario over a base snapshot.
3. Predictors compose compile, module, call, value, test, doc, spec, package, security, experience,
   performance, observability, and ownership consequences.
4. Output groups impact families and shows paths, assumptions, blind spots, and non-impact evidence.

Pressure back to SDK: a single `impact` entrypoint with explicit families is better than unrelated
top-level impact commands. Specialized commands may be curated presets over the same operation.

Pressure back to TypeSpec: semantic overlays, graph composition, cross-domain entity identity, and
consequence-path contracts are mandatory.

### Journey D: repair documentation references

1. Static document modeling resolves links, anchors, code mentions, and semantic references.
2. Static evaluation reports broken, ambiguous, stale, and orphaned references.
3. User selects a finding or reference-stability goal.
4. A stabilization provider produces alternative revision-safe edit plans.
5. Overlay verification reruns model and evaluation before any application.

Pressure back to SDK: `repair docs` and `repair references` are the same stabilization family with
different presets; avoid duplicate semantic implementations.

Pressure back to TypeSpec: documents, semantic references, verified edits, plan alternatives, and
overlay verification must be generic.

### Journey E: review a patch

1. Consumer creates a proposed snapshot or semantic overlay from an exact patch.
2. Static evaluations are compared before and after.
3. Impact and affected-test predictions run for the scenario.
4. Review output separates new findings, resolved findings, changed behavior, affected surfaces,
   required evidence, and unknowns.

Pressure back to SDK: `review` is a composed journey, not another analysis engine. It orchestrates
`compare`, `impact`, `testPlan`, and selected evaluations.

Pressure back to TypeSpec: operations need stable result identities and composability without
presentation coupling.

### Journey F: stabilize architecture

1. Static architecture evaluation identifies an attributable violation.
2. User selects the exact governed architecture target and permitted change scope.
3. Consumer providers propose alternatives: facade, move, split, dependency inversion, or rule
   revision where governance permits it.
4. Each plan predicts impact and verifies postconditions over an overlay.

Pressure back to SDK: stabilization providers own business transformations; the rule cannot mutate
code or silently select one alternative.

Pressure back to TypeSpec: plan dependency, conflict, precondition, overlay, semantic diff, and
postcondition structures must be first-class.

## Dance 4: cuts and refinement

The broad SDK and CLI contain duplication. The refined product keeps these principles:

1. **No CLI mirror of the operator taxonomy.** Operators structure semantics; commands express
   user intent. Users should not need to know `MODEL` versus `EVALUATE` to inspect a module.
2. **No command per graph relation.** `show`, `find`, `explain`, and `path` cover the general
   exploration substrate. `callers`, `callees`, `dependencies`, and `references` may survive only
   as valuable shortcuts or aliases.
3. **No command per rule.** `health`, `findings`, and `check <ruleset>` project static evaluations.
   Rules remain versioned catalog entries.
4. **One impact operation.** Specialized impact commands become presets selecting families,
   assumptions, scope, and presentation.
5. **One stabilization operation.** `migrate`, `repair`, and `plan` become curated goal/provider
   presets over one typed stabilization contract.
6. **`review` is composition.** It compares snapshots, selects findings, predicts impact, and plans
   evidence; it does not own another semantic model.
7. **No ordinary index commands.** Semantic commands establish required freshness; operations
   expose only status and causal recovery unless advanced system control is needed.
8. **No magic natural-language-only API.** Natural language may resolve to typed subjects,
   scenarios, and goals, but the admitted structured intent remains visible and serializable.
9. **No automatic fixes.** Default stabilization output is a plan. Application is explicit,
   authorized, preconditioned, and followed by actual re-evaluation.
10. **No aggregate score as authority.** Summaries retain rule counts and severities, but all
    underlying outcomes, evidence, and completeness remain accessible.

## Converged programmatic SDK

The refined SDK has five semantic operation families plus project lifecycle:

```ts
await using project = await AstraleIntelligence.open(options)
const current = await project.current({ freshness: 'required' })

await current.explore(intent)
await current.model.read(selection)       // advanced typed model access, not recomputation
await current.evaluate(selection)
await current.predict(scenario)
await current.stabilize(goal)
```

`model.read` exposes consumer-owned typed business models to advanced programmatic consumers. The
static model itself is already derived when the current snapshot is established; the method name
does not imply request-time `MODEL` semantics.

### `explore(intent)`

Accepted intents include search, dossier, show, explain, path, slice, references, evidence, and
semantic diff. Results are specific discriminated types rather than one universal record.

### `evaluate(selection)`

Selects existing static evaluation results by scope, rule pack, rule, lens, status, severity,
subject, or revision. Re-evaluation occurs only when the underlying semantic snapshot or effective
business configuration changes.

### `predict(scenario)`

The scenario explicitly contains a base, selected or proposed change, scope, assumptions, impact
families, and bounds. Presets cover affected tests, patch review, release impact, entrypoint
reachability, and architecture/security impact without changing the core result contract.

### `stabilize(goal)`

The goal contains a target invariant or selected finding, allowed providers, scope, constraints,
and approval policy. It returns alternatives and verification; application is a separate explicit
method on a chosen verified plan.

### Consumer extension bundle

The Astrale package should itself be assembled from replaceable, testable domain bundles:

```ts
const AstraleIntelligence = defineIntelligenceProduct({
  modelExtensions: [sdkSemantics, moduleSemantics, documentSemantics],
  rulePacks: [architecture, sdk, api, docs, evidence, security, experience, observability, performance],
  predictors: [impact, tests, releases, securityImpact, performanceImpact],
  stabilizers: [sdkMigration, architectureRepair, referenceRepair, apiMigration, evidencePlan],
  journeys: [reviewJourney, releaseJourney],
})
```

This is downstream composition over TypeSpec public contracts. A third party can replace or add a
rule pack, predictor, stabilizer, or journey without forking either TypeSpec or the core Astrale
consumer.

## Converged CLI

Command prefix remains open. The refined target command families are:

```text
# Explore existing knowledge
<tool> overview [scope]
<tool> search <query> [filters]
<tool> show <subject>
<tool> explain <subject|finding|relation>
<tool> path <from> <to> [constraints]
<tool> compare <left> <right> [domains]

# View continuously evaluated static intelligence
<tool> health [scope] [filters]
<tool> findings [scope] [filters]
<tool> check <ruleset> [scope] [filters]

# Evaluate explicit scenarios
<tool> impact <subject|change|ref> [families] [scope]
<tool> tests affected <subject|change|ref>
<tool> tests plan <subject|change|ref> [confidence] [budget]
<tool> review <patch|commit|branch|ref>
<tool> release impact <ref>

# Move toward an explicit invariant
<tool> stabilize <finding|goal> [scope] [constraints]
<tool> migrate <preset> <target> [scope]

# Separate control plane
<tool> status
<tool> doctor
```

High-value shortcuts such as `callers`, `callees`, `dependencies`, `references`, or `node` can be
added only when real use shows that `show`/`explain` is materially slower or less discoverable. They
must remain projections over the same exploration SDK, not separate implementations.

### Operator convergence

| Semantic operator | When meaning is established | Consumer SDK | Primary CLI projections |
|---|---|---|---|
| `MODEL` | Automatically for each exact source/evidence snapshot and effective model configuration | Typed `model` extensions and advanced read-only model access | No direct modeling command; `overview`, `show`, and other journeys consume the model |
| `EVALUATE` | Automatically whenever its model inputs or effective rule configuration change | Rule packs and evaluation-result selection | `health`, `findings`, `check` |
| `EXPLORE` | At request time from an explicit selection or search intent | `explore(intent)` | `overview`, `find`, `show`, `explain`, `path`, `compare` |
| `PREDICT` | At request time from an explicit scenario and assumptions | `predict(scenario)` | `impact`, `tests`, `review`, `release impact` |
| `STABILIZE` | At request time from an explicit target invariant or finding | `stabilize(goal)` | `stabilize`, `migrate` |

The CLI is intentionally not grouped under operator names. This table proves semantic ownership;
it does not dictate navigation. Dimensions and lenses remain multi-valued filters and explanatory
facets across all operation results, never command namespaces that every user must understand.

## V1 downstream proof package

The first downstream package is intentionally smaller than the target product. It must be
independently publishable and use only TypeSpec public package subpaths. It contains four ordinary
extensions, one host-controlled compiler-near qualification provider, and one hostile fixture:

### 1. SDK semantic model and linter

- Select one representative SDK builder by canonical package export identity through aliases and
  barrels.
- Reject a same-named non-SDK function.
- Derive a typed SDK call fact from resolved call, argument binding, callback body, and bounded
  value facts.
- Follow at least one helper-forwarding path without conflating two caller contexts.
- Emit one business rule with pass, fail, indeterminate, and error coverage plus known, unknown,
  ambiguous, and unsupported values.
- Partition by function or symbol so an unrelated function edit retains its model output.

### 2. Module graph and architecture rule

- Project compiler-resolved module dependency occurrences into the public typed multigraph.
- Preserve repeated and type-only edges while offering an explicit deduplicated relationship view.
- Run paths, strongly connected components, condensation, and topological layers.
- Implement a downstream architecture rule that distinguishes permitted from forbidden cycles and
  explains the exact path.
- Run one custom weighted centrality/coupling model absent from TypeSpec through the public
  algorithm role, keeping its metrics descriptive until an explicit rule evaluates them.

### 3. Markdown reference model

- Implement Markdown as a first-party document adapter through the same public model role available
  to third parties.
- Model documents, headings, anchors, links, inline code, and semantic mentions without HTML as
  authority.
- Resolve references to documents, headings, modules, and TypeScript symbols with resolved,
  ambiguous, unresolved, and invalid states.
- Incrementally handle edit, heading rename, file rename, and deletion without reparsing unrelated
  documents or rebuilding the TypeScript universe.
- Evaluate reference integrity as a downstream rule over the generic document model.

### 4. Bounded impact algorithm

- Accept an explicit symbol, module, or file change scenario.
- Compose module, call, reference, and rule-result graph projections.
- Return separated consequence families with explanatory paths, limits, dynamic escape, and
  completeness rather than a score.
- Remain an ephemeral query-algorithm result; V1 does not need the complete future scenario or
  stabilization framework.

### 5. Compiler-near capability fixture

- Add one exact compiler fact deliberately absent from the built-in portable model and consume it
  from an ordinary materialized extension.
- Publish only versioned portable definitions and admitted output; never expose a live AST,
  Checker, session, native handle, or wire message to the consumer.
- Qualify supported and unsupported host/compiler ranges, schema mismatch, invalid output,
  cancellation, and producer collision before generation admission.
- Install through explicit host policy and a prebuilt distribution path; the consuming package
  must not require local Go tooling or compile repository code.

### 6. Hostile extension fixture

- Attempt an undeclared kind write, producer collision, dependency cycle, incompatible schema,
  excessive output, full-scan access, cancellation, timeout, and unexpected exception.
- Prove causal planning/admission failures, enforced limits, optional unavailability, mandatory
  abort, prior-snapshot isolation, and attributable execution evidence.
- Prove a first-party model and third-party model receive equal registry, planning, reader, emitter,
  invalidation, and performance rights.

### V1 demonstration SDK and CLI

The proof package should sketch programmatic use through real compilable examples:

```ts
await using project = await AstraleIntelligence.open({ root, extensions, signal })
const snapshot = await project.current({ freshness: 'required' })

const module = await snapshot.explore({ kind: 'dossier', subject: moduleSelector })
const findings = await snapshot.evaluate({ rules: ['architecture', 'sdk', 'references'] })
const impact = await snapshot.impact({ change, families: ['modules', 'calls', 'references'], maximumDepth: 8 })
```

The V1 `impact` facade is a consumer-owned intent over a public TypeSpec query algorithm. It does
not imply that TypeSpec has already stabilized the complete future scenario/prediction SDK.

The small CLI needs only enough surface to prove projection reuse:

```text
<tool> show <subject>
<tool> explain <subject|finding|relation>
<tool> path <from> <to>
<tool> findings [scope]
<tool> check <architecture|sdk|references> [scope]
<tool> impact <subject|change> [--family ...]
<tool> status
```

Human and JSON modes consume the same typed results. `status` remains operational; `findings` and
`check` remain static evaluation views. The other target commands are deferred product work, not
stubbed or approximated in V1.

## Incremental and performance proof matrix

Correctness and performance are qualified together because an extension API that requires full
recomputation is not a successful foundation.

| Change or workload | Required proof |
|---|---|
| No-op refresh | No model extension partitions rerun and the semantic generation remains equivalent |
| One function-body edit | SDK model replaces only the function partition plus declared dependent closure; unrelated partitions are retained |
| File create/delete/rename | Added and removed partitions are exact and no orphan facts survive |
| SDK extension configuration change | Only extensions whose semantic configuration digest changed are invalidated |
| Extension implementation/schema upgrade | Compatibility is negotiated; compatible outputs remain valid or incompatible derived evidence rebuilds causally |
| Markdown heading rename | Changed document and reverse-reference dependents update without rebuilding unrelated documents or TypeScript facts |
| Module-boundary/config edit | Required compiler universes and downstream module partitions refresh, then equal a cold build |
| Large sparse module/call graph | Traversal streams bounded results, supports cancellation, and does not materialize the entire graph accidentally |
| Batch SDK rule evaluation | Typed batch readers avoid per-fact asynchronous lookup and execution evidence reveals full scans or N+1 behavior |
| Excessive or slow extension | Effective limits terminate or truncate it without exposing partial invalid output or corrupting the prior generation |
| Memory versus durable reopen | Identical facts, graph results, findings, provenance, completeness, and extension-plan identity |

Fixed representative fixtures record cold and incremental time, selected/retained/replaced
partitions, input/output counts, query count/shape, peak or bounded memory where measurable, and
store size. Numeric release thresholds are ratified from reproducible baselines; they are not
invented in this design. The hard semantic gates are cold/incremental equivalence, bounded access,
correct partition retention, enforced limits, and absence of unexplained whole-repository work.
The downstream qualification manifest resolves every V1 `proof` ID in the capability roadmap to
these fixtures and records the exact public capability, role, provider, store, and package matrix.

## Result and output contract

Every human and machine result includes, directly or by stable reference:

- operation and admitted structured intent;
- locked operator, semantic world, dimensions, and applicable lenses;
- exact repository, snapshot set, universes, source revisions, and effective configuration;
- selected subject, scenario, or target invariant;
- result-specific entities, findings, consequences, plans, or paths;
- evidence, provenance, derivation, and related locations;
- completeness, freshness, ambiguity, unsupported constructs, unavailable capabilities, and
  heuristic status;
- limits and truncation;
- stable codes and typed states independent of prose;
- suggested next intents that reuse canonical identities; and
- a versioned output schema for machine modes.

Human output leads with the useful answer, then evidence and caveats. `--json` changes projection,
not meaning. Quiet and summary modes may omit detail from display but cannot convert indeterminate
or unavailable into success.

## Static evaluation and CI

CI selects a required fresh snapshot and rule configuration, then reads the already-defined static
evaluation semantics. Exit behavior is business-owned and explicit:

- a configured failing rule may fail CI;
- indeterminate required evidence may fail CI under policy;
- unavailable mandatory capabilities fail causally;
- warnings and accepted suppressions remain visible;
- operational refresh failure is distinct from a valid evaluation failure; and
- focused checks remain advisory unless the repository governance designates them authoritative.

The CLI does not create a second rule implementation for CI.

## Stabilization safety

The product must preserve this lifecycle:

```text
finding or desired invariant
  -> candidate alternatives
  -> immutable plan
  -> precondition and conflict validation
  -> semantic overlay
  -> predicted impact and postcondition evaluation
  -> user selects one alternative
  -> explicit application authority
  -> actual refresh
  -> actual model and evaluation
  -> residual report
```

Plans can include source edits, moves, creates, deletes, configuration changes, rule revisions, or
manual steps. A rule revision is never presented as equivalent to repairing the code; governance
must explicitly authorize that alternative.

## V1 consumer acceptance gate

The first downstream proof is not complete merely because it can call the platform. It must prove:

1. no production import from TypeSpec internals, stores, protocols, native adapters, CLI, server,
   viewer, or TypeSpec product-specific specification/conformance modules;
2. no raw `Fact<unknown>` payload cast or private namespace/capability string;
3. no direct TypeScript or Markdown parsing for semantics already owned by the platform;
4. no duplicate graph storage or compiler lifecycle;
5. canonical SDK identity through aliases/barrels and collision rejection;
6. real SDK rules over callbacks, forwarding, body flow, and all epistemic states;
7. real document/reference rules through the public document/model extension role;
8. real module graph algorithms, architecture rules, and bounded cross-domain impact;
9. one custom graph algorithm and one compiler-sensitive fact extension without a TypeSpec fork;
10. identical semantic results through programmatic, CLI JSON, CI, and MCP-like projections;
11. static evaluation behavior independent of which CLI view requests it;
12. impact rejects missing selections and bounds; complete scenario/stabilization contracts remain
    explicitly deferred;
13. cold/incremental, memory/durable, and reopen equivalence for the same exact inputs;
14. causal operational errors distinct from valid negative or indeterminate semantic results;
15. temporal test/trace/benchmark evidence joined without being mistaken for source-derived truth;
    and
16. published-package installation and execution with no local Go or repository-executed plugin.

The broader product becomes complete incrementally as catalog capabilities move from `catalogued`
or `kernel-supported` to `product-integrated`. Absence from V1 is acceptable when the integration
ledger names the future family and no V1 code falsely claims the capability.

## What remains intentionally open

1. Product and command prefix naming.
2. Whether `show` is a dossier alias or a distinct compact projection.
3. Which high-frequency graph shortcuts deserve commands after usage evidence.
4. Whether `health` is a top-level command or a default `overview` section; it remains a static
   evaluation view either way.
5. How natural-language intent is admitted into typed selectors and scenarios without hiding the
   structured request.
6. Whether plan application belongs in this package or a separate mutation-capable host adapter.
7. Which rule packs are default, opt-in, mandatory in CI, or organization-specific.
8. How multi-repository indexes are discovered and authorized.
9. Which result schemas are stable enough for first publication.

These decisions should be resolved by implementing representative journeys against the candidate
TypeSpec surface, then moving back upstream when the consumer encounters friction and back
downstream when the platform exposes unnecessary mechanism. Neither file is complete independently.
