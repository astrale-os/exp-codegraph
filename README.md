# Codegraph

**Inspect TypeScript projects. Verify module contracts.**

[Inspect a project](#inspect-a-project) · [Explore the API](#explore-the-api) · [Module contracts](#verify-module-contracts)

## Inspect a project

Use an existing `tsconfig.json`. No `.spec/` required. [Install the qualified package](docs/github-artifacts.md#install-in-an-existing-project).

```ts
import { openTypeScriptProject } from '@astrale-os/codegraph/analysis/typescript'

await using project = await openTypeScriptProject({ root: '.' })
await project.refresh()
await using code = await project.open()

const calls = await code.calls({ paths: ['src/routes.ts'] })
console.log({
  completeness: calls.completeness,
  calls: calls.sites.map(({ path, occurrence, call }) => ({
    path,
    span: occurrence.span,
    origin: call.targetOrigin,
    arguments: call.arguments,
    dynamic: call.dynamic,
  })),
})
```

Calls include unresolved sites. Coverage is `complete`, `partial` or `unavailable`.

### Follow values through helpers and closures

For a project using a library such as `@acme/http`:

```ts
// src/routes.ts
import { route } from '@acme/http'

const health = (status: number) => ({
  path: '/health',
  handler: () => ({ status }),
})

route(health(200))
```

Continue with the same snapshot:

```ts
import { mapValueResult } from '@astrale-os/codegraph/analysis/typescript'

const values = await code.values()
for (const { call } of calls.sites) {
  if (call.targetOrigin?.package !== '@acme/http'
    || call.targetOrigin.path.join('.') !== 'route') continue
  const argument = call.arguments[0]
  if (argument === undefined) continue

  const status = await values.value(argument)
    .property('handler').invoke().property('status').resolve()
  console.log(mapValueResult(status, value =>
    value.kind === 'literal' ? value.value : null))
  // { kind: 'known', value: 200, evidence: [...] }
}
```

Values retain `known`, `unknown`, `ambiguous` and `unsupported` outcomes and their evidence. An unknown value or incomplete empty inventory does not establish absence. Authored JavaScript is analyzed without executing it. [Library rules also establish callee identity](docs/typescript-values.md#model-a-library-boundary); declaration origins select calls to inspect.

### Keep the project open across edits

```ts
// After the file watcher reports an edit:
const update = await project.refresh({ changed: ['src/routes.ts'] })
await using current = await project.open()
console.log(update.durationMs, await current.calls({ paths: ['src/routes.ts'] }))

// Or let the compiler discover source, config and resolution changes:
await project.refresh({ discover: true })
```

Open a new snapshot after refreshing. Earlier readers stay pinned to their version. After the initial load, bare `refresh()` does not scan the filesystem.

<details>
<summary>Reuse a semantic computation across edits</summary>

Keep the callback stable; pass variable parameters through `input`.

```ts
import type { TypeScriptSemanticReader } from '@astrale-os/codegraph/analysis/typescript'

async function inspectCalls(read: TypeScriptSemanticReader, input: { paths: string[] }) {
  const calls = await read.calls({ paths: input.paths })
  return {
    completeness: calls.completeness,
    calls: calls.sites.map(({ path, occurrence, call }) => ({
      path, span: occurrence.span, origin: call.targetOrigin, dynamic: call.dynamic,
    })),
  }
}

const report = await current.compute(inspectCalls, { paths: ['src/routes.ts'] })
```

Reports can be reused when their observed inputs still hold, including across unrelated edits. Return plain data; callback readers and value plans expire when it settles. [Values, budgets and reuse](docs/typescript-values.md#reuse-a-semantic-computation).

</details>

<details>
<summary>Values, library models and evaluation budgets</summary>

```text
snapshot.values({ call, limits })
values.value(occurrence).property(name).invoke().resolve({ limits, signal })
values.evaluate(occurrence, { signal? })
values.canReuse(proof)
mapValueResult(result, project, { equals })

limits: maximumDepth · maximumSteps · maximumAlternatives
results: known · unknown · ambiguous · unsupported

call(context)
context.callee() · context.receiver() · context.argument(index)
context.propertyName
operand.property(name) · operand.invoke() · operand.resolve()
model result: atom · unknown · transferred operand · undefined (ordinary evaluation)
```

Models can describe a library boundary while preserving bindings, closures and proof dependencies. Model operands resolve synchronously within the active call. [Complete guide](docs/typescript-values.md#model-a-library-boundary) · [Interfaces](analysis/typescript/value/model.ts).

</details>

<details>
<summary>Facts, types, dependencies and control flow</summary>

```text
snapshot.facts.facts(kind, filter?, page?)
snapshot.facts.factsById(kind, ids)
snapshot.facts.export(kind, filter?)
snapshot.facts.exportAll(filter?)

fact kinds: project · diagnostic · source · symbol · occurrence · body
            body-demand · module · declaration

body: occurrences · relations · blocks · edges · definitions · calls · summary
call: target · targetOrigin · signature · receiver · typeArguments
      arguments · bindings · callbacks · dynamic
```

Source, symbol, occurrence and body capabilities are enabled by default. Other facts need explicit capabilities. Module surfaces, dependencies and types also need module boundary descriptors; a `tsconfig.json` alone does not declare those boundaries.

[Project options](analysis/typescript/project/model.ts) · [Fact readers and payloads](analysis/typescript/facts/model.ts) · [Calls and body IR](analysis/typescript/body/types.ts) · [Module descriptors](analysis/protocol/model.ts).

</details>

<details>
<summary>Storage, repository tools and custom analysis</summary>

```text
@astrale-os/codegraph/analysis
createMemoryAnalysisStore · selectAnalysisStore
planPasses · runPortablePasses · runAnalysisPolicies
createNodeSourceTextReader · readVerifiedSourceText
createProcessNativeAnalysisSessionFactory

@astrale-os/codegraph/analysis/sqlite
createSQLiteAnalysisStore

@astrale-os/codegraph/repository
createNodeRepositoryScanner · inventoryRepository · repositoryFacts
analyzeRepositoryStatistics · refreshRepositoryStatistics
createRepositoryPathOwnershipGrouping · createRepositorySourceService

@astrale-os/codegraph/analysis/native
openNativeDecisionSession · resolvePackagedNativeAnalysis · resolvePackagedNativeOxlint
```

Use memory by default; supply a caller-owned store for custom retention or persistence. Repository tools inventory, classify, group and measure files. Native decision sessions support specialized tool integrations. [All exports, including types](docs/public-api.md).

</details>

## Explore the API

Import the entrypoint for the task. The root package exposes the module-contract application service.

| Task | `@astrale-os/codegraph` entrypoint |
| --- | --- |
| Inspect TypeScript, resolve values, reuse observations | `/analysis/typescript` |
| Compose passes and policies; store/query facts | `/analysis` |
| Persist facts in SQLite | `/analysis/sqlite` |
| Integrate native decision sessions | `/analysis/native` |
| Inventory repositories, measure source, read evidence | `/repository` |
| Author capabilities, laws, states and other contracts | `/authoring` |
| Compile specifications and derive capability status | `/specification` |
| Compose contract conformance profiles | `/conformance` |
| Validate schemas and data | `/schema` |
| Refresh and inspect a module-contract application | root |
| Persist workspace checkpoints | `/workspace` |

[Complete export inventory](docs/public-api.md) — every function, class, constant and type, with links to exact interfaces.

## Verify module contracts

Optional and independent of the inspection workflow. Conformance connects authored contracts to implementation analysis.

```sh
cg init modules/payments
```

```ts
// modules/payments/.spec/api.d.ts
export interface Payment { id: string; amount: number }
export declare function charge(amount: number): Promise<Payment>
```

```sh
cg check .                      # Validate contracts and composition
cg verify . --require-pass      # Once the implementation is bound to its contract
cg dev . --open                 # Browse contracts, source and diagnostics
```

`cg check` checks specification validity; `cg verify` checks implementation conformance. Contracts may exist before implementation. [Contract reference](docs/module-contracts.md).

<details>
<summary>Bind an existing implementation to its contract</summary>

Export contract-owned types and implement the declared API:

```ts
// modules/payments/index.ts
import type { Payment } from './.spec/api.js'
export type { Payment } from './.spec/api.js'

export async function charge(amount: number): Promise<Payment> {
  return { id: 'receipt', amount }
}
```

```ts
// modules/payments/implementation.contract.ts
import type * as contract from './.spec/api.js'
import * as implementation from './index.js'
implementation satisfies typeof contract
```

Keep both files in the owning TypeScript project. `verify` also checks the public surface in both directions; the `satisfies` check alone is not conformance. [Implementation discovery and binding](docs/module-contracts.md#implementation-conformance).

</details>

<details>
<summary>Daily CLI: selection, changed modules, evidence and live verification</summary>

```sh
cg --version
cg check . --select modules/payments --exclude generated --format json
cg check . --require-complete-layout --require-exact-layout --require-law-evidence
cg changed . origin/main
cg changed . origin/main --scope-only
cg test modules/payments --root .
cg test changed origin/main --root .
cg verify . --select modules/payments --schema-root schemas --require-pass --details
cg dev . --port 5173 --open --verify
```

`changed` is an advisory targeted check; use a full `check` as the global gate. `test` runs attached evidence through the project's `test:file` script. `--quiet` is available on check/changed/test/verify; `--no-cache` on check/changed/test/dev.

[Exact commands and gate semantics](docs/module-contracts.md#commands).

</details>

<details>
<summary>Add contract dimensions only as needed</summary>

```text
.spec/
  api.d.ts              public contract
  code.ts               shared private entrypoints
  internal.d.ts         internal vocabulary
  ports/**/*.d.ts        required provider interfaces
  capabilities/**/*.ts  independently meaningful abilities
  laws/**/*.ts          falsifiable semantic truths
  states/**/*.ts        lifecycle transitions
  flows/**/*.ts         semantic orchestration
  schemas/*.schema.json portable value representations
  layout.ts             physical paths and observation policy
  limits.ts             measured budgets
  packages/*.ts         reasons for external dependencies
  examples/**/*.ts      canonical public-API usage
  benchmarks/**/*.ts    workloads and metrics
  architecture.md       rationale and diagrams
  icon.svg              visual identity
```

```text
defineCapability · defineLaw · defineState
transition · statesOf · eventsOf · transitionsOf · illegalTransitionsOf
defineCode · defineLayout · definePackage · definePackagePattern · defineBenchmark
```

[Authoring API](docs/public-api.md#astrale-oscodegraphauthoring) · [Ownership, grammar and examples](docs/module-contracts.md). Tests live outside `.spec/`; `.history/` holds explanatory, non-normative context.

</details>

<details>
<summary>Build a contract application, compose profiles and persist checkpoints</summary>

```text
createTypeSpecApplicationService(options)
service.refresh(options?) · service.current() · service.open(snapshot?)
service.settle() · service.dispose()
reader.query(universe) · reader.source(request) · reader.dispose()

compileSpecificationSnapshot · qualifySpecification · planConformance
createTypeSpecConformanceProfiles · createModuleConformanceProfiles
loadSchema · validateData · validateSchemaFile · validateModuleSchemaCatalog
createFileWorkspaceCheckpointStore
encodeWorkspaceCheckpointJson · decodeWorkspaceCheckpointJson
```

[Application interfaces](application/model.ts) · [Complete API](docs/public-api.md).

</details>

Node 22 (≥22.13), 24 or 26. Native analysis: macOS/Linux x64 and arm64; Windows x64. [Installation and artifacts](docs/github-artifacts.md) · [Distribution](docs/npm-distribution.md).
