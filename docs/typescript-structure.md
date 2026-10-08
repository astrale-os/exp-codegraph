# Structural inspection

Find authored uses of an exported API and inspect file dependencies in an existing TypeScript project. No `.spec/`, module descriptors or function-body extraction is required.

```ts
import { openTypeScriptProject } from '@astrale-os/codegraph/analysis/typescript'

await using project = await openTypeScriptProject({
  root: '.', capabilities: ['typescript.source', 'typescript.structure'],
})
await project.refresh()
await using code = await project.open()
const structure = await code.structure()

const exports = await structure.exports({ path: 'src/api.ts' })
const uses = await structure.references({
  target: { path: 'src/api.ts', name: 'route' },
})
const imports = await structure.dependencies({ paths: ['src/routes.ts'] })
const affected = await structure.dependents({ path: 'src/api.ts', transitive: true })
```

The export selector is resolved again in each snapshot, so a barrel can change its target without changing the consumer's query. Import aliases, explicit re-export aliases, namespace properties, shorthand properties and type references resolve to canonical compiler symbols.

## Read the result

```text
exports:      exports[]     + completeness + scope + evidence
references:   references[]  + target       + completeness + scope + evidence
dependencies: dependencies[]              + completeness + scope + evidence
dependents:   dependents[]                 + completeness + scope + evidence

reference: symbol · kind · binding? · path · span
dependency: path · span · kind · typeOnly · specifier? · targetPath?
dependent: path · via[] (one deterministic shortest observed dependency route)
span: source · revision · start · end (UTF-16 offsets)
target: resolved { symbols[] } · missing · unavailable
completeness: complete · partial { reasons[] } · unavailable { reasons[] }
scope: paths[] · declarationFiles: false · externalSources: false
```

`evidence` contains contributing compiler fact IDs, including the file used to resolve an export selector. `completeness` certifies coverage for the selected scope; the evidence array is not an exhaustive archive of every file checked. A complete empty query establishes no matching authored uses in that scope. An incomplete empty query does not establish absence. For an export selector, `target: missing` distinguishes an absent export from an unused export.

A selected path outside the loaded source inventory reports `unavailable`, even if its result is empty. A loaded file with no matching uses can report `complete`. Both selections are tracked, so creating a previously missing source can invalidate a cached answer.

Dependency inventories preserve unresolved literal requests and computed requests. A literal request has a `specifier`, even when it is `''`; a computed request has no known specifier. Missing resolution, computed imports, compiler recovery and unregistered external coordinates carry explicit reasons instead of fabricated targets.

## Track a query across edits

```ts
import type { TypeScriptSemanticReader } from '@astrale-os/codegraph/analysis/typescript'

async function inspect(read: TypeScriptSemanticReader, input: { path: string; name: string }) {
  return (await read.structure()).references({ target: input, paths: ['src/routes.ts'] })
}

const before = await code.compute(inspect, { path: 'src/api.ts', name: 'route' })
await project.refresh({ changed: ['src/unrelated.ts'] })
await using current = await project.open()
const after = await current.compute(inspect, { path: 'src/api.ts', name: 'route' })
```

Keep the callback stable and put variable parameters in `input`. Reads record selections, including missing exports, absent files and empty postings. Unrelated edits can reuse the result; changes to its symbols, locations or coverage re-execute it. Structural-only computations do not load the value/body index. Structural and value reports share the existing bounded result-cache budget.

Earlier snapshots stay pinned. Dispose snapshots when finished; the project retains the current structural graph and explicitly pinned readers. Callback readers expire when the computation settles. [Project lifetime and computation contract](../analysis/typescript/project/model.ts).

## Scope and interpretation

- The inventory includes loaded project-owned non-declaration sources. It does not enumerate local `.d.ts`, dependency source files, excluded files or every repository project.
- References are authored symbolic tokens, not runtime calls or value-flow uses. Original declaration names are omitted unless `includeDeclarations: true`.
- `export *` contributes a resolved export table and a file dependency. It does not invent a reference token for each implicit export.
- External package declarations can supply a portable `origin` for target selection. Loose external files without registered ownership stay uncertain; their potentially ambiguous identities are omitted.
- Transitive dependents follow observed module-request edges. This is a structural change-impact candidate set, not proof that each file's runtime behavior changes.

## Full method surface

```text
snapshot.structure() · read.structure()
structure.exports({ path, signal? })
structure.references({ target, paths?, includeDeclarations?, signal? })
structure.dependencies({ paths?, signal? })
structure.dependents({ path, transitive?, signal? })
target: { path, name } · { symbol } · { origin: { package, file, path } }
```

[Exact types](../analysis/typescript/structure/model.ts) · [Qualification consumer and independent oracle](../qualification/v2/structural/README.md) · [All exports](public-api.md).
