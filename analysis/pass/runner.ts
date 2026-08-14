import type { Completeness, Fact, FactShard, FactShardReference } from '../facts/index.ts'
import { factShardDigest, shardReference, validateFactShard } from '../facts/index.ts'
import { generationIdentity, type FactTransaction } from '../generation/index.ts'
import type { FactId, FactShardKey, PassId } from '../identity/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'
import type {
  AnalysisQuery,
  CapabilityStatus,
  FactFilter,
  FactPage,
  PageRequest,
} from '../query/index.ts'
import type {
  PassManifest,
  PassOutput,
  PortablePassRunOptions,
  PortablePassRunResult,
} from './model.ts'

export async function runPortablePasses(
  options: PortablePassRunOptions,
): Promise<PortablePassRunResult> {
  options.signal?.throwIfAborted()
  const implementations = new Map(options.passes.map((pass) => [pass.manifest.id, pass]))
  const nativeManifest = await options.query.manifest()
  const baseCapabilities = await options.query.capabilities()
  let facts = await exportedFacts(options.query)
  const carried = [...(options.carriedShards ?? [])].sort(byShard)
  assertCarriedShards(nativeManifest, carried)
  const baseManifest = [...nativeManifest, ...carried.map(shardReference)].sort(byKey)
  let manifest = [...baseManifest]
  const outputs = new Map<FactShardKey, FactShard>(carried.map((shard) => [shard.key, shard]))
  facts.push(...carried.flatMap((shard) => shard.facts))
  facts.sort(byFact)
  const executed: PassId[] = []
  const unavailable: PassId[] = []
  const diagnostics: Fact[] = []
  const replacedNamespaces = new Set<string>()

  for (const planned of options.plan.ordered) {
    options.signal?.throwIfAborted()
    if (planned.runtime !== 'portable-typescript') {
      throw new Error(`Portable runner cannot execute native pass ${planned.id}.`)
    }
    const pass = implementations.get(planned.id)
    if (!pass || !sameManifest(pass.manifest, planned)) {
      throw new Error(`Portable pass ${planned.id} has no exact implementation.`)
    }
    const query = new StagedQuery(
      options.query.generation,
      manifest,
      facts,
      mergeCapabilityStatus(baseCapabilities, outputs.values()),
    )
    let output: PassOutput
    try {
      output = await pass.run({
        generation: options.query.generation,
        query,
        ...(options.signal ? { signal: options.signal } : {}),
      })
      options.signal?.throwIfAborted()
      output = normalizeOutput(pass.manifest, output)
    } catch (error) {
      if (options.signal?.aborted) options.signal.throwIfAborted()
      if (planned.mandatory) {
        throw new Error(`Mandatory portable pass ${planned.id} failed.`, { cause: error })
      }
      unavailable.push(planned.id)
      output = unavailableOutput(planned, error)
    } finally {
      await query.dispose()
    }

    executed.push(planned.id)
    diagnostics.push(...output.diagnostics)
    const namespaces = new Set(planned.outputs.map((schema) => schema.namespace))
    for (const namespace of namespaces) replacedNamespaces.add(namespace)
    facts = facts.filter((fact) => !namespaces.has(fact.namespace))
    manifest = manifest.filter((reference) => !namespaces.has(reference.namespace))
    for (const [key, shard] of [...outputs]) {
      if (namespaces.has(shard.namespace)) outputs.delete(key)
    }
    for (const shard of output.shards) {
      const existing = outputs.get(shard.key)
      if (existing) throw new Error(`Portable passes emitted duplicate shard key ${shard.key}.`)
      outputs.set(shard.key, shard)
      manifest.push(shardReference(shard))
      facts.push(...shard.facts)
    }
    manifest.sort(byKey)
    facts.sort(byFact)
  }

  if (!executed.length && !carried.length) {
    return { executed, unavailable, diagnostics }
  }
  const capabilities = [
    ...new Set([
      ...options.query.generation.capabilities,
      ...options.plan.capabilities,
      ...options.plan.ordered.flatMap((pass) => pass.providesCapabilities),
    ]),
  ].sort()
  const generation = {
    universe: options.query.generation.universe,
    producer: options.producer,
    sourceManifest: options.query.generation.sourceManifest,
    capabilities,
  }
  const id = generationIdentity(generation, manifest)
  if (id === options.query.generation.id && sameReferences(baseManifest, manifest)) {
    return { executed, unavailable, diagnostics }
  }
  const baseByKey = new Map(baseManifest.map((reference) => [reference.key, reference]))
  const upserts = [...outputs.values()]
    .filter((shard) => baseByKey.get(shard.key)?.digest !== shard.digest)
    .map((shard) => bindGeneration(shard, id))
    .sort(byShard)
  const nextKeys = new Set(manifest.map((reference) => reference.key))
  const deletes = baseManifest
    .filter(
      (reference) =>
        replacedNamespaces.has(reference.namespace) && !nextKeys.has(reference.key),
    )
    .map((reference) => reference.key)
    .sort()
  const transaction: FactTransaction = {
    protocolVersion: 1,
    base: options.query.generation.id,
    next: {
      ...generation,
      id,
      sequence: options.query.generation.sequence + 1,
    },
    manifest,
    upserts,
    deletes,
  }
  return { transaction, executed, unavailable, diagnostics }
}

function assertCarriedShards(
  native: readonly FactShardReference[],
  carried: readonly FactShard[],
): void {
  const nativeKeys = new Set(native.map((reference) => reference.key))
  const nativeNamespaces = new Set(native.map((reference) => reference.namespace))
  const keys = new Set<string>()
  for (const shard of carried) {
    const diagnostics = validateFactShard(shard)
    if (diagnostics.length) {
      throw new Error(`Cannot carry invalid portable shard ${shard.key}: ${diagnostics.join(', ')}`)
    }
    if (nativeKeys.has(shard.key) || keys.has(shard.key)) {
      throw new Error(`Carried portable shard key collides with staged analysis: ${shard.key}.`)
    }
    if (nativeNamespaces.has(shard.namespace)) {
      throw new Error(`Portable output namespace collides with native analysis: ${shard.namespace}.`)
    }
    keys.add(shard.key)
  }
}

function normalizeOutput(manifest: PassManifest, output: PassOutput): PassOutput {
  const schemas = new Map(manifest.outputs.map((schema) => [schema.namespace, schema.version]))
  const capabilities = [...new Set(manifest.providesCapabilities)].sort()
  const shards: FactShard[] = []
  for (const emitted of output.shards) {
    const emittedIssues = validateFactShard(emitted)
    if (emittedIssues.length) {
      throw new Error(`Pass ${manifest.id} emitted invalid shard: ${emittedIssues.join(', ')}`)
    }
    const draft = { ...emitted, capabilities }
    const shard = { ...draft, digest: factShardDigest(draft) }
    const version = schemas.get(shard.namespace)
    if (version === undefined || version !== shard.schemaVersion) {
      throw new Error(
        `Pass ${manifest.id} emitted undeclared schema ${shard.namespace}@${shard.schemaVersion}.`,
      )
    }
    for (const fact of shard.facts) {
      if (fact.provenance.pass !== manifest.id || fact.provenance.passVersion !== manifest.version) {
        throw new Error(`Pass ${manifest.id} emitted unattributable fact ${fact.id}.`)
      }
    }
    shards.push(shard)
  }
  for (const schema of manifest.outputs) {
    if (!shards.some((shard) => shard.namespace === schema.namespace)) {
      shards.push(completionShard(manifest, schema, output.completion))
    }
  }
  shards.sort(byShard)
  if (new Set(shards.map((shard) => shard.key)).size !== shards.length) {
    throw new Error(`Pass ${manifest.id} emitted duplicate shard keys.`)
  }
  for (const diagnostic of output.diagnostics) {
    if (
      diagnostic.provenance.pass !== manifest.id ||
      diagnostic.provenance.passVersion !== manifest.version
    ) {
      throw new Error(`Pass ${manifest.id} emitted an unattributable diagnostic.`)
    }
  }
  return { ...output, shards, diagnostics: [...output.diagnostics].sort(byFact) }
}

function unavailableOutput(manifest: PassManifest, error: unknown): PassOutput {
  const completion: Completeness = {
    kind: 'unavailable',
    reasons: [
      {
        code: 'PASS_FAILED',
        message: error instanceof Error ? error.message : String(error),
        attributableTo: manifest.id,
        retryable: false,
      },
    ],
  }
  return {
    completion,
    shards: manifest.outputs.map((schema) => completionShard(manifest, schema, completion)),
    diagnostics: [],
  }
}

function completionShard(
  manifest: PassManifest,
  schema: PassManifest['outputs'][number],
  completion: Completeness,
): FactShard {
  const draft = {
    key: deriveAnalysisId('fact-shard-key', schema.namespace, {
      pass: manifest.id,
      scope: manifest.scope,
      completion: true,
    }),
    namespace: schema.namespace,
    schemaVersion: schema.version,
    completion,
    facts: [],
    capabilities: [...new Set(manifest.providesCapabilities)].sort(),
  }
  return { ...draft, digest: factShardDigest(draft) }
}

function bindGeneration(shard: FactShard, generation: Fact['generation']): FactShard {
  return {
    ...shard,
    facts: shard.facts.map((fact) => ({ ...fact, generation })),
  }
}

class StagedQuery implements AnalysisQuery {
  #disposed = false
  readonly generation: AnalysisQuery['generation']
  readonly #references: readonly FactShardReference[]
  readonly #stagedFacts: readonly Fact[]
  readonly #status: readonly CapabilityStatus[]

  constructor(
    generation: AnalysisQuery['generation'],
    references: readonly FactShardReference[],
    stagedFacts: readonly Fact[],
    status: readonly CapabilityStatus[],
  ) {
    this.generation = generation
    this.#references = references
    this.#stagedFacts = stagedFacts
    this.#status = status
  }

  async manifest(): Promise<readonly FactShardReference[]> {
    this.assertOpen()
    return this.#references
  }

  async capabilities(): Promise<readonly CapabilityStatus[]> {
    this.assertOpen()
    return this.#status
  }

  async facts(filter: FactFilter = {}, page: PageRequest = { limit: 100 }): Promise<FactPage> {
    this.assertOpen()
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 10_000) {
      throw new RangeError('Fact page limit must be an integer from 1 through 10000.')
    }
    const matching = this.#stagedFacts.filter((fact) => matches(fact, filter))
    const start = decodeStagedCursor(page.cursor)
    const facts = matching.slice(start, start + page.limit)
    const next = start + facts.length
    return {
      facts,
      ...(next < matching.length ? { nextCursor: String(next) } : {}),
      total: matching.length,
    }
  }

  async factsById(ids: readonly FactId[]): Promise<readonly Fact[]> {
    this.assertOpen()
    const wanted = new Set(ids)
    return this.#stagedFacts.filter((fact) => wanted.has(fact.id))
  }

  async *export(filter: FactFilter = {}): AsyncIterable<Fact> {
    this.assertOpen()
    for (const fact of this.#stagedFacts) {
      this.assertOpen()
      if (matches(fact, filter)) yield fact
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('Staged pass query is disposed.')
  }
}

async function exportedFacts(query: AnalysisQuery): Promise<Fact[]> {
  const facts: Fact[] = []
  for await (const fact of query.export()) facts.push(fact)
  return facts.sort(byFact)
}

function mergeCapabilityStatus(
  base: readonly CapabilityStatus[],
  shards: Iterable<FactShard>,
): readonly CapabilityStatus[] {
  const values = new Map(base.map((status) => [status.capability, status.completeness]))
  for (const shard of shards) {
    values.set(shard.namespace, combine(values.get(shard.namespace), shard.completion))
    for (const capability of shard.capabilities ?? []) {
      values.set(capability, combine(values.get(capability), shard.completion))
    }
  }
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, completeness]) => ({ capability, completeness }))
}

function combine(left: Completeness | undefined, right: Completeness): Completeness {
  if (!left || left.kind === 'complete') return right
  if (right.kind === 'complete') return left
  if (left.kind === 'unavailable' || right.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      reasons: [
        ...(left.kind === 'unavailable' ? left.reasons : []),
        ...(right.kind === 'unavailable' ? right.reasons : []),
      ],
    }
  }
  return { kind: 'partial', reasons: [...left.reasons, ...right.reasons] }
}

function matches(fact: Fact, filter: FactFilter): boolean {
  if (filter.namespaces && !filter.namespaces.includes(fact.namespace)) return false
  if (filter.kinds && !filter.kinds.includes(fact.kind)) return false
  if (filter.subjects && !filter.subjects.includes(fact.subject)) return false
  if (filter.completeness && !filter.completeness.includes(fact.completeness.kind)) return false
  if (
    filter.sources &&
    !fact.provenance.evidence.some((evidence) => filter.sources!.includes(evidence.source))
  ) {
    return false
  }
  if (filter.symbols && !filter.symbols.some((symbol) => fact.subject === symbol)) return false
  return true
}

function decodeStagedCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  const value = Number(cursor)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Staged fact cursor is invalid.')
  return value
}

function sameManifest(left: PassManifest, right: PassManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameReferences(
  left: readonly FactShardReference[],
  right: readonly FactShardReference[],
): boolean {
  return (
    left.length === right.length &&
    left.every((reference, index) => {
      const candidate = right[index]
      return candidate?.key === reference.key && candidate.digest === reference.digest
    })
  )
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

function byShard(left: FactShard, right: FactShard): number {
  return left.key.localeCompare(right.key)
}

function byFact(left: Fact, right: Fact): number {
  return left.id.localeCompare(right.id)
}
