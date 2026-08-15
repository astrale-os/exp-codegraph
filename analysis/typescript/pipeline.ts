import { performance } from 'node:perf_hooks'
import { isAbsolute, relative } from 'node:path'

import type { Fact, FactShard, FactShardReference } from '../facts/index.ts'
import { shardReference } from '../facts/index.ts'
import { bindPhysicalFact } from '../facts/representation/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import { generationIdentity } from '../generation/index.ts'
import type { FactShardKey, PassId, ProjectUniverseId, SourceId } from '../identity/index.ts'
import { deriveAnalysisId, portablePath } from '../identity/index.ts'
import { createMemoryAnalysisStore } from '../memory/index.ts'
import type { PassPlan, PortablePassRunResult } from '../pass/index.ts'
import { planPasses, runPortablePasses } from '../pass/index.ts'
import {
  NATIVE_ANALYSIS_PROTOCOL_VERSION,
  type NativeAnalysisSession,
} from '../protocol/index.ts'
import type { AnalysisQuery } from '../query/index.ts'
import type {
  TypeScriptAnalysisPipelineOptions,
  TypeScriptAnalysisService,
  TypeScriptRefreshResult,
} from './model.ts'
import { materializeNativeDelta, materializeNativeTransaction } from './universe-transaction.ts'

/**
 * Compose one private resident compiler lineage with portable passes and publish
 * exactly one complete generation to the caller-owned store.
 */
export async function createTypeScriptAnalysisPipeline(
  options: TypeScriptAnalysisPipelineOptions,
): Promise<TypeScriptAnalysisService> {
  const session = await options.sessions.open(options.project)
  return new ResidentTypeScriptAnalysisPipeline(options, session)
}

class ResidentTypeScriptAnalysisPipeline implements TypeScriptAnalysisService {
  #universe: ProjectUniverseId | undefined
  readonly #nativeStore = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
  readonly #nativeShards = new Map<FactShardKey, FactShard>()
  readonly #portableShards = new Map<FactShardKey, FactShard>()
  #request = 0
  #disposed = false
  readonly #options: TypeScriptAnalysisPipelineOptions
  readonly #session: NativeAnalysisSession

  constructor(
    options: TypeScriptAnalysisPipelineOptions,
    session: NativeAnalysisSession,
  ) {
    this.#options = options
    this.#session = session
  }

  get universe() {
    return this.#universe
  }

  async refresh(
    options: {
      readonly changed?: readonly string[]
      readonly invalidate?: boolean
      readonly signal?: AbortSignal
    } = {},
  ): Promise<TypeScriptRefreshResult> {
    this.assertOpen()
    options.signal?.throwIfAborted()
    const started = performance.now()
    const activeUniverse = this.#universe
    const nativeBase = activeUniverse
      ? await this.#nativeStore.current(activeUniverse)
      : undefined
    const response = await this.#session.request(
      {
        id: ++this.#request,
        kind: 'refresh',
        ...(nativeBase ? { base: nativeBase.id } : {}),
        ...(nativeBase ? { baseSequence: nativeBase.sequence } : {}),
        ...(options.changed ? { changed: [...options.changed].sort() } : {}),
        ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
      },
      { signal: options.signal },
    )
    if (response.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
      throw new Error(
        `Native analysis protocol ${response.protocolVersion} is incompatible with ${NATIVE_ANALYSIS_PROTOCOL_VERSION}.`,
      )
    }
    if (response.kind === 'error') {
      throw new Error(`Native analysis ${response.code}: ${response.message}`)
    }

    let nativeTransaction: FactTransaction | undefined
    let changedNamespaces = new Set<string>()
    if (response.kind === 'transaction' || response.kind === 'delta') {
      const materialized = response.kind === 'delta'
        ? await materializeNativeDelta(
            this.#nativeStore,
            nativeBase,
            response.delta,
            { signal: options.signal },
          )
        : await materializeNativeTransaction(
            this.#nativeStore,
            activeUniverse,
            nativeBase,
            response.transaction,
            { signal: options.signal },
          )
      const admitted = materialized.transaction
        ?? (response.kind === 'transaction' ? response.transaction : undefined)
      if (!admitted) throw new Error('Native delta materialization omitted its transaction.')
      changedNamespaces = transactionNamespaces(this.#nativeShards, admitted)
      if (materialized.rollover) {
        this.#nativeShards.clear()
        this.#portableShards.clear()
      }
      applyShards(this.#nativeShards, admitted)
      nativeTransaction = admitted
      if (this.#session.acknowledge) {
        await this.#session.acknowledge(
          {
            id: ++this.#request,
            generation: materialized.generation.id,
            sequence: materialized.generation.sequence,
          },
          { signal: options.signal },
        )
      }
      this.#universe = materialized.generation.universe
    } else if (response.kind === 'acknowledged') {
      throw new Error('Native analysis acknowledged a generation without a commit request.')
    } else if (!nativeBase || response.generation !== nativeBase.id) {
      throw new Error('Native analysis reported unchanged for a non-current private generation.')
    }

    const universe = this.#universe
    if (!universe) throw new Error('Native analysis did not establish a project universe.')
    const nativeGeneration = await this.#nativeStore.current(universe)
    if (!nativeGeneration) throw new Error('Native analysis did not establish a generation.')
    const nativeQuery = await this.#nativeStore.open(universe, nativeGeneration.id)
    try {
      const nativeManifest = await nativeQuery.manifest()
      assertCompleteShards(this.#nativeShards, nativeManifest, 'native')
      const schemas = uniqueSchemas(nativeManifest)
      const plan = planPasses(
        this.#options.passes.map((pass) => pass.manifest),
        this.#options.requestedCapabilities,
        {
          availableCapabilities: nativeGeneration.capabilities,
          availableSchemas: schemas,
        },
      )
      const invalidated = invalidatedPortablePasses(
        plan.ordered,
        this.#portableShards,
        changedNamespaces,
        options.invalidate === true,
      )
      const selectedPlan = {
        ...plan,
        ordered: plan.ordered.filter((manifest) => invalidated.has(manifest.id)),
      }
      const portable = selectedPlan.ordered.length
        ? await runPortablePasses({
            plan: selectedPlan,
            passes: this.#options.passes,
            query: nativeQuery,
            carriedShards: [...this.#portableShards.values()],
            producer: this.#options.producer,
            ...(options.signal ? { signal: options.signal } : {}),
          })
        : carryPortablePasses(
            nativeGeneration,
            nativeManifest,
            [...this.#portableShards.values()],
            plan,
            this.#options.producer,
          )
      options.signal?.throwIfAborted()

      const stagedGeneration = portable.transaction?.next ?? nativeGeneration
      const stagedManifest = portable.transaction?.manifest ?? nativeManifest
      const stagedShards = new Map([...this.#nativeShards, ...this.#portableShards])
      if (portable.transaction) applyShards(stagedShards, portable.transaction)
      assertCompleteShards(stagedShards, stagedManifest, 'staged')
      replacePortableShards(
        this.#portableShards,
        stagedShards,
        this.#options.passes.flatMap((pass) => pass.manifest.outputs.map((output) => output.namespace)),
      )

      const current = await this.#options.store.current(universe)
      const currentManifest = current
        ? await withQuery(this.#options.store.open(universe, current.id), (query) =>
            query.manifest(),
          )
        : []
      const transaction = publishTransaction(
        current,
        currentManifest,
        stagedGeneration,
        stagedManifest,
        stagedShards,
      )
      if (transaction) {
        await this.#options.store.commit(transaction, { signal: options.signal })
      }

      return {
        generation: transaction?.next ?? current ?? stagedGeneration,
        ...(transaction ? { transaction } : {}),
        changedSources: changedSources(
          this.#options.project.root,
          universe,
          nativeTransaction,
          options.changed,
        ),
        invalidatedPasses: [
          ...new Set([
            ...passesFrom(nativeTransaction),
            ...portable.executed,
          ]),
        ].sort(),
        diagnostics: portable.diagnostics.map(formatDiagnostic),
        durationMs: performance.now() - started,
      }
    } finally {
      await nativeQuery.dispose()
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const results = await Promise.allSettled([this.#session.dispose(), this.#nativeStore.dispose()])
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) throw rejected.reason
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('TypeScript analysis pipeline is disposed.')
  }
}

function carryPortablePasses(
  native: AnalysisGeneration,
  nativeManifest: readonly FactShardReference[],
  portable: readonly FactShard[],
  plan: PassPlan,
  producer: AnalysisGeneration['producer'],
): PortablePassRunResult {
  if (!portable.length) return { executed: [], unavailable: [], diagnostics: [] }
  const manifest = [...nativeManifest, ...portable.map(shardReference)].sort(byReference)
  const generation = {
    universe: native.universe,
    producer,
    sourceManifest: native.sourceManifest,
    capabilities: [
      ...new Set([
        ...native.capabilities,
        ...plan.capabilities,
        ...plan.ordered.flatMap((pass) => pass.providesCapabilities),
      ]),
    ].sort(),
  }
  const id = generationIdentity(generation, manifest)
  return {
    transaction: {
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      base: native.id,
      next: { ...generation, id, sequence: native.sequence + 1 },
      manifest,
      upserts: [],
      deletes: [],
    },
    executed: [],
    unavailable: [],
    diagnostics: [],
  }
}

function transactionNamespaces(
  previous: ReadonlyMap<FactShardKey, FactShard>,
  transaction: FactTransaction,
): Set<string> {
  return new Set([
    ...transaction.upserts.map((shard) => shard.namespace),
    ...transaction.deletes.flatMap((key) => {
      const shard = previous.get(key)
      return shard ? [shard.namespace] : []
    }),
  ])
}

function invalidatedPortablePasses(
  manifests: readonly import('../pass/index.ts').PassManifest[],
  carried: ReadonlyMap<FactShardKey, FactShard>,
  changedNamespaces: ReadonlySet<string>,
  invalidateAll: boolean,
): ReadonlySet<PassId> {
  const invalidated = new Set<PassId>()
  const invalidatedCapabilities = new Set<string>()
  for (const manifest of manifests) {
    const currentOutputs = manifest.outputs.every((output) =>
      [...carried.values()].some(
        (shard) => shard.namespace === output.namespace && shard.schemaVersion === output.version,
      ),
    )
    const direct =
      invalidateAll ||
      !currentOutputs ||
      manifest.inputs.some((input) => changedNamespaces.has(input.namespace)) ||
      manifest.invalidatesOn.some((selector) =>
        [...changedNamespaces].some((namespace) => matchesInvalidation(selector, namespace)),
      ) ||
      manifest.requiresCapabilities.some((capability) => invalidatedCapabilities.has(capability))
    if (!direct) continue
    invalidated.add(manifest.id)
    for (const capability of manifest.providesCapabilities) invalidatedCapabilities.add(capability)
  }
  return invalidated
}

function matchesInvalidation(selector: string, namespace: string): boolean {
  if (selector === '*') return true
  if (selector.endsWith('.*')) {
    const prefix = selector.slice(0, -1)
    return namespace.startsWith(prefix)
  }
  return selector === namespace
}

function replacePortableShards(
  target: Map<FactShardKey, FactShard>,
  staged: ReadonlyMap<FactShardKey, FactShard>,
  namespaces: readonly string[],
): void {
  const portable = new Set(namespaces)
  target.clear()
  for (const [key, shard] of staged) {
    if (portable.has(shard.namespace)) target.set(key, shard)
  }
}

function applyShards(shards: Map<FactShardKey, FactShard>, transaction: FactTransaction): void {
  for (const key of transaction.deletes) shards.delete(key)
  for (const shard of transaction.upserts) shards.set(shard.key, shard)
}

function publishTransaction(
  current: AnalysisGeneration | undefined,
  currentManifest: readonly FactShardReference[],
  staged: AnalysisGeneration,
  stagedManifest: readonly FactShardReference[],
  stagedShards: ReadonlyMap<FactShardKey, FactShard>,
): FactTransaction | undefined {
  if (current?.id === staged.id && sameReferences(currentManifest, stagedManifest)) return undefined
  const currentByKey = new Map(currentManifest.map((reference) => [reference.key, reference]))
  const nextKeys = new Set(stagedManifest.map((reference) => reference.key))
  return {
    protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
    ...(current ? { base: current.id } : {}),
    next: {
      ...staged,
      sequence: (current?.sequence ?? 0) + 1,
    },
    manifest: stagedManifest,
    upserts: [...stagedShards.values()]
      .filter((shard) => currentByKey.get(shard.key)?.digest !== shard.digest)
      .map((shard) => bindGeneration(shard, staged.id))
      .sort(byShard),
    deletes: currentManifest
      .filter((reference) => !nextKeys.has(reference.key))
      .map((reference) => reference.key)
      .sort(),
  }
}

function assertCompleteShards(
  shards: ReadonlyMap<FactShardKey, FactShard>,
  manifest: readonly FactShardReference[],
  stage: string,
): void {
  const actual = [...shards.values()].map(shardReference).sort(byReference)
  if (!sameReferences(actual, manifest)) {
    throw new Error(`The ${stage} analysis manifest is not a complete materialized snapshot.`)
  }
}

function uniqueSchemas(
  manifest: readonly FactShardReference[],
): readonly { readonly namespace: string; readonly version: number }[] {
  const versions = new Map<string, number>()
  for (const reference of manifest) {
    const current = versions.get(reference.namespace)
    if (current !== undefined && current !== reference.schemaVersion) {
      throw new Error(
        `Native namespace ${reference.namespace} has conflicting schema versions ${current} and ${reference.schemaVersion}.`,
      )
    }
    versions.set(reference.namespace, reference.schemaVersion)
  }
  return [...versions]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, version]) => ({ namespace, version }))
}

function bindGeneration(shard: FactShard, generation: Fact['generation']): FactShard {
  return { ...shard, facts: shard.facts.map((fact) => bindPhysicalFact(fact, generation)) }
}

function changedSources(
  root: string,
  universe: ProjectUniverseId,
  transaction: FactTransaction | undefined,
  changed: readonly string[] | undefined,
): readonly SourceId[] {
  return [
    ...new Set([
      ...(transaction?.upserts ?? [])
        .filter((shard) => shard.namespace === 'typescript.source')
        .flatMap((shard) =>
          shard.facts.flatMap((fact) => {
            const source = (fact.payload as { readonly source?: SourceId }).source
            return source ? [source] : []
          }),
        ),
      ...(changed ?? []).map(
        (path) =>
          deriveAnalysisId('source', `typescript:${universe}`, {
            path: logicalChangedPath(root, path),
          }) as SourceId,
      ),
    ]),
  ].sort()
}

function passesFrom(transaction: FactTransaction | undefined): readonly PassId[] {
  return [
    ...new Set(
      (transaction?.upserts ?? []).flatMap((shard) =>
        shard.facts.map((fact) => fact.provenance.pass),
      ),
    ),
  ].sort()
}

function formatDiagnostic(fact: Fact): string {
  return `${fact.kind}:${fact.subject}:${fact.id}`
}

async function withQuery<Value>(
  queryPromise: Promise<AnalysisQuery>,
  read: (query: AnalysisQuery) => Promise<Value>,
): Promise<Value> {
  const query = await queryPromise
  try {
    return await read(query)
  } finally {
    await query.dispose()
  }
}

function logicalChangedPath(root: string, path: string): string {
  return portablePath(isAbsolute(path) ? relative(root, path).replaceAll('\\', '/') : path)
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

function byReference(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

function byShard(left: FactShard, right: FactShard): number {
  return left.key.localeCompare(right.key)
}
