# Contextual TypeScript values

Use a pinned project's `snapshot.calls()` to discover call sites, then `snapshot.values()`
to inspect their values. Codegraph supplies source locations, callee relations, argument
occurrences and proof reuse. The consumer supplies its library semantics and decisions.

## Read call sites and values

For a file containing `route({ path: '/health', handler: () => ({ status: 200 }) })`,
the same public readers inspect both the callee and the configuration:

```ts
import { mapValueResult } from '@astrale-os/codegraph/analysis/typescript'

const inventory = await snapshot.calls({ paths: ['routes/health.ts'] })
const values = await snapshot.values()
const inspected = []
for (const site of inventory.sites) {
  const argument = site.call.arguments[0]
  inspected.push({
    path: site.path,
    callee: site.callee ? await values.value(site.callee).resolve() : undefined,
    options: argument === undefined ? undefined : {
      path: await values.value(argument).property('path').resolve(),
      literalStatus: mapValueResult(
        await values.value(argument).property('handler').invoke().property('status').resolve(),
        value => value.kind === 'literal' ? value.value : undefined,
      ),
    },
  })
}
const report = { completeness: inventory.completeness, inspected }
```

The inventory includes unresolved calls. `complete` describes call-site coverage; it does
not prove any callee identity or argument value. A partial or unavailable empty inventory
cannot establish absence. Likewise, a value proof that exhausts its budget remains
`unknown`, even when it has no observed candidates. Consumers must preserve that state
instead of dropping the call and returning a passing decision.

`mapValueResult` projects values while retaining uncertainty and evidence. Unknown
candidates remain unknown; exhaustive alternatives collapse only when their projections
are equivalent. The default comparison is `Object.is`; object projections need an explicit
`equals` comparator. The projection is not a new reusable evaluation receipt.

Path and source filters select the returned inventory. The current implementation shares
a project-wide fact index with value evaluation; these filters do not restrict native
extraction or guarantee that only selected source facts are loaded.

## Reuse a semantic computation

For repeated lint runs, put the semantic observation in a stable callback and pass every
variable parameter through `input`. `snapshot.compute()` tracks the callback's call
selections and value reads, including absent reads and already cached proofs.

```ts
import {
  mapValueResult,
  type BoundedValueLimits,
  type TypeScriptSemanticReader,
} from '@astrale-os/codegraph/analysis/typescript'

// Define once, outside the refresh/lint loop.
async function inspectRoutes(
  read: TypeScriptSemanticReader,
  input: { paths: readonly string[]; limits: BoundedValueLimits },
) {
  const inventory = await read.calls({ paths: input.paths })
  const values = await read.values({ limits: input.limits })
  const inspected = await Promise.all(inventory.sites.map(async site => {
    const argument = site.call.arguments[0]
    return {
      path: site.path,
      span: site.occurrence.span,
      status: argument === undefined ? undefined : mapValueResult(
        await values.value(argument).property('handler').invoke().property('status').resolve(),
        value => value.kind === 'literal' && typeof value.value === 'number' ? value.value : null,
      ),
    }
  }))
  return { completeness: inventory.completeness, inspected }
}

// After each refresh, use the same callback with the current snapshot.
await project.refresh()
await using current = await project.open()
const report = await current.compute(inspectRoutes, {
  paths: ['routes/health.ts'],
  limits: { maximumDepth: 32, maximumSteps: 10_000, maximumAlternatives: 16 },
})
```

This observes the handler shape; a rule must separately establish the callee's library
identity before deciding that a call declares a route. Missing arguments remain explicit,
and a proved nonnumeric value projects to `null`. `mapValueResult` preserves unknowns,
alternatives, unsupported results and evidence; the report also preserves inventory
completeness. Neither an incomplete empty selection nor an unknown status is a passing rule.
The projected report contains plain data rather than opaque evaluation receipts.

Codegraph reuses the report when its reads still hold, including across unrelated edits.
Relevant changes, newly available evidence or an unverified revision rerun the callback.
Each value resolution has its own limits; contextual operands share that enclosing proof's
budget. Computations and value proofs share the project's bounded cache. Plain inputs are
captured before yielding, and admitted results are owned, deeply frozen data. Nonportable
inputs/results or oversized results still execute normally without reuse.

Readers, evaluators and plans supplied to the callback expire when it settles. Keep source
text and mutable configuration out of its closure. Return source coordinates with semantic
observations, then render diagnostics against the source revision currently being linted;
if the editor has advanced, obtain a fresh snapshot before applying those diagnostics.

## Model a library boundary

`snapshot.values({ call })` lets a consumer model a library boundary while Codegraph
retains ordinary TypeScript bindings, closures, object properties and proof dependencies.
The model returns an application atom, an explicit unknown, a transferred operand, or
`undefined` to delegate to ordinary evaluation.

```ts
const values = await snapshot.values<{ readonly route: string }>({
  call(context) {
    const callee = context.callee().resolve()
    if (callee.kind !== 'known' || callee.value.kind !== 'external') return
    const origin = callee.value.symbolOrigin
    if (origin?.package !== '@acme/http' || origin.file !== 'index.d.ts') return
    if (origin.path.length !== 1) return

    // A consumer-provided model of this exact library's transparent wrapper.
    if (origin.path[0] === 'transparent') return context.argument(0)

    if (origin.path[0] === 'route') {
      const path = context.argument(0)?.property('path').resolve()
      return path?.kind === 'known' && path.value.kind === 'literal'
        && typeof path.value.value === 'string'
        ? { kind: 'atom', value: { route: path.value.value } }
        : { kind: 'unknown', reason: 'The route path is opaque.' }
    }
  },
})
```

`callee()`, `receiver()` and `argument(index)` return lazy operand plans. A missing
receiver or argument returns `undefined`. Each plan has `.property(name)`, `.invoke()`
and `.resolve()`. For example, a model can read
`context.argument(0)?.property('operations').property('deploy').invoke().resolve()`
even when a helper constructed the object and its method captures a helper argument.
The authored keys of shorthand properties and imported aliases remain distinct from
their canonical value symbols.

`context.propertyName` lazily reads the member named by the callee IR. It is distinct from
the resolved declaration's name or a renamed export. Its first read records the callee
dependency and consumes at most one proof step; repeated reads reuse that metadata. An
absent or unsupported member form leaves it `undefined`. The name alone proves neither
the receiver's identity nor a library boundary: establish the receiver with
`context.receiver()?.resolve()` before dispatching on its member name. Like operands,
this metadata can only be read during the synchronous model call.

Inside the synchronous call model, `.resolve()` is synchronous and shares the enclosing
proof's environment, depth, step allowance, cancellation and evidence. It accepts no
budget overrides. Constructing a plan does not evaluate it; repeated resolutions consume
the same allowance. A model cannot replace budget exhaustion with a known atom.

Returning an operand plan transfers the private symbolic value without reducing it to
the public object shape or function metadata. This preserves properties and closures
through modeled transparent wrappers. Only Codegraph-owned operands from the active
proof can be transferred. Operand resolution ends when its call model returns or throws;
retaining a plan does not create an independently usable proof.

Outside the model, `values.value(occurrence)` uses the same navigation operations, but
`.resolve({ limits, signal })` is asynchronous and starts an independent bounded proof.
The returned evidence includes positive and negative reads performed by the model.
An occurrence read outside a call model does not supply an arbitrary caller's argument
bindings; use the contextual operand inside the model when those bindings are needed.

## Reuse proofs automatically

Repeated resolutions reuse eligible immutable results automatically within the resident
project, including across snapshot refreshes when the model, plan, effective budget and
dependencies still match. Newly available helper bodies or properties invalidate prior
negative reads. The shared cache is bounded; mutable or opaque atoms that cannot be safely
retained bypass it without being frozen or cloned.

Consumers normally resolve the plan again and let Codegraph perform this validation.
`values.canReuse(proof)` remains available for advanced consumers that retain their own
evaluation receipts. It is not required to maintain a parallel downstream proof cache.
Model functions represent stable semantics; replace the model function when its captured
configuration changes. Different models and budgets do not share semantic conclusions.

These operators inspect supported synchronous value paths. They do not execute authored
JavaScript, await Promises, infer object-instance equality from a declaration or allocation
site, or automatically recognize arbitrary library wrappers such as `Object.freeze`.
Models must prove their library identity from values; a compatible static signature is
insufficient.
