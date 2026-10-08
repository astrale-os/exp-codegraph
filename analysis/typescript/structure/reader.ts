import { combineCompleteness, type Completeness, type SourceSpan } from '../../facts/index.ts'
import type { FactId, SymbolId } from '../../identity/index.ts'
import type { TypeScriptFact } from '../facts/index.ts'
import { structuralKey as key, type StructuralIndex, type StructuralRevision, type DependencyEntry } from './owner.ts'
import type { TypeScriptDependent, TypeScriptFileDependency, TypeScriptReference, TypeScriptReferenceQuery,
  TypeScriptStructuralReader, TypeScriptStructuralInventory, TypeScriptExport, TypeScriptSourcePosition,
  TypeScriptReferenceInventory, TypeScriptSymbolSite, TypeScriptLocatedSymbol, TypeScriptReferenceTarget } from './model.ts'

interface Scope {
  readonly signal?: AbortSignal
  check(): void
  selection(revision: StructuralRevision, keys: readonly string[]): void
}
const complete: Completeness = { kind: 'complete' }
const unavailableSource = (path: string): Completeness => ({ kind: 'unavailable', reasons: [{ code: 'STRUCTURAL_SOURCE_UNAVAILABLE',
  message: `The loaded non-declaration source inventory does not contain ${path}.`, retryable: true }] })

/** Project and computation readers use the same selections and negative-read witnesses. */
export function createTypeScriptStructuralReader(load: () => Promise<StructuralIndex>, scope?: Scope): TypeScriptStructuralReader & { dispose(): void } {
  let activeLoad: (() => Promise<StructuralIndex>) | undefined = load
  const check = (signal?: AbortSignal) => {
    if (!activeLoad) throw new Error('Structural reader is disposed or its computation has expired.')
    scope?.check(); scope?.signal?.throwIfAborted(); signal?.throwIfAborted()
  }
  const begin = async (signal?: AbortSignal) => { check(signal); const index = await activeLoad!(); check(signal); return index }
  const selected = (index: StructuralIndex, paths?: readonly string[]) => [...new Set(paths ?? index.files.keys())].sort()
  const track = (index: StructuralIndex, keys: readonly string[]) => { check(); scope?.selection(index.revision, [key.capability, ...keys]) }
  const inventory = (index: StructuralIndex, paths: readonly string[], kind: 'exports' | 'references' | 'dependencies', evidence: Iterable<FactId>,
    extra: Completeness = complete): TypeScriptStructuralInventory => {
    let completeness = combineCompleteness(index.capability, extra)
    for (const path of paths) {
      const file = index.files.get(path)
      if (file) completeness = combineCompleteness(completeness, file.payload.completeness[kind])
      else completeness = combineCompleteness(completeness, unavailableSource(path))
    }
    return { completeness, scope: { paths, declarationFiles: false, externalSources: false }, evidence: [...new Set(evidence)].sort() }
  }
  const pathKeys = (kind: 'exports' | 'references' | 'dependencies', paths?: readonly string[]) => paths
    ? paths.flatMap((path) => [key.path(path), key.coverage(kind, path)])
    : [key.paths, key.coverage(kind)]
  const exportsFor = (file: TypeScriptFact<'structure'> | undefined): readonly TypeScriptExport[] => {
    if (!file) return []
    const symbols = new Map(file.payload.symbols.map((symbol) => [symbol.symbol, symbol]))
    return file.payload.exports.map((entry) => ({ ...symbols.get(entry.symbol)!, ...entry }))
  }
  const span = (file: TypeScriptFact<'structure'>, start: number, end: number): SourceSpan => ({
    source: file.payload.source, revision: file.payload.revision, start, end,
  })
  const dependency = ({ file, dependency }: DependencyEntry): TypeScriptFileDependency => ({
    path: file.payload.logicalPath, span: span(file, dependency.start, dependency.end), kind: dependency.kind, typeOnly: dependency.typeOnly,
    ...(dependency.specifier === undefined ? {} : { specifier: dependency.specifier }),
    ...(dependency.targetPath === undefined ? {} : { targetPath: dependency.targetPath }),
  })
  const validatePosition = (position: TypeScriptSourcePosition) => {
    if (!Number.isSafeInteger(position.offset) || position.offset < 0) throw new TypeError('Source offset must be a non-negative safe integer in UTF-16 code units.')
  }
  const position = (index: StructuralIndex, target: TypeScriptSourcePosition, keys: string[], evidence: Set<FactId>) => {
    const file = index.files.get(target.path), symbols = new Set<SymbolId>(), sites: TypeScriptSymbolSite[] = []
    keys.push(key.file(target.path), key.path(target.path), key.coverage('references', target.path))
    let extra: Completeness = file?.payload.completeness.references ?? unavailableSource(target.path)
    let resolution: TypeScriptReferenceInventory['target'] = { kind: 'unavailable' }
    if (!file) return { file, symbols, sites, extra, resolution }
    evidence.add(file.id)
    if (target.revision !== undefined && target.revision !== file.payload.revision) {
      extra = { kind: 'unavailable', reasons: [{ code: 'STRUCTURAL_SOURCE_STALE',
        message: `The cursor revision for ${target.path} differs from this snapshot.`, retryable: true }] }
      resolution = { kind: 'stale', expectedRevision: target.revision, actualRevision: file.payload.revision }
      return { file, symbols, sites, extra, resolution }
    }
    // Native rows are AST preorder, not sorted by source offset. A local scan
    // preserves nested token semantics without another parser or interval cache.
    let width = Infinity
    for (const reference of file.payload.references) {
      if (reference.start > target.offset || reference.end <= target.offset) continue
      const nextWidth = reference.end - reference.start
      if (nextWidth > width) continue
      if (nextWidth < width) { width = nextWidth; sites.length = 0; symbols.clear() }
      sites.push({ path: target.path, span: span(file, reference.start, reference.end), kind: reference.kind,
        ...(reference.symbol === undefined ? {} : { symbol: reference.symbol }),
        ...(reference.binding === undefined ? {} : { binding: reference.binding }) })
      if (reference.symbol) symbols.add(reference.symbol)
    }
    resolution = sites.length
      ? sites.every((site) => site.symbol !== undefined) ? { kind: 'resolved', symbols: [...symbols].sort() } : { kind: 'unavailable' }
      : { kind: combineCompleteness(index.capability, extra).kind === 'complete' ? 'missing' : 'unavailable' }
    if (symbols.size > 1) extra = combineCompleteness(extra, { kind: 'partial', reasons: [{
      code: 'STRUCTURAL_SYMBOL_SITE_AMBIGUOUS', message: 'Several canonical symbols share the selected source site.', effective: { offset: target.offset },
    }] })
    return { file, symbols, sites, extra, resolution }
  }
  const selectTarget = (index: StructuralIndex, target: TypeScriptReferenceTarget, keys: string[], evidence: Set<FactId>) => {
    if ('offset' in target) return position(index, target, keys, evidence)
    const symbols = new Set<SymbolId>()
    let extra: Completeness = complete, resolution: TypeScriptReferenceInventory['target'] = { kind: 'resolved', symbols: [] }
    if ('path' in target) {
      const file = index.files.get(target.path)
      keys.push(key.file(target.path), key.path(target.path), key.coverage('exports', target.path))
      if (file) {
        extra = file.payload.completeness.exports; evidence.add(file.id)
        for (const exported of file.payload.exports) if (exported.name === target.name) symbols.add(exported.symbol)
        if (!symbols.size) resolution = { kind: extra.kind === 'complete' ? 'missing' : 'unavailable' }
      } else { resolution = { kind: 'unavailable' }; extra = unavailableSource(target.path) }
    } else if ('symbol' in target) symbols.add(target.symbol)
    else {
      keys.push(key.origin)
      for (const file of index.files.values()) for (const symbol of file.payload.symbols) {
        const origin = symbol.origin
        if (origin && origin.package === target.origin.package && origin.file === target.origin.file
          && JSON.stringify(origin.path) === JSON.stringify(target.origin.path)) symbols.add(symbol.symbol)
      }
    }
    if (resolution.kind === 'resolved') resolution = { kind: 'resolved', symbols: [...symbols].sort() }
    return { symbols, extra, resolution }
  }
  return {
    dispose() { activeLoad = undefined; scope = undefined },
    async symbolAt(options) {
      const target = { path: options.path, offset: options.offset, revision: options.revision }
      validatePosition(target)
      const index = await begin(options.signal), keys: string[] = [], evidence = new Set<FactId>()
      const selected = position(index, target, keys, evidence), symbols: TypeScriptLocatedSymbol[] = []
      let extra = selected.extra
      for (const symbol of selected.file?.payload.symbols ?? []) if (selected.symbols.has(symbol.symbol)) {
        const declarations: TypeScriptLocatedSymbol['declarations'][number][] = []
        for (const declaration of symbol.declarations) {
          keys.push(key.source(declaration.source))
          const owner = index.sources.get(declaration.source)
          if (!owner || owner.payload.revision !== declaration.revision) {
            extra = combineCompleteness(extra, { kind: 'partial', reasons: [{ code: 'STRUCTURAL_DECLARATION_SOURCE_UNAVAILABLE',
              message: 'A declaration has no matching source revision in the loaded structural inventory.',
              effective: { source: declaration.source, revision: declaration.revision } }] })
            continue
          }
          evidence.add(owner.id)
          declarations.push({ path: owner.payload.logicalPath, span: declaration })
        }
        symbols.push({ ...symbol, declarations })
      }
      symbols.sort((a, b) => a.symbol.localeCompare(b.symbol))
      track(index, keys)
      const file = selected.file?.payload
      return { ...inventory(index, [target.path], 'references', evidence, extra), target: selected.resolution,
        sites: selected.sites, symbols, ...(file ? { source: { source: file.source, revision: file.revision,
          logicalPath: file.logicalPath, textDigest: file.textDigest } } : {}) }
    },
    async exports(options) {
      const path = options.path, index = await begin(options.signal), file = index.files.get(path)
      track(index, [key.file(path), key.path(path), key.coverage('exports', path)])
      const extra: Completeness = file ? complete : unavailableSource(path)
      return { ...inventory(index, [path], 'exports', file ? [file.id] : [], extra), exports: exportsFor(file) }
    },
    async references(options: TypeScriptReferenceQuery) {
      const target = structuredClone(options.target), requested = options.paths ? [...options.paths] : undefined
      if ('offset' in target) validatePosition(target)
      const includeDeclarations = options.includeDeclarations === true, index = await begin(options.signal), paths = selected(index, requested)
      const evidence = new Set<FactId>(), keys = pathKeys('references', requested)
      const { symbols, extra, resolution } = selectTarget(index, target, keys, evidence)
      const references: TypeScriptReference[] = []
      for (const symbol of symbols) {
        const posting = index.references.get(symbol)
        keys.push(...(requested ? paths.map((path) => key.references(symbol, path)) : [key.references(symbol)]))
        for (const path of paths) for (const entry of posting?.get(path) ?? []) {
          if (!includeDeclarations && entry.reference.kind === 'declaration') continue
          references.push({ symbol, kind: entry.reference.kind, path,
            span: span(entry.file, entry.reference.start, entry.reference.end),
            ...(entry.reference.binding === undefined ? {} : { binding: entry.reference.binding }) })
          evidence.add(entry.file.id)
        }
      }
      references.sort((a, b) => a.path.localeCompare(b.path) || a.span.start - b.span.start || a.span.end - b.span.end || a.symbol.localeCompare(b.symbol))
      track(index, keys)
      return { ...inventory(index, paths, 'references', evidence, extra), references,
        target: resolution }
    },
    async dependencies(options = {}) {
      const requested = options.paths ? [...options.paths] : undefined, index = await begin(options.signal), paths = selected(index, requested)
      const dependencies: TypeScriptFileDependency[] = [], evidence = new Set<FactId>()
      for (const path of paths) {
        const file = index.files.get(path)
        if (file) for (const edge of file.payload.dependencies) { dependencies.push(dependency({ file, dependency: edge })); evidence.add(file.id) }
      }
      dependencies.sort((a, b) => a.path.localeCompare(b.path) || a.span.start - b.span.start || a.span.end - b.span.end)
      track(index, [...pathKeys('dependencies', requested), ...paths.map(key.file)])
      return { ...inventory(index, paths, 'dependencies', evidence), dependencies }
    },
    async dependents(options) {
      const target = options.path, transitive = options.transitive === true, index = await begin(options.signal)
      const routes = new Map<string, readonly TypeScriptFileDependency[]>(), visited = new Set([target]), queue = [target]
      const evidence = new Set<FactId>(), keys = [key.paths, key.coverage('dependencies')]
      for (let offset = 0; offset < queue.length; offset++) {
        const path = queue[offset]!
        check(options.signal); keys.push(key.incoming(path))
        const entries = [...index.incoming.get(path)?.values() ?? []].flat().sort((a, b) =>
          a.file.payload.logicalPath.localeCompare(b.file.payload.logicalPath) || a.dependency.start - b.dependency.start)
        for (const entry of entries) {
          const owner = entry.file.payload.logicalPath
          if (visited.has(owner)) continue
          visited.add(owner); evidence.add(entry.file.id)
          routes.set(owner, [dependency(entry), ...routes.get(path) ?? []])
          if (transitive) queue.push(owner)
        }
      }
      const dependents: TypeScriptDependent[] = [...routes].sort(([a], [b]) => a.localeCompare(b)).map(([path, via]) => ({ path, via }))
      track(index, keys)
      return { ...inventory(index, selected(index), 'dependencies', evidence), dependents }
    },
  }
}
