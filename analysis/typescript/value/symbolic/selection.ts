import { combineCompleteness, type AnalysisFailure, type AnalysisLimit, type Completeness } from '../../../facts/index.ts'
import type { SourceId } from '../../../identity/index.ts'
import { stableJson } from '../../../identity/model.ts'
import type { CapabilityStatus } from '../../../query/index.ts'
import type { TypeScriptCallQuery } from '../../body/index.ts'
import type { TypeScriptFact } from '../../facts/index.ts'
import { ValueIndexTable } from './table.ts'

type Body = TypeScriptFact<'body'>
type Demand = TypeScriptFact<'body-demand'>
type Reason = AnalysisFailure | AnalysisLimit
interface CountedReason { readonly reason: Reason; readonly count: number }
interface SourceLookup {
  readonly sources: ReadonlyMap<SourceId, TypeScriptFact<'source'>>
  readonly callsBySource: ReadonlyMap<SourceId, readonly unknown[]>
}

const PREFIX = 'selection:typescript.calls:v1:'
export const CALL_SELECTION = 'typescript.calls/v1' as const
export const callSelectionKey = {
  global: `${PREFIX}global`, all: `${PREFIX}all`, unmapped: `${PREFIX}unmapped`,
  source: (source: SourceId) => `${PREFIX}source:${JSON.stringify(source)}`,
  path: (path: string) => `${PREFIX}path:${JSON.stringify(path)}`,
}

export function callSelectionKeys(options: TypeScriptCallQuery): readonly string[] {
  const keys = [callSelectionKey.global]
  if (options.paths?.length === 0 || options.sources?.length === 0) return keys
  if (options.sources) return [...keys, ...new Set(options.sources.map(callSelectionKey.source))]
  if (options.paths) return [...keys, ...new Set(options.paths.map(callSelectionKey.path)), callSelectionKey.unmapped]
  return [...keys, callSelectionKey.all]
}

// Execution topology may be partial while walkOwned still inventories every call.
const FLOW_ONLY = new Set([
  'CFG_EXPRESSION_BRANCH_PARTIAL', 'CFG_SWITCH_PARTIAL', 'CFG_TRY_PARTIAL',
  'CFG_LABEL_PARTIAL', 'CFG_UNRESOLVED_CONTINUE', 'CFG_UNRESOLVED_BREAK',
])

export function inventoryCompleteness(completeness: Completeness): Completeness {
  if (completeness.kind !== 'partial') return completeness
  const reasons = completeness.reasons.filter(({ code }) => !FLOW_ONLY.has(code))
  return reasons.length ? { kind: 'partial', reasons } : { kind: 'complete' }
}

export function reasonKey(reason: AnalysisLimit): string {
  return JSON.stringify([reason.code, reason.message, Object.entries(reason.effective).sort(([left], [right]) => left.localeCompare(right))])
}

export function unavailable(message: string): Completeness {
  return { kind: 'unavailable', reasons: [{ code: 'CALL_INVENTORY_UNAVAILABLE', message, retryable: false }] }
}

export function freezeCompleteness(value: Completeness): Completeness {
  return Object.freeze(value.kind === 'complete' ? value : {
    ...value, reasons: Object.freeze(value.reasons.map((reason) => Object.freeze({ ...reason,
      ...('effective' in reason ? { effective: Object.freeze({ ...reason.effective }) } : {}),
    }))),
  }) as Completeness
}

/** Retain partial contributions even while unavailable reasons mask them. */
class CompletionCounts {
  readonly partial: ValueIndexTable<string, CountedReason>
  readonly unavailable: ValueIndexTable<string, CountedReason>
  #value: Completeness | undefined
  constructor(partial = new ValueIndexTable<string, CountedReason>(), unavailable = new ValueIndexTable<string, CountedReason>()) {
    this.partial = partial; this.unavailable = unavailable
  }
  get empty(): boolean { return this.partial.size === 0 && this.unavailable.size === 0 }
  adjust(value: Completeness, direction: 1 | -1): CompletionCounts {
    if (value.kind === 'complete') return this
    const reasons = this[value.kind].edit()
    for (const reason of value.reasons) {
      const key = stableJson(reason)
      const count = (reasons.get(key)?.count ?? 0) + direction
      if (count < 0) throw new Error('A call completeness contribution is missing.')
      if (count) reasons.set(key, { reason, count }); else reasons.delete(key)
    }
    return value.kind === 'partial' ? new CompletionCounts(reasons.finish(), this.unavailable)
      : new CompletionCounts(this.partial, reasons.finish())
  }
  value(): Completeness {
    return this.#value ??= freezeCompleteness(this.unavailable.size ? combineCompleteness(undefined, {
      kind: 'unavailable', reasons: [...this.unavailable.values()].map(({ reason }) => reason as AnalysisFailure),
    }) : this.partial.size ? combineCompleteness(undefined, {
      kind: 'partial', reasons: [...this.partial.values()].map(({ reason }) => reason as AnalysisLimit),
    }) : { kind: 'complete' })
  }
}

/** Persistent selection metadata, published with the same revision as its value columns. */
export class CallSelection {
  readonly completion: Completeness
  readonly unmapped: number
  readonly #attributed: ValueIndexTable<string, number>
  readonly #bySource: ValueIndexTable<SourceId, CompletionCounts>
  readonly #unattributed: CompletionCounts
  readonly #demands: readonly Demand[] | undefined
  constructor(attributed = new ValueIndexTable<string, number>(), bySource = new ValueIndexTable<SourceId, CompletionCounts>(),
    unattributed = new CompletionCounts(), completion: Completeness = { kind: 'complete' }, unmapped = 0, demands?: readonly Demand[]) {
    this.#attributed = attributed; this.#bySource = bySource; this.#unattributed = unattributed
    this.completion = completion; this.unmapped = unmapped; this.#demands = demands
  }
  local(source: SourceId): Completeness | undefined { return this.#bySource.get(source)?.value() }
  *sources(): IterableIterator<readonly [SourceId, Completeness]> {
    for (const [source, counts] of this.#bySource) yield [source, counts.value()]
  }
  scoped(options: TypeScriptCallQuery, paths: Pick<ReadonlyMap<SourceId, string>, 'get'>): Completeness {
    if (!this.#demands || options.paths?.length === 0 || options.sources?.length === 0) return this.completion
    const coverage = new Map<string, Completeness>()
    for (const fact of this.#demands) for (const entry of fact.payload.coverage) {
      coverage.set(entry.path, combineCompleteness(coverage.get(entry.path), inventoryCompleteness(entry.completeness)))
    }
    if (!options.paths && !options.sources) {
      const omitted = this.#demands.reduce((count, fact) => count + fact.payload.owners.filter((owner) => !owner.materialized).length, 0)
      return omitted ? combineCompleteness(this.completion, { kind: 'partial', reasons: [{ code: 'BODY_DEMAND_OWNER_OMITTED',
        message: 'The full call inventory includes body owners outside this materialized selection.', effective: { owners: omitted },
      }] }) : this.completion
    }
    const selected = options.sources ? options.sources.flatMap((source) => {
      const path = paths.get(source)
      return path !== undefined && (!options.paths || options.paths.includes(path)) ? [path] : []
    }) : options.paths!
    let result = this.completion
    for (const path of new Set(selected)) result = combineCompleteness(result, coverage.get(path) ?? {
      kind: 'partial', reasons: [{ code: 'BODY_DEMAND_SELECTION_UNCOVERED',
        message: 'The requested call path has no revision-owned materialization coverage.', effective: {},
      }],
    })
    const unresolved = options.sources?.filter((source) => paths.get(source) === undefined).length
    if (unresolved) result = combineCompleteness(result, {
      kind: 'partial', reasons: [{ code: 'CALL_SOURCE_SELECTION_UNKNOWN',
        message: 'A requested source has no logical path for demand coverage.', effective: { sources: unresolved },
      }],
    })
    return freezeCompleteness(result)
  }
  update(bodies: Iterable<readonly [Body | undefined, Body | undefined]>, touched: Set<SourceId>,
    before: SourceLookup, after: SourceLookup, capabilities: readonly CapabilityStatus[] | undefined,
    changed?: Set<string>, demands?: readonly Demand[]): CallSelection {
    const attributed = this.#attributed.edit(), bySource = this.#bySource.edit()
    let unattributed = this.#unattributed
    const completionSources = new Set<SourceId>()
    for (const pair of bodies) {
      if (pair[0] === pair[1]) continue
      for (const [fact, direction] of [[pair[0], -1], [pair[1], 1]] as const) {
        if (!fact) continue
        if (fact.completeness.kind === 'partial') for (const reason of fact.completeness.reasons) {
          const key = reasonKey(reason), count = (attributed.get(key) ?? 0) + direction
          if (count < 0) throw new Error('An attributed call completeness reason is missing.')
          if (count) attributed.set(key, count); else attributed.delete(key)
        }
        const completion = inventoryCompleteness(fact.completeness)
        if (completion.kind === 'complete') continue
        const source = fact.provenance.evidence[0]?.source
        if (source) {
          completionSources.add(source)
          const counts = (bySource.get(source) ?? new CompletionCounts()).adjust(completion, direction)
          if (counts.empty) bySource.delete(source); else bySource.set(source, counts)
        } else unattributed = unattributed.adjust(completion, direction)
      }
    }
    const nextAttributed = attributed.finish(), nextSources = bySource.finish()
    for (const source of completionSources) {
      if (stableJson(this.local(source)) !== stableJson(nextSources.get(source)?.value())) touched.add(source)
    }
    let unmapped = this.unmapped
    const relevant = (lookup: SourceLookup, local: Completeness | undefined, source: SourceId) =>
      lookup.sources.get(source)?.payload.logicalPath === undefined && (lookup.callsBySource.has(source) || local !== undefined && local.kind !== 'complete')
    for (const source of touched) {
      unmapped += Number(relevant(after, nextSources.get(source)?.value(), source)) - Number(relevant(before, this.local(source), source))
      changed?.add(callSelectionKey.source(source))
      for (const lookup of [before, after]) {
        const path = lookup.sources.get(source)?.payload.logicalPath
        if (path !== undefined) changed?.add(callSelectionKey.path(path))
      }
    }
    if (touched.size) changed?.add(callSelectionKey.all)
    if (unmapped !== this.unmapped) changed?.add(callSelectionKey.unmapped)
    if (this.#demands !== demands) {
      // Recipe coverage belongs to the revision, including paths with zero calls.
      changed?.add(callSelectionKey.all)
      for (const inventory of [this.#demands, demands]) for (const fact of inventory ?? []) {
        for (const entry of fact.payload.coverage) changed?.add(callSelectionKey.path(entry.path))
        for (const owner of fact.payload.owners) {
          changed?.add(callSelectionKey.source(owner.span.source))
          for (const lookup of [before, after]) {
            const path = lookup.sources.get(owner.span.source)?.payload.logicalPath
            if (path !== undefined) changed?.add(callSelectionKey.path(path))
          }
        }
      }
    }
    let completion: Completeness = { kind: 'complete' }
    for (const capability of ['typescript.body', 'typescript.source']) {
      const status = capabilities?.find((entry) => entry.capability === capability)?.completeness
      const remaining = capability === 'typescript.body' && status?.kind === 'partial'
        ? status.reasons.filter((reason) => !nextAttributed.has(reasonKey(reason)) && !(demands && reason.code === 'BODY_DEMAND_OWNER_OMITTED')) : undefined
      completion = combineCompleteness(completion, remaining
        ? remaining.length ? { kind: 'partial', reasons: remaining } : { kind: 'complete' }
        : status ?? (capability === 'typescript.body' && demands ? { kind: 'complete' } : unavailable(`Required ${capability} capability is unavailable.`)))
    }
    if (demands) {
      completion = combineCompleteness(completion, capabilities?.find(({ capability }) => capability === 'typescript.body-demand')?.completeness ?? unavailable('Required typescript.body-demand capability is unavailable.'))
      for (const fact of demands) completion = combineCompleteness(completion, combineCompleteness(fact.completeness, fact.payload.completeness))
    } else if (capabilities?.some(({ capability }) => capability === 'typescript.body-demand')) completion = combineCompleteness(completion, unavailable('The body demand coverage certificate is unavailable.'))
    completion = freezeCompleteness(combineCompleteness(completion, unattributed.value()))
    if (stableJson(completion) !== stableJson(this.completion)) changed?.add(callSelectionKey.global)
    return new CallSelection(nextAttributed, nextSources, unattributed, completion, unmapped, demands)
  }
}
