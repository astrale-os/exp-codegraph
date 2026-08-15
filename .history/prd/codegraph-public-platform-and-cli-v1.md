# PRD: Codegraph public semantic platform and `cg` CLI V1

Status: approved product direction

Date: 2026-08-15

Product: `@astrale-os/codegraph`

CLI: `cg`

Implementation state: successor contract; current implementation is not claimed to conform

## Authority and transition

This document locks the intended first public Codegraph product surface agreed after the TypeSpec
V2 extraction work. It is authoritative for new public CLI design, ordinary consumer journeys,
semantic-extension design, and the boundary between Codegraph and tool providers.

The ratified TypeSpec V2 ADR remains evidence and governs the implementation currently being cut
over. It correctly established the reusable `ttsc` foundation, immutable analysis generations,
portable facts, explicit completeness, transactional materialization, demand-driven projections,
and trusted-extension boundary. This PRD intentionally changes the product above that foundation:

- the product and package are Codegraph, not TypeSpec;
- `.spec` authoring and specification conformance are not Codegraph V1 product responsibilities;
- there is no `spec` CLI namespace or stable specification API;
- the CLI is organized around evaluation, repair, execution, semantic reading, impact, and
  governed source-control workflows; and
- independently installed semantic packs may add native-feeling entity kinds, relations, models,
  rules, checks, fixes, selectors, and projections without changing Codegraph core.

Existing specification code may remain temporarily as migration evidence. It is not part of the
target public product. Implementing this successor contract requires a governed revision of any
older requirement that still makes TypeSpec or `.spec` authoritative. This PRD does not silently
rewrite qualification history or claim that migration has happened.

## Product statement

Codegraph is a headless, extensible developer-intelligence platform with one coherent CLI. It
turns compiler-resolved source evidence into immutable typed semantic snapshots and makes those
snapshots useful for humans, agents, CI, editors, rule packages, and other programs.

Codegraph owns understanding, identity, selection, correlation, explanation, planning, evidence,
and normalized results. Specialized providers continue to own the mechanics they already perform
well:

- `ttsc` and TypeScript-Go own compiler-exact TypeScript semantics;
- Oxlint owns its lint rules and fast syntactic diagnostics;
- Oxfmt owns canonical formatting;
- Vitest owns test execution; and
- Git owns source-control storage and transitions.

The user experiences one `cg` control plane, one configuration model, one snapshot model, one
result vocabulary, and one extension protocol. Internally, Codegraph remains a hierarchical,
headless module DAG rather than a monolithic replacement for those engines.

## Goals

V1 must:

1. provide a small, memorable CLI for evaluation, repair, formatting, testing, semantic reading,
   causal tracing, impact analysis, status, and guarded Git workflows;
2. preserve the speed, reach, streaming, and composability of ordinary file reads and text search;
3. expose the same typed semantic results to human output, JSON, JSONL, SARIF where applicable,
   the optional graphical viewer, and public programmatic APIs;
4. make compiler-resolved TypeScript identity, aliases, barrels, calls, argument binding, bodies,
   control flow, definition-use, summaries, and bounded values available on demand;
5. allow an SDK or third party to add first-class semantic vocabulary and behavior without a
   private hook, core fork, or separate mini-CLI;
6. retain immutable, generation-pinned evidence with provenance and explicit epistemic state;
7. make ordinary work proportional to the requested capability and selected scope;
8. support incremental edit, rename, create, delete, configuration, extension-version, and
   provider-version changes without unexplained repository-wide work;
9. make source mutation explicit, revision-pinned, conflict-checked, and attributable; and
10. keep storage, native protocol, compiler handles, pass scheduling, and physical encoding out of
    ordinary consumer APIs.

## Non-goals

V1 does not:

- provide `.spec` authoring, a `spec` checker, or TypeSpec compatibility as a public product;
- replace Bash, `cat`, `sed`, `find`, `rg`, Git, Oxlint, Oxfmt, Vitest, or the TypeScript compiler;
- expose live AST, Checker, native-session, wire, transaction, shard, SQLite, or process objects to
  ordinary consumers;
- execute arbitrary repository JavaScript or load executable extensions selected only by an
  untrusted repository;
- promise unrestricted JavaScript evaluation, whole-program theorem proving, or complete dynamic
  call resolution;
- convert incomplete evidence into a negative conclusion;
- treat graph metrics, counts, or predictions as authoritative quality scores;
- create permanent CLI namespaces for every provider, semantic pack, storage mechanism, or UI;
- become a general build, deploy, release, package-manager, or Git-plumbing replacement; or
- add a generalized scenario or prediction framework before concrete consumers require one.

## Product laws

The following are binding:

1. **One semantic result, many projections.** Human, JSON, JSONL, SARIF, and graphical output are
   projections of the same typed result. Presentation never recomputes an evaluation.
2. **Identity before spelling.** Semantic recognition uses resolved identities and declared
   relationships, never name matching alone.
3. **Evidence before inference.** Every entity, relation, finding, trace, fix, and impact
   consequence carries its grounding, provenance, completeness, and snapshot identity.
4. **Missing is not false.** Partial, unavailable, stale, ambiguous, unsupported, indeterminate,
   and error states remain explicit.
5. **Demand before depth.** A command requests only the semantic capabilities needed for its
   result. Formatting or raw search never pays for bodies, CFG, or value evaluation.
6. **Read before hydrate.** Selection first reads indexed headers and hydrates only requested
   payloads. Point and page queries do not reconstruct unrelated shards or facts.
7. **Immutable publication.** Consumers observe one validated snapshot or the prior snapshot;
   partial generations are never visible.
8. **Exact mutation authority.** A repair applies only to the source revisions for which it was
   planned. Stale or conflicting work fails explicitly.
9. **Core and extension parity.** First-party and third-party semantic packs use the same public
   definitions, readers, emitters, planner, limits, validation, and admission.
10. **Repository configuration cannot escalate trust.** It may select allowed semantic packs and
    declarative configuration; it may not cause arbitrary repository code to execute.

## Stable CLI vocabulary

The ordinary V1 command tree is:

```text
cg
├── check [check...]
├── lint [target...]
├── fix [target...]
│   ├── plan
│   └── apply
├── format [target...]
├── test [target...]
├── impact [change...]
│
├── show <selector...>
├── find <kind> [pattern]
├── trace <kind> [...]
│
├── status
├── git
│   ├── status
│   ├── diff
│   ├── commit
│   ├── push
│   └── merge
│
├── init
├── config
│   ├── show
│   ├── path
│   └── validate
├── doctor
├── completion
├── help
└── version
```

The public vocabulary deliberately does not contain:

- `spec`;
- `affected`;
- `overview`, `search`, `query`, or `explore`;
- top-level `findings`, `explain`, or `path`;
- ordinary `plugin`, `index`, `cache`, or `daemon` namespaces; or
- `policy`, `pass`, `fact`, `shard`, `transaction`, or other implementation vocabulary.

Their intended journeys are covered as follows:

| Removed or avoided term | Canonical journey |
| --- | --- |
| overview | `cg show .` |
| search | `cg find <kind> [pattern]` |
| query | typed `cg find` predicates and public programmatic readers |
| explore | `--open` on `show`, `find`, or `trace` |
| findings | `cg find finding` |
| explain | `cg trace why` |
| path | `cg trace path` |
| affected tests | `cg test --since <ref>`, `--staged`, `--worktree`, or a source selector |
| CI command | `cg check --profile ci` |
| watch command | `--watch` on the operation being repeated |

## Command grammar

```text
cg [global options] <command> [subcommand] [targets...] [command options]
```

Commands accept ordinary paths where unambiguous and typed selectors where precision matters.

Examples:

```text
src/service.ts
file:src/service.ts
module:runtime/boot
symbol:@astrale-os/sdk#defineMutation
finding:01J...
test:runtime/__tests__/boot.test.ts#starts-host
snapshot:sha256:...
commit:HEAD~3
astrale.sdk.workflow:host.provision
```

Canonical entity kinds are globally namespaced. Ordinary input uses concise registered aliases:

| Canonical kind | Built-in CLI alias |
| --- | --- |
| `codegraph.repository.file` | `file` |
| `codegraph.module` | `module` |
| `codegraph.typescript.symbol` | `symbol` |
| `codegraph.typescript.call` | `call` |
| `codegraph.typescript.reference` | `reference` |
| `codegraph.typescript.occurrence` | `occurrence` |
| `codegraph.graph.cycle` | `cycle` |
| `codegraph.markdown.document` | `document` |
| `codegraph.markdown.reference` | `doc-reference` |
| `codegraph.runtime.trace` | `runtime-trace` |
| `codegraph.finding` | `finding` |
| `codegraph.test.case` | `test` |
| `codegraph.test.run` | `run` |
| `codegraph.analysis.snapshot` | `snapshot` |
| `codegraph.git.commit` | `commit` |

An extension may similarly register `workflow` as an alias for `astrale.sdk.workflow`. An alias is
admitted only when exactly one registered kind owns it. Ambiguity fails with canonical
alternatives. Structured output always uses canonical kind and identity.

## Global options

Only options with identical semantics across commands are global:

```text
-C, --root <directory>             repository discovery root
--config <file>                    explicit declarative configuration
--output <human|json|jsonl|sarif>  requested projection
--color <auto|always|never>
-q, --quiet
-v, --verbose                      repeatable
--log-level <error|warn|info|debug|trace>
--progress <auto|always|never>
--offline                          prohibit network-dependent providers
--timings                          include attributable operation timing
-h, --help
-V, --version
```

Rules:

- requested data is written to stdout;
- progress, logging, and diagnostic operation context are written to stderr;
- machine envelopes are versioned and never contain human decoration;
- `--quiet` never hides requested results or failures;
- unsupported command/output combinations fail as invalid invocation rather than degrading; and
- physical cache or daemon choices never alter semantic results.

## Shared scope options

Commands expose only the applicable subset of:

```text
--since <git-ref>                  compare from ref to the complete worktree
--staged                           compare HEAD to the Git index
--worktree                         compare HEAD to index plus unstaged and untracked inputs
--include <glob>                   repeatable
--exclude <glob>                   repeatable
--project <tsconfig>               repeatable
--module <selector>                repeatable
--purpose <implementation|test|test-support|fixture|evidence|unknown>
--provenance <authored|generated|vendored|unknown>
--snapshot <id>                    pin an existing immutable snapshot
--watch                            rerun on relevant admitted changes
--jobs <number>
--timeout <duration>
```

`--since`, `--staged`, `--worktree`, explicit patch input, and explicit snapshot comparison are
mutually exclusive unless a command documents an exact composition. The public CLI does not use
`affected` as a command or subcommand.

## Selectors and composition

The selector contract is shared by the CLI and public SDK:

- a selector names a kind, identity, scope, or registered alias;
- canonical selectors are portable and never contain checkout-local absolute paths;
- ambiguous aliases fail closed;
- source selectors carry or resolve through an exact source revision when used for mutation;
- multi-selector lookup is batched;
- unbounded selection is paginated or streamed;
- every limited result reports a cursor or explicit terminal state; and
- JSONL identities may be piped to another `cg` command through `--stdin`.

Examples:

```sh
cg find symbol mutation --output jsonl |
  cg show --stdin --output jsonl

cg find finding --severity error --output jsonl |
  cg show --stdin --output jsonl
```

## Output and exit contract

JSON and JSONL projections include, where applicable:

```text
schemaVersion
command
snapshot
configuration
completeness
data
diagnostics
page or stream continuation
timings when requested
```

Exit statuses are stable:

| Code | Meaning |
| ---: | --- |
| `0` | operation completed and its requested condition was satisfied |
| `1` | valid result did not satisfy the requested condition: no match/path, blocking finding, format drift, test failure, check failure, or impact threshold |
| `2` | invalid invocation, selector, or configuration |
| `3` | requested result was unavailable, stale, incomplete beyond policy, or cancelled by a declared limit |
| `4` | provider, storage, protocol, or unexpected implementation failure |
| `130` | user interruption |

Finding severity does not determine exit status by itself; the invoked command's effective
`fail-on` policy does. A machine result records both the semantic outcome and exit classification.

## The three semantic read primitives

### `cg show`

`show` answers: **what is this known thing?**

```sh
cg show .
cg show file:src/service.ts
cg show file:src/service.ts --lines 80:140 --raw
cg show module:runtime/boot
cg show symbol:@astrale-os/sdk#defineMutation
cg show finding:01J...
cg show run:01J...
cg show astrale.sdk.workflow:host.provision --open
```

Options include:

```text
--raw
--lines <start:end>
--fields <field,...>
--source
--provenance
--completeness
--snapshot <id>
--open
--stdin
```

Semantics:

- lookup is exact after alias resolution;
- multiple selectors are admitted and hydrated in bounded batches;
- `cg show .` returns the repository semantic summary and replaces `overview`;
- raw source access verifies the pinned source revision when a snapshot is requested;
- `--raw` emits source content without a Codegraph envelope;
- file reads can operate without building the semantic index; and
- the optional viewer receives the same typed result rather than recomputing it.

### `cg find`

`find` answers: **which things satisfy these constraints?** It subsumes text search, semantic
search, findings listing, filtering, indexed joins, and bounded aggregation.

```sh
cg find text 'defineMutation\\('
cg find text TODO src/ --glob '*.ts'
cg find symbol defineMutation
cg find call --to symbol:@astrale-os/sdk#defineMutation
cg find reference --to symbol:...
cg find module --depends-on module:runtime
cg find finding --severity error
cg find finding --check architecture
cg find test --since origin/main
cg find doc-reference --state unresolved
cg find cycle --edge runtime
cg find astrale.sdk.action --writes astrale.sdk.object:Host
```

Registered kinds may contribute typed selector fields. Common options include:

```text
--where <typed-predicate>          repeatable
--include <glob>
--exclude <glob>
--purpose <purpose>
--provenance <provenance>
--since <ref>
--staged
--worktree
--limit <number>
--cursor <cursor>
--count
--files
--context <lines>
--snapshot <id>
--open
```

There are two execution paths:

1. `find text` is a direct, streaming filesystem search that does not require index warmup. It
   supports literal or regex search, globs, hidden/ignore policy, file-only output, context, counts,
   bounded streaming, and JSONL. It may delegate to proven fast search machinery.
2. semantic `find` uses generation-pinned indexed selection, pushdown, batching, and selective
   hydration. It never requires whole-generation export for an ordinary page or count.

V1 does not require a large query language. Typed kinds, predicates, joins, batching, pagination,
and public programmatic readers are the stable contract. A future textual language must compile to
that contract rather than become a second query authority.

### `cg trace`

`trace` answers: **how are these things connected, and why did this result occur?** It subsumes
path and explanation commands.

```sh
cg trace calls symbol:foo
cg trace calls symbol:foo --direction callers --depth 4
cg trace value occurrence:01J...
cg trace dependency module:a
cg trace path module:a module:b
cg trace why finding:01J...
cg trace why test:... --since origin/main
cg trace references document:README.md
cg trace runtime runtime-trace:01J...
```

Trace kinds are:

```text
calls
value
dependency
references
path
why
runtime
```

Options include:

```text
--direction <in|out|both>
--depth <number>
--edge <kind>                    repeatable
--through <selector>
--avoid <selector>
--all-paths
--limit <number>
--view <tree|graph|sequence>
--snapshot <id>
--open
```

A trace returns ordered nodes and edges, exact witnesses, source evidence, provenance,
completeness, dynamic escape, effective traversal limits, truncation, and snapshot/configuration
identity. Runtime traces come from explicit instrumentation providers and remain distinguishable
from static inference.

The read primitives are exhaustive and irreducible:

| Primitive | Mapping | Question |
| --- | --- | --- |
| `show` | known identity to entity | What is this? |
| `find` | predicate to result set | Which things match? |
| `trace` | entities to relational proof | How or why are they connected? |

## Evaluation and change commands

### `cg check`

`check` coordinates one configured quality plan. It does not redefine rules, formatting, or tests.

```sh
cg check
cg check architecture
cg check sdk references
cg check --profile ci
cg check --staged --profile precommit
cg check --since origin/main
cg check --only lint --only test
cg check --watch
```

Named checks are registered evaluation suites. Built-in or installed examples include:

```text
architecture
sdk
references
types
lint
format
test
```

Options include:

```text
--profile <name>
--only <check>                   repeatable
--skip <check>                   repeatable
--fail-fast
--max-warnings <number>
--since <ref>
--staged
--worktree
--watch
```

Repositories select declarative check profiles. Protected CI decides which profile is
authoritative. Local narrowing cannot silently weaken that external authority.

### `cg lint`

`lint` evaluates static rules and publishes or returns one exact evaluation result.

```sh
cg lint
cg lint src/
cg lint --since origin/main
cg lint --rule 'astrale.sdk/*'
cg lint --severity error
```

It normalizes Oxlint, compiler, Codegraph, and installed semantic-pack diagnostics into one typed
finding with rule identity, provider, evidence, completeness, suppression, and optional repair
references.

Options include:

```text
--rule <pattern>                 repeatable
--category <category>
--severity <info|warning|error>
--suppressed <hide|show|only>
--baseline <file>
--max-warnings <number>
--fail-on <warning|error>
--since <ref>
--staged
--worktree
```

`lint` diagnoses. `check` coordinates lint with other gates. Findings are read through `find` and
`show`; there is no separate findings namespace.

### `cg fix`

`fix` plans and applies causal repairs. It is not an alias for formatting.

```sh
cg fix
cg fix --staged
cg fix --finding 01J...
cg fix --rule 'astrale.sdk/*'
cg fix plan --output json > fix-plan.json
cg fix apply fix-plan.json
```

Options include:

```text
--finding <id>                  repeatable
--rule <pattern>                repeatable
--source <lint|typescript|references|all>
--safe-only                     default
--unsafe                        explicit opt-in
--interactive
--dry-run
--format                        format changed files after repair
--max-passes <number>
```

Every plan records exact input revisions, edits, diagnostic or intent, safety, provider,
provenance, conflicts, and expected postconditions. Application is atomic per declared plan scope
and fails if any required source revision is stale. Unexpected edits are never silently rebased.

### `cg format`

```sh
cg format
cg format --check
cg format --staged
cg format --since origin/main
```

`cg format` writes. `cg format --check` is non-mutating. `cg check` invokes only check mode.

Oxfmt owns formatting semantics. Codegraph owns project and file selection, effective
configuration, orchestration, cancellation, and normalized results. Formatting remains separate
from fixing because it is canonical, idempotent whole-text normalization rather than a causal
repair.

### `cg test`

The public test vocabulary does not use an `affected` subcommand.

```sh
cg test
cg test test:runtime/__tests__/boot.test.ts#starts-host
cg test file:src/boot.ts
cg test --since origin/main
cg test --staged
cg test --worktree
cg test --list
cg test --watch
```

- a test selector runs that exact test or declared group;
- an implementation source, symbol, module, change, or snapshot comparison selects causally
  related tests through the impact graph;
- every selected test has an attributable selection reason;
- incomplete selection expands conservatively or fails according to effective policy; and
- retained run results are read through `show` and `find`.

Options include:

```text
--list
--watch
--runner <vitest|node|custom>
--coverage
--update-snapshots
--bail <number>
--retry <number>
--workers <number>
--shard <index>/<count>
--seed <number>
--timeout <duration>
--reporter <name>
-- <provider arguments>
```

Vitest owns test discovery and execution for the default TypeScript provider. Codegraph owns stable
test identity, semantic selection, reasons, normalized execution results, and links to findings and
source evidence.

### `cg impact`

Impact is prospective and counterfactual; trace is retrospective and causal.

```sh
cg impact                       # HEAD to complete worktree
cg impact --staged              # HEAD to index
cg impact --since origin/main   # origin/main to worktree
cg impact file:src/foo.ts
cg impact symbol:foo
cg impact --patch change.diff
```

Options include:

```text
--from <revision|snapshot>
--to <revision|snapshot|index|worktree>
--patch <file>
--kind <family>                 repeatable
--confidence <minimum>
--fail-on <unknown|high|breaking>
```

Consequences remain separated by family:

```text
files and functions
modules and packages
public API
calls and values
references and documents
rules and findings
test selection
build and release scope
dynamic escape and unknown regions
registered semantic-pack families
```

Impact returns explanatory paths, effective limits, completeness, and dynamic escape. It is an
ephemeral typed query result, not an opaque score or generalized scenario framework.

## Control-plane commands

### `cg status`

`status` reports control-plane state only:

```sh
cg status
cg status --verbose
cg status --output json
```

It may report the discovered root, configuration, projects, provider versions, current snapshot,
inventory revision, requested and available materializations, store freshness, resident process,
trusted semantic packs, compatibility, last execution, invalidation summary, timings, and physical
cache size.

It must not claim that code is healthy. `check`, `lint`, `format --check`, and `test` own those
judgments.

Ordinary V1 does not expose permanent `index`, `cache`, `plugin`, or `daemon` namespaces. The
system manages those mechanics automatically. `status`, `doctor`, and effective configuration
provide diagnostics. A later advanced operational surface requires concrete consumer evidence and
must not leak physical internals into semantic commands.

### `cg config`

```sh
cg config show
cg config path
cg config validate
```

`config show` returns the resolved declarative configuration and the origin of each effective
value. V1 discovers `codegraph.config.json` unless `--config` is provided. Configuration can select
projects, scopes, rule/check profiles, providers, allowed semantic-pack identifiers, and validated
pack configuration. It cannot name arbitrary executable repository files.

### `cg doctor`

`doctor` performs non-mutating checks of provider availability, native compatibility, project
discovery, configuration, semantic-pack compatibility, snapshot/store integrity, and source
admission. Repair requires a separately explicit operation; `doctor` never silently downloads,
rewrites, or deletes.

### Setup and shell integration

`cg init` creates the smallest declarative Codegraph repository configuration and never overwrites
an existing one. `cg completion <shell>`, `cg help`, `cg version`, `cg --help`, and `cg --version`
provide ordinary shell integration.

## Governed Git workflows

`cg git` is Codegraph-aware orchestration, not a Git replacement.

```sh
cg git status
cg git diff origin/main
cg git commit -m 'feat: ...'
cg git push
cg git merge feature/foo
```

- `status` reports Git state plus semantic change and snapshot freshness.
- `diff` projects textual, structural, API, relationship, and registered semantic differences.
- `commit` binds configured checks to the exact staged tree, then delegates to Git.
- `push` binds configured checks to the exact outgoing commit set, then delegates to Git.
- `merge` previews semantic consequences and conflicts; mutation is explicit and delegated.

Binding laws:

- no command stages unrelated files implicitly;
- no command rewrites history implicitly;
- checks authorize only the exact tree, index, or commits they observed;
- a passing stale snapshot cannot authorize a later mutation;
- ordinary force push is not exposed; an explicitly configured workflow may allow
  `--force-with-lease`; and
- reset, checkout, stash, bisect, reflog, plumbing, and other operations with no Codegraph semantic
  ownership remain Git commands.

## Headless public semantic model

The CLI is one consumer of a headless platform. Ordinary APIs expose coherent domain contracts,
not compiler, storage, or orchestration internals.

The public model includes:

- workspace lifecycle and explicit asynchronous disposal;
- immutable repository snapshots pinned to exact source inventory and project generations;
- globally namespaced and versioned entity, fact, and relation kinds;
- stable typed identities and explicit stability classes;
- verified source reads and source spans;
- provenance, grounding, completeness, and effective limits;
- compiler-resolved TypeScript entities and relationships;
- typed lookup, selection, batching, pagination, bounded streaming, traversal, and paths;
- graph projection, composition, SCC, condensation, layers, and diff;
- static evaluation definitions, findings, suppressions, and evaluation results;
- generation-pinned edit plans and normalized test/check/impact results; and
- a public semantic-pack authoring and registration boundary.

Ordinary consumers do not receive live AST, Checker, native-session, transaction, shard, wire,
SQLite, or pass-runner objects. Advanced implementation APIs, if retained, live behind explicit
advanced subpaths and do not become dependencies of ordinary semantic packs.

The ordinary stable package surface is:

| Subpath | Responsibility |
| --- | --- |
| `@astrale-os/codegraph` | workspace lifecycle, immutable snapshots, typed selectors and readers, semantic results, findings, edit plans, test/check/impact results |
| `@astrale-os/codegraph/extension` | semantic-pack, kind, model, rule, check, repair, projection, registry, compatibility, and qualification contracts |
| `@astrale-os/codegraph/typescript` | portable TypeScript kinds, compiler-resolved anchor definitions, typed TypeScript readers, and bounded value contracts |
| `@astrale-os/codegraph/node` | explicit Node host composition for filesystem, installed providers, persistence selection, and process lifecycle |
| `@astrale-os/codegraph/package.json` | package metadata |

Storage engines, native protocol, physical fact representation, transaction mechanics, and pass
orchestration are not root re-exports. If an advanced public subpath is required for a host
implementation, it carries a separate stability contract and may not become an ordinary semantic
pack dependency.

## Semantic packs

A semantic pack makes a domain vocabulary native to Codegraph without putting that business
meaning in core. An SDK pack may define Capabilities, Objects, Workflows, Actions, and their
relations. A documentation pack may define Documents, Headings, Links, and semantic references.
First-party packs use exactly the same boundary as independently published packs.

The public extension surface owns these roles:

```ts
defineSemanticPack(...)
defineEntityKind(...)
defineFactKind(...)
defineRelationKind(...)
defineTypeScriptAnchors(...)
defineSemanticModel(...)
defineRule(...)
defineCheck(...)
defineRepair(...)
defineProjection(...)
```

Factory spelling may be refined only through an explicit public-API revision. The role separation
is binding:

| Role | Responsibility |
| --- | --- |
| kind definition | portable typed vocabulary, schema, identity, aliases, selector fields, and indexes |
| anchor definition | canonical external/compiler identities that carry domain meaning |
| semantic model | bounded reads of upstream kinds and materialization of declared outputs |
| rule | static evaluation that produces typed findings without mutating source or facts |
| check | composition of already-defined rules and required materializations |
| repair | revision-pinned edits tied to a finding or explicit migration intent |
| projection | human or transport presentation of an existing typed result |

A conceptual pack is:

```ts
export const sdkSemantics = defineSemanticPack({
  id: 'astrale.sdk',
  version: '1.0.0',

  entities: {
    capability,
    object,
    workflow,
    action,
  },

  relations: {
    workflowContainsAction,
    actionRequiresCapability,
    actionReadsObject,
    actionWritesObject,
    actionInvokesAction,
    actionImplementedBySymbol,
  },

  models: [sdkModel],
  rules: [sdkRules],
  checks: { sdk: sdkCheck },
  projections: [sdkProjection],
})
```

Each definition includes an independent globally namespaced identity and version, typed schema,
compatibility range, declared reads and writes where executable, limits, configuration schema, and
trust tier. Registration rejects kind, alias, producer, rule, check, selector, and projection
collisions causally.

Exactly one authoritative materializer produces a materialized kind in an effective plan. Multiple
rules may read it, and multiple projections may present it. Plan identity, dependency closure,
ordering, configuration, versions, and compatibility become part of snapshot provenance.

## SDK semantic materialization

An SDK semantic entity is usually not equivalent to one native symbol. Native identities are
anchors and grounding; higher-level entities are derived from resolved uses, argument binding,
values, declarations, and ownership context.

The pipeline is:

```text
TypeScript program
    ↓ ttsc portable facts
symbols, aliases, calls, arguments, bodies, values
    ↓ SDK anchor matching
canonical SDK builder or marker identity
    ↓ SDK semantic recognition
specific declaration/call/configuration and bounded context
    ↓ identity and materialization
SDK entities and typed relations
    ↓ validation and atomic admission
immutable Codegraph snapshot
```

For example:

```ts
import {
  capability,
  workflow as defineWorkflow,
  action,
} from '@astrale-os/sdk'

export const ManageHost = capability('host.manage')

export const provisionHost = defineWorkflow({
  id: 'host.provision',
  requires: [ManageHost],
  run: action(async (context) => {
    await context.host.create()
  }),
})
```

The SDK pack declares canonical package-export anchors:

```ts
const anchors = defineTypeScriptAnchors({
  workflow: { package: '@astrale-os/sdk', export: 'workflow' },
  action: { package: '@astrale-os/sdk', export: 'action' },
  capability: { package: '@astrale-os/sdk', export: 'capability' },
})
```

`ttsc` resolves aliases and barrels back to those exports. A same-spelled local function does not
match. The semantic model reads the recognized calls, caller-specific parameter/argument binding,
bounded values, assigned declaration symbols, callbacks, and summaries, then emits:

```text
astrale.sdk.capability:host.manage
astrale.sdk.workflow:host.provision
astrale.sdk.action:<stable-action-identity>

workflow:host.provision --requires--> capability:host.manage
workflow:host.provision --contains--> action:<identity>
workflow:host.provision --declared-by--> codegraph.typescript.symbol:provisionHost
action:<identity> --implemented-by--> codegraph.typescript.symbol:<callback>
```

The relation between SDK and TypeScript is normally **grounded in**, **declared by**,
**constructed by**, or **implemented by**, not universal identity equivalence. One implementation
symbol may realize several configured actions; one semantic action may be grounded in a builder,
callback, object literal, and declaration together.

Entity identity follows this precedence:

1. explicit stable domain identity, such as `host.provision`;
2. canonical declaration-symbol identity when the domain defines one declaration as the entity;
3. canonical occurrence/owner/path identity for anonymous constructs, with its narrower stability
   promise explicit.

Physical line numbers, database row IDs, checkout roots, and source-order ordinals are not portable
semantic identity. Duplicate explicit identities become causal ambiguity or collision; Codegraph
never chooses one silently.

Bounded helper forwarding is allowed through typed call summaries and caller-specific argument
binding. Dynamic selection may produce ambiguous, unknown, unsupported, or partial materialization.
The model never guesses. Runtime-only entities require an explicit runtime provider and remain
distinguishable from static entities.

## First-class semantic-pack CLI behavior

Installing and admitting the SDK semantic pack adds kinds and behavior to the existing CLI rather
than a parallel `cg sdk` namespace:

```sh
cg find astrale.sdk.workflow
cg find workflow                    # shortest unambiguous alias
cg show workflow:host.provision
cg trace path workflow:host.provision capability:host.manage
cg find action --writes object:Host
cg lint --rule 'astrale.sdk/*'
cg check sdk
cg impact --kind astrale.sdk.workflow
cg fix --rule astrale.sdk/object-mutation-authorized
```

Structured output retains canonical names even when input used aliases. Shell completion and help
are generated from the admitted registry. `cg status` reports pack identity, version,
configuration, compatibility, trust, requested materializations, and availability.

The word `capability` has two meanings. `astrale.sdk.capability` is a real domain entity. Internal
analysis capability availability is presented to ordinary users as an analysis feature or
materialization, avoiding selector ambiguity.

## Typed programmatic use

Semantic-pack types are inferred from the explicit descriptor rather than global interface
augmentation or raw fact casts:

```ts
import { createWorkspace } from '@astrale-os/codegraph'
import { sdkSemantics } from '@astrale-os/codegraph-sdk'

await using workspace = await createWorkspace({
  root,
  semanticPacks: [sdkSemantics],
})

await using snapshot = await workspace.snapshot()
const sdk = snapshot.reader(sdkSemantics)

const workflow = await sdk.show(
  sdkSemantics.entities.workflow,
  'host.provision',
)

for await (const action of sdk.find(
  sdkSemantics.entities.action,
  { requires: 'host.manage' },
)) {
  // action is fully typed.
}
```

Ergonomic overloads may be added without changing the registered roles or result semantics. V1
consumers must not need:

- `Fact<unknown>` casts;
- private namespace strings;
- storage queries;
- compiler handles;
- native protocol imports;
- pass-runner imports; or
- Codegraph-internal module paths.

## Materialization lifecycle and incrementality

Every materialized partition records:

- semantic model, schema, pack, provider, and configuration identities;
- source inventory and upstream fact revisions;
- selected input fact identities;
- emitted entity and relation identities;
- retained, replaced, added, changed, and removed outputs;
- invalidation reason and effective plan identity;
- completeness, limits, counts, timings, truncation, and failure state.

Semantic models declare source, function, symbol, module, project, or repository partitions. On a
change, Codegraph recomputes only the sound dependent closure, retains unaffected partitions
without reload or rewrite, replaces the changed partition's owned output set, removes orphans, and
publishes atomically. Extension, schema, provider, and semantic configuration changes participate
in invalidation and snapshot identity.

A changed or deleted `defineWorkflow` call therefore changes or removes its workflow and owned
relations automatically. A private action-body edit does not rebuild unrelated workflows unless a
declared model dependency requires it. Every incremental semantic result must equal a cold rebuild
after normalizing non-semantic commit metadata.

## Demand-driven capability plan

Example work plans:

```text
format
  → repository file selection only

find text
  → direct filesystem search only

show file --raw
  → verified source read only

find symbol
  → project + symbol projection

find astrale.sdk.workflow
  → SDK anchors + selected calls + workflow model

trace value astrale.sdk.action:...
  → owning function body + CFG + def-use + bounded values

check sdk
  → SDK models + configured SDK rules

test --since <ref>
  → change set + required dependency/call/reference projections + test selection
```

The planner executes a deterministic dependency closure. Unrequested projectors do no semantic
work. Ordinary pages do not request total counts unless explicitly asked. Whole-generation export
is an explicit analytical operation, never an implementation shortcut for ordinary CLI commands.

## Trust and extension admission

There are separate trust tiers:

1. trusted compiler-near providers may access live compiler facilities and emit portable facts;
2. trusted installed semantic packs execute against bounded public readers and emitters;
3. repository configuration is untrusted declarative data; and
4. analyzed source is untrusted input and is never imported or executed by analysis.

The invoking host installs and allowlists executable providers and semantic packs. Repository
configuration may request an allowed pack by semantic identity and provide schema-validated
configuration. It cannot name a local executable module or escalate a pack's trust tier.

Before publication, Codegraph validates versions, compatibility, definitions, dependencies,
cycles, producer uniqueness, declared reads and writes, typed output, cardinality, memory/buffer,
timeout, cancellation, and snapshot base. Optional-pack failure produces explicit unavailable
materialization. Mandatory failure aborts the requested publication. The prior immutable snapshot
remains isolated.

## Repository and test scope

Repository inventory retains implementation, tests, test support, fixtures, generated files,
evidence, assets, and unknown files unless an explicit scope excludes them. Purpose and provenance
are filters, not destructive ingestion decisions.

TypeScript semantic membership follows explicit project configuration. Tests included by a
`tsconfig` remain observable and may participate in cross-purpose relationships. Implementation-
only rules filter by repository purpose or a production project without deleting underlying test
evidence.

## Provider boundary

| Journey | Codegraph owns | Provider owns |
| --- | --- | --- |
| TypeScript analysis | project/snapshot composition, portable facts, identity, queries | `ttsc` compiler semantics and incremental program |
| lint | normalized findings, semantic rules, suppressions, evidence | Oxlint rule execution for its rule set |
| format | scope, configuration, orchestration, result | Oxfmt formatting |
| test | stable identities, semantic selection, reasons, normalized runs | Vitest execution |
| Git | exact snapshot binding, semantic diff/check/impact | Git repository and transition mechanics |
| viewer | typed result projection and source revision binding | browser rendering |

Providers never become semantic authorities for concepts owned by Codegraph or a semantic pack.
Conversely, Codegraph does not copy provider-specific mechanics merely to claim ownership.

## Configuration

V1 configuration is declarative and schema-versioned. It may describe:

```text
projects and references
repository include/exclude/purpose/provenance scopes
provider selection and non-secret options
trusted semantic-pack requests and validated pack configuration
rule enablement, severity, suppressions, and baselines
named check profiles
format scope
test projects and execution profiles
Git precommit, prepush, and merge check profiles
limits and explicitly measured budgets
```

Effective configuration, origins, pack/provider versions, and plan identity are attributable in
results. Secrets are obtained through explicit host facilities and are never serialized into
snapshots or ordinary output.

## Acceptance criteria

The public V1 is complete only when:

1. every stable command and option in this PRD is implemented or explicitly removed through an
   approved PRD revision;
2. no `spec` command or stable `.spec`/TypeSpec product API remains advertised by Codegraph;
3. `show`, `find`, and `trace` cover exact lookup, streaming raw text search, typed semantic
   selection, paths, and causal explanation without whole-graph hydration;
4. raw file read and text search retain practical startup, streaming, ignore, glob, regex, line,
   and machine-output behavior suitable for agent workflows;
5. human and machine projections are contract-equivalent;
6. Oxlint, Oxfmt, Vitest, `ttsc`, and Git providers are integrated without leaking provider
   internals into semantic results;
7. `check`, `lint`, `fix`, `format`, `test`, `impact`, `status`, and guarded Git journeys have
   coherent exit, cancellation, failure, stale, and completeness behavior;
8. a separately compiled SDK semantic pack defines Capability, Object, Workflow, Action, typed
   relations, models, rules, a check, and an optional repair using only public Codegraph exports;
9. SDK anchors resolve through aliases and barrels, reject same-spelled non-SDK functions, bind
   arguments to parameters, follow bounded helper forwarding without conflating callers, and
   retain explicit value states;
10. SDK entities participate natively in `show`, `find`, `trace`, `lint`, `check`, `fix`, and
    `impact` without a `cg sdk` namespace or core special case;
11. module relations preserve occurrence-level runtime, type-only, dynamic, and repeated edges;
    their deduplicated projections support paths, cycles, SCC, condensation, layers, and an
    independently registered `architecture` check with exact evidence paths;
12. an installed reference semantic pack can model documents, headings, anchors, links, code, and
    references to documents, modules, and TypeScript symbols; resolved, ambiguous, unresolved, and
    invalid states plus edit, heading rename, file rename, and deletion refresh through the same
    public extension boundary;
13. first-party and third-party packs pass identical registration, planning, admission,
    invalidation, query, and failure tests;
14. cold and every incremental sequence are semantically equal, and memory and durable reopen are
    semantically equal;
15. no ordinary consumer imports raw facts, storage, native protocol, compiler handles, pass
    scheduling, physical codecs, or private namespaces;
16. source edits are exact-revision-bound and stale application fails atomically;
17. repository configuration cannot execute or auto-load untrusted repository code;
18. Codegraph self-analysis and Kernel dogfood inspect module graphs, findings, references, impact,
    invalidation, completeness, and suspicious output; and
19. the older TypeSpec/.spec authority is reconciled through explicit governance rather than left
    as a contradictory second public product.

## Deferred work

V1 deliberately defers:

- a separate `predict` namespace until prediction extends beyond change impact;
- intent-driven refactoring beyond diagnostic repairs;
- generalized scenario simulation;
- a large textual graph query language;
- automatic executable extension installation from repository configuration;
- general build, deploy, release, and package-manager orchestration;
- Git operations that add no Codegraph semantic value;
- permanent public index, cache, daemon, plugin, or storage administration APIs;
- unrestricted runtime tracing without an explicit provider; and
- cross-language compiler providers beyond the extension seams required to make them possible.

## Why the vocabulary is exhaustive and irreducible

The ordinary surface maps to distinct consumer intents and result authorities:

| Intent | Command | Result |
| --- | --- | --- |
| evaluate one rule system | `lint` | findings |
| coordinate quality gates | `check` | check result referencing underlying evaluations and runs |
| repair a diagnosed cause | `fix` | revision-pinned edit plan and application result |
| normalize text | `format` | format result |
| execute behavior | `test` | test selection and run result |
| read one known thing | `show` | typed entity or source projection |
| select matching things | `find` | bounded result set or stream |
| explain relationships | `trace` | causal path or relational proof |
| forecast a change | `impact` | separated explanatory consequences |
| inspect the control plane | `status` | operational state, never semantic health |
| perform governed SCM transitions | `git` | exact Git operation bound to Codegraph evidence |

Some taxonomy is necessarily human rather than mathematically unique. A top-level command is
justified only when it has a distinct result contract, authority, safety model, and capability
plan. Modes such as watch, scopes such as changes, presentations such as the viewer, providers,
and physical mechanisms therefore remain options or internal composition rather than namespaces.
