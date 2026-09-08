import type { AnalysisLimit, Completeness } from '../../../facts/index.ts'
import { combineCompleteness } from '../../../facts/index.ts'
import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery, TypeScriptCallSite } from '../../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../../facts/index.ts'

interface CallIndex {
  readonly bodies: ReadonlyMap<SymbolId, TypeScriptFact<'body'>>
  readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>
  readonly sources?: ReadonlyMap<SourceId, TypeScriptFact<'source'>>
}

// These limitations affect execution topology, while walkOwned still visits
// every call. Nested class/namespace scopes are deliberately NOT accepted.
const FLOW_ONLY = new Set([
  'CFG_EXPRESSION_BRANCH_PARTIAL', 'CFG_SWITCH_PARTIAL', 'CFG_TRY_PARTIAL',
  'CFG_LABEL_PARTIAL', 'CFG_UNRESOLVED_CONTINUE', 'CFG_UNRESOLVED_BREAK',
])

export function createCallProjection(query: AnalysisQuery, loadIndex: () => Promise<CallIndex>) {
  let pending: Promise<{
    index: CallIndex
    paths: ReadonlyMap<SourceId, string>
    calls: ReadonlyMap<SourceId, readonly ResolvedCall[]>
    completion: Completeness
    bySource: ReadonlyMap<SourceId, Completeness>
  }> | undefined
  const sites = new Map<OccurrenceId, TypeScriptCallSite>()
  const project = async (options: TypeScriptCallQuery = {}): Promise<TypeScriptCallInventory> => {
    const signal = options.signal
    const paths = options.paths && new Set(options.paths)
    const sources = options.sources && new Set(options.sources)
    signal?.throwIfAborted()
    pending ??= (async () => {
      const reader = createTypeScriptFactReader(query)
      const [index, capabilities] = await Promise.all([loadIndex(), query.capabilities()])
      const sourceFacts = index.sources ? [...index.sources.values()] : await collect(reader.export('source'))
      const paths = new Map(sourceFacts.map((fact) => [fact.payload.source, fact.payload.logicalPath]))
      const calls = new Map<SourceId, ResolvedCall[]>()
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
      for (const call of index.calls.values()) {
        const occurrence = index.occurrences.get(call.occurrence)
        if (!occurrence) throw new Error(`Call ${call.occurrence} has no admitted occurrence.`)
        let values = calls.get(occurrence.span.source)
        if (!values) calls.set(occurrence.span.source, (values = []))
        values.push(call)
      }
      return { index, paths, calls, completion, bySource }
    })().catch((error) => { pending = undefined; throw error })
    const inventory = await pending
    signal?.throwIfAborted()
    let completeness = inventory.completion
    const result: TypeScriptCallSite[] = []
    const unresolvedSources = new Set<SourceId>()
    const selected = (source: SourceId) => {
      if (sources && !sources.has(source)) return false
      if (!paths) return true
      if (paths.size === 0) return false
      const path = inventory.paths.get(source)
      if (path === undefined) { unresolvedSources.add(source); return false }
      return paths.has(path)
    }
    for (const [source, completion] of inventory.bySource) {
      if (completion.kind !== 'complete' && selected(source)) completeness = combineCompleteness(completeness, completion)
    }
    for (const [source, calls] of inventory.calls) {
      if (!selected(source)) continue
      for (const call of calls) {
        signal?.throwIfAborted()
        let site = sites.get(call.occurrence)
        if (!site) {
          const occurrence = inventory.index.occurrences.get(call.occurrence)!
          const callee = inventory.index.children.get(call.occurrence)?.get('callee')
          const path = inventory.paths.get(source)
          site = Object.freeze({ call, occurrence, ...(callee ? { callee } : {}), ...(path !== undefined ? { path } : {}) })
          sites.set(call.occurrence, site)
        }
        if (!site.callee || site.path === undefined) completeness = combineCompleteness(completeness, {
          kind: 'partial', reasons: [{ code: 'CALL_SITE_RELATION_MISSING',
            message: 'A call site lacks its callee relation or logical source path.', effective: {} }],
        })
        result.push(site)
      }
    }
    if (unresolvedSources.size) completeness = combineCompleteness(completeness, {
      kind: 'partial', reasons: [{ code: 'CALL_SOURCE_SELECTION_UNKNOWN',
        message: 'A source has no logical path, so its calls cannot be included or excluded by the requested path filter.',
        effective: { sources: unresolvedSources.size } }],
    })
    result.sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '') ||
      left.occurrence.span.start - right.occurrence.span.start || left.call.occurrence.localeCompare(right.call.occurrence))
    return Object.freeze({ sites: Object.freeze(result), completeness: freezeCompleteness(completeness) })
  }
  return Object.assign(project, { dispose() { pending = undefined; sites.clear() } })
}

function inventoryCompleteness(completeness: Completeness): Completeness {
  if (completeness.kind !== 'partial') return completeness
  const reasons = completeness.reasons.filter(({ code }) => !FLOW_ONLY.has(code))
  return reasons.length ? { kind: 'partial', reasons } : { kind: 'complete' }
}

function unavailable(message: string): Completeness {
  return { kind: 'unavailable', reasons: [{ code: 'CALL_INVENTORY_UNAVAILABLE', message, retryable: false }] }
}

function freezeCompleteness(value: Completeness): Completeness {
  return Object.freeze(value.kind === 'complete' ? value : {
    ...value, reasons: Object.freeze(value.reasons.map((reason) => Object.freeze({ ...reason,
      ...('effective' in reason ? { effective: Object.freeze({ ...reason.effective }) } : {}),
    }))),
  }) as Completeness
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const result: Value[] = []
  for await (const value of values) result.push(value)
  return result
}

function reasonKey(reason: AnalysisLimit): string {
  return JSON.stringify([reason.code, reason.message, Object.entries(reason.effective).sort(([left], [right]) => left.localeCompare(right))])
}
