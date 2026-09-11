import type { Completeness } from '../../../facts/index.ts'
import { combineCompleteness } from '../../../facts/index.ts'
import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery, TypeScriptCallSite } from '../../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../../facts/index.ts'
import type { ValueIndexRevision } from './facts.ts'
import { CALL_SELECTION, type CallSelection, callSelectionKeys, freezeCompleteness, inventoryCompleteness, reasonKey, unavailable } from './selection.ts'

interface CallIndex {
  readonly revision?: ValueIndexRevision
  readonly callsSelection?: CallSelection
  readonly bodies: ReadonlyMap<SymbolId, TypeScriptFact<'body'>>
  readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>
  readonly sources?: ReadonlyMap<SourceId, TypeScriptFact<'source'>>
  readonly callsBySource?: ReadonlyMap<SourceId, readonly OccurrenceId[]>
}

export type CallSelectionObserver = (revision: ValueIndexRevision | undefined, keys: readonly string[]) => void

export function createCallProjection(query: AnalysisQuery, loadIndex: () => Promise<CallIndex>) {
  let pending: Promise<{
    index: CallIndex
    paths: Pick<ReadonlyMap<SourceId, string>, 'get'>
    calls: ReadonlyMap<SourceId, readonly OccurrenceId[]>
    completion: Completeness
    bySource(): Iterable<readonly [SourceId, Completeness]>
    local(source: SourceId): Completeness | undefined
    selection?: CallSelection
  }> | undefined
  const sites = new Map<OccurrenceId, TypeScriptCallSite>()
  const project = async (options: TypeScriptCallQuery = {}, observe?: CallSelectionObserver): Promise<TypeScriptCallInventory> => {
    const signal = options.signal
    const paths = options.paths && new Set(options.paths)
    const sources = options.sources && new Set(options.sources)
    const keys = observe && callSelectionKeys({ ...(paths ? { paths: [...paths] } : {}), ...(sources ? { sources: [...sources] } : {}) })
    signal?.throwIfAborted()
    pending ??= (async () => {
      const index = await loadIndex()
      const selection = index.revision?.selection === CALL_SELECTION ? index.callsSelection : undefined
      if (selection && index.sources && index.callsBySource) return {
        index, paths: { get: (source: SourceId) => index.sources!.get(source)?.payload.logicalPath },
        calls: index.callsBySource, completion: selection.completion,
        bySource: () => selection.sources(), local: (source: SourceId) => selection.local(source), selection,
      }
      const reader = createTypeScriptFactReader(query)
      const capabilities = await query.capabilities()
      const sourceFacts = index.sources ? [...index.sources.values()] : await collect(reader.export('source'))
      const paths = new Map(sourceFacts.map((fact) => [fact.payload.source, fact.payload.logicalPath]))
      let calls: ReadonlyMap<SourceId, readonly OccurrenceId[]> = index.callsBySource ?? new Map()
      const bySource = new Map<SourceId, Completeness>()
      let completion: Completeness = { kind: 'complete' }
      const attributed = new Set([...index.bodies.values()].flatMap((fact) =>
        fact.completeness.kind === 'partial' ? fact.completeness.reasons.map(reasonKey) : []))
      for (const capability of ['typescript.body', 'typescript.source']) {
        const status = capabilities.find((entry) => entry.capability === capability)?.completeness
        const remaining = capability === 'typescript.body' && status?.kind === 'partial'
          ? status.reasons.filter((reason) => !attributed.has(reasonKey(reason))) : undefined
        completion = combineCompleteness(completion, remaining
          ? remaining.length ? { kind: 'partial', reasons: remaining } : { kind: 'complete' }
          : status ?? unavailable(`Required ${capability} capability is unavailable.`))
      }
      for (const fact of index.bodies.values()) {
        const source = fact.provenance.evidence[0]?.source
        const completeness = inventoryCompleteness(fact.completeness)
        if (source) bySource.set(source, combineCompleteness(bySource.get(source), completeness))
        else completion = combineCompleteness(completion, completeness)
      }
      if (!index.callsBySource) {
        const discovered = new Map<SourceId, OccurrenceId[]>()
        for (const call of index.calls.values()) {
          const occurrence = index.occurrences.get(call.occurrence)
          if (!occurrence) throw new Error(`Call ${call.occurrence} has no admitted occurrence.`)
          let values = discovered.get(occurrence.span.source)
          if (!values) discovered.set(occurrence.span.source, (values = []))
          values.push(call.occurrence)
        }
        calls = discovered
      }
      return { index, paths, calls, completion, bySource: () => bySource, local: (source: SourceId) => bySource.get(source) }
    })().catch((error) => { pending = undefined; throw error })
    const inventory = await pending
    signal?.throwIfAborted()
    observe?.(inventory.selection ? inventory.index.revision : undefined, keys!)
    let completeness = inventory.completion
    if (paths?.size === 0 || sources?.size === 0) return Object.freeze({ sites: Object.freeze([]), completeness: freezeCompleteness(completeness) })
    const result: TypeScriptCallSite[] = []
    const unresolvedSources = new Set<SourceId>()
    const selected = (source: SourceId) => {
      if (sources && !sources.has(source)) return false
      if (!paths) return true
      if (paths.size === 0) return false
      const path = inventory.paths.get(source)
      if (path === undefined) { if (!inventory.selection || sources) unresolvedSources.add(source); return false }
      return paths.has(path)
    }
    const completions = sources ? [...sources].map((source) => [source, inventory.local(source)] as const) : inventory.bySource()
    for (const [source, completion] of completions) {
      if (completion && completion.kind !== 'complete' && selected(source)) completeness = combineCompleteness(completeness, completion)
    }
    const groups = sources ? [...sources].map((source) => [source, inventory.calls.get(source)] as const) : inventory.calls
    for (const [source, calls] of groups) {
      if (!calls || !selected(source)) continue
      for (const id of new Set(calls)) {
        signal?.throwIfAborted()
        const call = inventory.index.calls.get(id)!
        let site = sites.get(call.occurrence)
        if (!site) {
          const occurrence = inventory.index.occurrences.get(call.occurrence)!
          if (occurrence.span.source !== source) continue
          const callee = inventory.index.children.get(call.occurrence)?.get('callee')
          const path = inventory.paths.get(source)
          site = Object.freeze({ call, occurrence, ...(callee ? { callee } : {}), ...(path !== undefined ? { path } : {}) })
          sites.set(call.occurrence, site)
        }
        if (site.occurrence.span.source !== source) continue
        if (!site.callee || site.path === undefined) completeness = combineCompleteness(completeness, {
          kind: 'partial', reasons: [{ code: 'CALL_SITE_RELATION_MISSING',
            message: 'A call site lacks its callee relation or logical source path.', effective: {} }],
        })
        result.push(site)
      }
    }
    const unresolved = inventory.selection && paths && !sources ? inventory.selection.unmapped : unresolvedSources.size
    if (unresolved) completeness = combineCompleteness(completeness, {
      kind: 'partial', reasons: [{ code: 'CALL_SOURCE_SELECTION_UNKNOWN',
        message: 'A source has no logical path, so its calls cannot be included or excluded by the requested path filter.',
        effective: { sources: unresolved } }],
    })
    result.sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '') ||
      left.occurrence.span.start - right.occurrence.span.start || left.call.occurrence.localeCompare(right.call.occurrence))
    return Object.freeze({ sites: Object.freeze(result), completeness: freezeCompleteness(completeness) })
  }
  return Object.assign(project, { dispose() { pending = undefined; sites.clear() } })
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const result: Value[] = []
  for await (const value of values) result.push(value)
  return result
}
