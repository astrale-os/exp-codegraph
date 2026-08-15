import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  createProcessNativeAnalysisSessionFactory,
  type AnalysisGeneration,
  type AnalysisQuery,
  type AnalysisStore,
  type AnalysisTelemetrySink,
  type CapabilityStatus,
  type Fact,
  type FactPayloadCodec,
  type NativeModuleBoundary,
} from '../../../analysis/index.ts'
import {
  createTypeScriptAnalysisService,
  createTypeScriptFactReader,
  type AnyTypeScriptFact,
} from '../../../analysis/typescript/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'

import type {
  SelfHostCandidate,
  SelfHostCandidateKind,
  SelfHostFactSummary,
  SelfHostTargetId,
} from './model.ts'

export const SELF_HOST_NATIVE_CAPABILITIES = [
  'astrale.typescript.module',
  'typescript.body',
  'typescript.diagnostic',
  'typescript.occurrence',
  'typescript.project',
  'typescript.source',
  'typescript.symbol',
] as const

export interface AnalyzeProjectOptions {
  readonly target: SelfHostTargetId
  readonly root: string
  readonly project: string
  readonly modules: readonly NativeModuleBoundary[]
  readonly binary: string
  readonly store: AnalysisStore
  readonly telemetry?: AnalysisTelemetrySink
  readonly payloadCodecs?: readonly FactPayloadCodec[]
  readonly capabilities?: readonly string[]
}

export async function analyzeProject(options: AnalyzeProjectOptions): Promise<{
  readonly service: Awaited<ReturnType<typeof createTypeScriptAnalysisService>>
  readonly generation: AnalysisGeneration
  readonly elapsedMs: number
}> {
  const sessions = createProcessNativeAnalysisSessionFactory({
    command: options.binary,
    ...(options.payloadCodecs ? { payloadCodecs: options.payloadCodecs } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  })
  const service = await createTypeScriptAnalysisService({
    project: {
      root: options.root,
      config: options.project,
      capabilities: options.capabilities ?? SELF_HOST_NATIVE_CAPABILITIES,
      modules: options.modules,
    },
    sessions,
    store: options.store,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  })
  const started = performance.now()
  const refreshed = await service.refresh()
  return {
    service,
    generation: refreshed.generation,
    elapsedMs: round(performance.now() - started),
  }
}

export async function summarizeGeneration(
  target: SelfHostTargetId,
  project: string,
  store: AnalysisStore,
  generation: AnalysisGeneration,
): Promise<SelfHostFactSummary> {
  const query = await store.open(generation.universe, generation.id)
  try {
    return await summarizeQuery(target, project, query)
  } finally {
    await query.dispose()
  }
}

async function summarizeQuery(
  target: SelfHostTargetId,
  project: string,
  query: AnalysisQuery,
): Promise<SelfHostFactSummary> {
  const semantic = createHash('sha256')
  const bound = createHash('sha256')
  const manifest = await query.manifest()
  const capabilities = await query.capabilities()
  const namespaces: Record<string, number> = {}
  const namespaceBytes: Record<string, number> = {}
  const kinds: Record<string, number> = {}
  const bodyFieldBytes: Record<string, number> = {}
  const bodyOccurrenceFieldBytes: Record<string, number> = {}
  const valueStates = { known: 0, unknown: 0, ambiguous: 0, unsupported: 0 }
  const sourcePaths = new Map<string, { readonly path: string; readonly revision: string }>()
  const incomplete = new Map<string, CandidateAccumulator>()
  const diagnostics = new Map<string, CandidateAccumulator>()
  const largest: LargestFact[] = []
  let facts = 0
  let factBytes = 0
  let calls = 0
  let compilerDiagnostics = 0

  const reader = createTypeScriptFactReader(query)
  const visit = (fact: Fact): void => {
    if (fact.generation !== query.generation.id) {
      throw new Error(`Fact ${fact.id} is bound to ${fact.generation}, not ${query.generation.id}.`)
    }
    const portable = portableFact(fact)
    const encoded = stableJson(portable)
    const boundEncoded = stableJson(fact)
    const bytes = Buffer.byteLength(encoded)
    semantic.update(String(bytes)).update(':').update(encoded).update('\n')
    bound.update(String(Buffer.byteLength(boundEncoded))).update(':').update(boundEncoded).update('\n')
    facts++
    factBytes += bytes
    namespaces[fact.namespace] = (namespaces[fact.namespace] ?? 0) + 1
    namespaceBytes[fact.namespace] = (namespaceBytes[fact.namespace] ?? 0) + bytes
    kinds[fact.kind] = (kinds[fact.kind] ?? 0) + 1
    if (fact.completeness.kind !== 'complete') {
      const reasonCodes = fact.completeness.reasons.map((reason) => reason.code).sort()
      accumulate(
        incomplete,
        stableJson({ namespace: fact.namespace, kind: fact.kind, completeness: fact.completeness }),
        `${fact.namespace}/${fact.kind} is ${fact.completeness.kind}: ${reasonCodes.join(',')}`,
        factWitnesses(fact),
        createHash('sha256').update(encoded).digest('hex'),
      )
    }
    retainLargest(largest, {
      bytes,
      fact,
      digest: createHash('sha256').update(encoded).digest('hex'),
    })
  }

  for await (const fact of reader.exportAll()) {
    visit(fact)
    if (fact.namespace === 'typescript.diagnostic') {
      compilerDiagnostics++
      const key = stableJson(fact.payload)
      accumulate(
        diagnostics,
        key,
        `${fact.payload.severity} TypeScript diagnostic ${fact.payload.code}`,
        factWitnesses(fact),
        createHash('sha256').update(stableJson(portableFact(fact))).digest('hex'),
      )
    } else if (fact.namespace === 'typescript.source') {
      sourcePaths.set(fact.payload.source, {
        path: fact.payload.logicalPath,
        revision: fact.payload.revision,
      })
    } else if (fact.namespace === 'typescript.body') {
      calls += fact.payload.body.calls.length
      countValueStates(fact.payload.values, valueStates)
      attributeBodyBytes(fact.payload, bodyFieldBytes, bodyOccurrenceFieldBytes)
    }
  }

  const capabilityRecord: Record<string, string> = {}
  const candidateInputs: Omit<SelfHostCandidate, 'disposition' | 'rationale'>[] = []
  for (const capability of capabilities) {
    capabilityRecord[capability.capability] = completenessLabel(capability.completeness)
    candidateInputs.push(...incompleteCapabilityCandidates(target, project, capability))
  }
  for (const [key, value] of diagnostics) {
    const witnesses = resolveWitnesses(value.witnesses, sourcePaths)
    candidateInputs.push(candidate({
      target,
      project,
      kind: 'compiler-diagnostic',
      key: accumulatedKey(key, value, witnesses),
      summary: value.summary,
      count: value.count,
      witnesses: witnesses.slice(0, 5),
    }))
  }
  for (const [key, value] of incomplete) {
    const witnesses = resolveWitnesses(value.witnesses, sourcePaths)
    candidateInputs.push(candidate({
      target,
      project,
      kind: 'incomplete-fact',
      key: accumulatedKey(key, value, witnesses),
      summary: value.summary,
      count: value.count,
      witnesses: witnesses.slice(0, 5),
    }))
  }

  const largestFacts = largest
    .sort((left, right) => right.bytes - left.bytes || left.fact.id.localeCompare(right.fact.id))
    .map(({ bytes, fact, digest }) => ({
      bytes,
      namespace: fact.namespace,
      kind: fact.kind,
      subject: fact.subject,
      sources: resolveWitnesses(factWitnesses(fact), sourcePaths),
      digest,
    }))
  for (const value of largestFacts) {
    candidateInputs.push(candidate({
      target,
      project,
      kind: 'large-fact',
      key: stableJson(value),
      summary: `${value.namespace}/${value.kind} retained ${value.bytes} serialized bytes`,
      count: 1,
      witnesses: value.sources.length ? value.sources : [value.subject],
    }))
  }

  const sortedCandidates = candidateInputs.sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  )
  assertUniqueCandidateFingerprints(sortedCandidates)

  return {
    semanticDigest: semantic.digest('hex'),
    boundFactDigest: bound.digest('hex'),
    manifestDigest: createHash('sha256').update(stableJson(manifest)).digest('hex'),
    facts,
    factBytes,
    namespaces: sortedRecord(namespaces),
    namespaceBytes: sortedRecord(namespaceBytes),
    kinds: sortedRecord(kinds),
    bodyFieldBytes: sortedRecord(bodyFieldBytes),
    bodyOccurrenceFieldBytes: sortedRecord(bodyOccurrenceFieldBytes),
    valueStates,
    calls,
    capabilities: sortedRecord(capabilityRecord),
    compilerDiagnostics,
    largestFacts: largestFacts.map(({ digest: _digest, ...value }) => value),
    candidateInputs: sortedCandidates,
  }
}

function attributeBodyBytes(
  payload: TypeScriptBodyPayload,
  fields: Record<string, number>,
  occurrenceFields: Record<string, number>,
): void {
  const body = payload.body
  const bodyEntries = Object.entries(body as unknown as Readonly<Record<string, unknown>>)
  add(fields, 'body.structure', 2 + Math.max(0, bodyEntries.length - 1))
  for (const [key, value] of bodyEntries) add(fields, `body.${key}`, memberBytes(key, value))
  const payloadEntries: readonly [string, unknown][] = [
    ['values', payload.values],
    ['completeness', payload.completeness],
  ]
  add(fields, 'payload.structure', 2 + Math.max(0, payloadEntries.length))
  add(fields, 'payload.body-key', Buffer.byteLength('"body":'))
  for (const [key, value] of payloadEntries) add(fields, `payload.${key}`, memberBytes(key, value))

  for (const occurrence of body.occurrences) {
    const entries = ([
      ['id', occurrence.id],
      ['kind', occurrence.kind],
      ['owner', occurrence.owner],
      ['syntax', occurrence.syntax],
      ['symbol', occurrence.symbol],
    ] satisfies readonly (readonly [string, unknown])[]).filter((entry) => entry[1] !== undefined)
    add(occurrenceFields, 'structure', 2 + entries.length)
    for (const [key, value] of entries) add(occurrenceFields, key, memberBytes(key, value))
    add(occurrenceFields, 'span.key', Buffer.byteLength('"span":'))
    add(occurrenceFields, 'span.structure', 5)
    for (const [key, value] of Object.entries(occurrence.span)) {
      add(occurrenceFields, `span.${key}`, memberBytes(key, value))
    }
  }
}

type TypeScriptBodyPayload = Extract<AnyTypeScriptFact, { readonly namespace: 'typescript.body' }>['payload']

function memberBytes(key: string, value: unknown): number {
  return Buffer.byteLength(stableJson({ [key]: value })) - 2
}

function add(values: Record<string, number>, key: string, bytes: number): void {
  values[key] = (values[key] ?? 0) + bytes
}

/** One exact, independently governable candidate per completeness reason. */
export function incompleteCapabilityCandidates(
  target: SelfHostTargetId,
  project: string,
  capability: CapabilityStatus,
): readonly Omit<SelfHostCandidate, 'disposition' | 'rationale'>[] {
  if (capability.completeness.kind === 'complete') return []
  return capability.completeness.reasons.map((reason) => candidate({
    target,
    project,
    kind: 'incomplete-capability',
    key: stableJson({
      capability: capability.capability,
      completeness: {
        kind: capability.completeness.kind,
        reason,
      },
    }),
    summary: `${capability.capability} is ${capability.completeness.kind}: ${reason.code}`,
    count: 1,
    witnesses: [capability.capability],
  }))
}

export async function binaryDigest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function portableFact(fact: Fact): unknown {
  const { generation: _generation, ...portable } = fact
  return portable
}

function countValueStates(
  input: unknown,
  counts: Record<'known' | 'unknown' | 'ambiguous' | 'unsupported', number>,
): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  for (const value of Object.values(input)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const kind = (value as { readonly kind?: unknown }).kind
    if (kind === 'known' || kind === 'unknown' || kind === 'ambiguous' || kind === 'unsupported') {
      counts[kind]++
    }
  }
}

function factWitnesses(fact: Fact): string[] {
  return [
    ...new Set(
      fact.provenance.evidence.map(
        (span) => `${span.source}|${span.revision}|${span.start}|${span.end}`,
      ),
    ),
  ].sort()
}

function resolveWitnesses(
  values: Iterable<string>,
  paths: ReadonlyMap<string, { readonly path: string; readonly revision: string }>,
): string[] {
  return [...new Set([...values].map((value) => {
    const [source, revision, start, end] = value.split('|')
    const known = source ? paths.get(source) : undefined
    if (!known) return value
    if (revision !== known.revision) {
      throw new Error(`Evidence revision ${revision} differs from source fact ${known.revision}.`)
    }
    return `${known.path}@${revision}:${start}-${end}`
  }))].sort()
}

interface CandidateAccumulator {
  readonly summary: string
  count: number
  readonly witnesses: Set<string>
  readonly factDigests: Set<string>
}

function accumulate(
  map: Map<string, CandidateAccumulator>,
  key: string,
  summary: string,
  witnesses: readonly string[],
  factDigest: string,
): void {
  const current = map.get(key) ?? {
    summary,
    count: 0,
    witnesses: new Set<string>(),
    factDigests: new Set<string>(),
  }
  current.count++
  for (const witness of witnesses) current.witnesses.add(witness)
  current.factDigests.add(factDigest)
  map.set(key, current)
}

function accumulatedKey(
  classification: string,
  value: CandidateAccumulator,
  witnesses: readonly string[],
): string {
  return stableJson({
    classification,
    count: value.count,
    witnesses,
    factDigests: [...value.factDigests].sort(),
  })
}

function candidate(input: {
  readonly target: SelfHostTargetId
  readonly project: string
  readonly kind: SelfHostCandidateKind
  readonly key: string
  readonly summary: string
  readonly count: number
  readonly witnesses: readonly string[]
}): Omit<SelfHostCandidate, 'disposition' | 'rationale'> {
  return {
    fingerprint: createHash('sha256')
      .update(stableJson([input.target, input.project, input.kind, input.key]))
      .digest('hex'),
    target: input.target,
    project: input.project,
    kind: input.kind,
    summary: input.summary,
    count: input.count,
    witnesses: input.witnesses,
  }
}

function assertUniqueCandidateFingerprints(
  candidates: readonly Omit<SelfHostCandidate, 'disposition' | 'rationale'>[],
): void {
  for (let index = 1; index < candidates.length; index++) {
    const previous = candidates[index - 1]!
    const current = candidates[index]!
    if (previous.fingerprint !== current.fingerprint) continue
    throw new Error(
      `Self-host candidates ${previous.summary} and ${current.summary} share fingerprint ${current.fingerprint}.`,
    )
  }
}

interface LargestFact {
  readonly bytes: number
  readonly fact: Fact
  readonly digest: string
}

function retainLargest(values: LargestFact[], candidate: LargestFact): void {
  values.push(candidate)
  values.sort((left, right) => right.bytes - left.bytes || left.fact.id.localeCompare(right.fact.id))
  if (values.length > 5) values.pop()
}

function completenessLabel(value: { readonly kind: string; readonly reasons?: readonly { readonly code: string }[] }): string {
  return value.kind === 'complete'
    ? 'complete'
    : `${value.kind}:${(value.reasons ?? []).map((reason) => reason.code).sort().join(',')}`
}

function sortedRecord<Value>(value: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
