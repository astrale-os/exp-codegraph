import { performance } from 'node:perf_hooks'
import { isAbsolute, relative } from 'node:path'

import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from '../protocol/index.ts'
import type { NativeAnalysisSession } from '../protocol/index.ts'
import type { ProjectUniverseId, SourceId } from '../identity/index.ts'
import { deriveAnalysisId, portablePath } from '../identity/index.ts'
import { dispatchAnalysisTelemetry } from '../profiling/dispatch.ts'
import type {
  TypeScriptAnalysisService,
  TypeScriptAnalysisServiceOptions,
  TypeScriptRefreshResult,
} from './model.ts'
import { materializeNativeTransaction } from './universe-transaction.ts'

export async function createTypeScriptAnalysisService(
  options: TypeScriptAnalysisServiceOptions,
): Promise<TypeScriptAnalysisService> {
  const session = await options.sessions.open(options.project)
  return new ResidentTypeScriptAnalysisService(options, session)
}

class ResidentTypeScriptAnalysisService implements TypeScriptAnalysisService {
  #universe: ProjectUniverseId | undefined
  #request = 0
  #disposed = false
  readonly #options: TypeScriptAnalysisServiceOptions
  readonly #session: NativeAnalysisSession

  constructor(
    options: TypeScriptAnalysisServiceOptions,
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
    const started = performance.now()
    const request = this.#request + 1
    const activeUniverse = this.#universe
    let phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    const current = activeUniverse
      ? await this.#options.store.current(activeUniverse)
      : undefined
    this.emit('store.current', request, phaseStarted)
    phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    const response = await this.#session.request(
      {
        id: ++this.#request,
        kind: 'refresh',
        ...(current ? { base: current.id } : {}),
        ...(options.changed ? { changed: [...options.changed].sort() } : {}),
        ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
      },
      { signal: options.signal },
    )
    this.emit('native.request', request, phaseStarted, { responseKind: response.kind })
    if (response.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
      throw new Error(
        `Native analysis protocol ${response.protocolVersion} is incompatible with ${NATIVE_ANALYSIS_PROTOCOL_VERSION}.`,
      )
    }
    if (response.kind === 'error') {
      throw new Error(`Native analysis ${response.code}: ${response.message}`)
    }
    if (response.kind === 'unchanged') {
      if (!current || response.generation !== current.id) {
        throw new Error('Native analysis reported unchanged for a non-current generation.')
      }
      return {
        generation: current,
        changedSources: [],
        invalidatedPasses: [],
        diagnostics: [],
        durationMs: performance.now() - started,
      }
    }
    phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    const materialized = await materializeNativeTransaction(
      this.#options.store,
      activeUniverse,
      current,
      response.transaction,
      { signal: options.signal },
    )
    this.emit('transaction.materialize', request, phaseStarted, {
      manifestShards: response.transaction.manifest.length,
      upsertShards: response.transaction.upserts.length,
      deleteShards: response.transaction.deletes.length,
    })
    this.#universe = materialized.generation.universe
    const universe = materialized.generation.universe
    const changedSources = [
      ...new Set([
        ...response.transaction.upserts
          .filter((shard) => shard.namespace === 'typescript.source')
          .flatMap((shard) =>
            shard.facts.map(
              (fact) => (fact.payload as { readonly source: SourceId }).source,
            ),
          ),
        ...(options.changed ?? []).map((path) =>
          deriveAnalysisId('source', `typescript:${universe}`, {
            path: logicalChangedPath(this.#options.project.root, path),
          }) as SourceId,
        ),
      ]),
    ].sort()
    const invalidatedPasses = [
      ...new Set(
        response.transaction.upserts.flatMap((shard) =>
          shard.facts.map((fact) => fact.provenance.pass),
        ),
      ),
    ].sort()
    return {
      generation: materialized.generation,
      ...(materialized.transaction ? { transaction: materialized.transaction } : {}),
      changedSources,
      invalidatedPasses,
      diagnostics: [],
      durationMs: performance.now() - started,
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#session.dispose()
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('TypeScript analysis service is disposed.')
  }

  private emit(
    phase: string,
    request: number,
    started: bigint,
    metrics?: Readonly<Record<string, string | number | boolean>>,
  ): void {
    if (!this.#options.telemetry) return
    dispatchAnalysisTelemetry(this.#options.telemetry, {
      component: 'analysis',
      phase,
      request,
      durationNs: Number(process.hrtime.bigint() - started),
      ...(metrics ? { metrics } : {}),
    })
  }
}

function logicalChangedPath(root: string, path: string): string {
  return portablePath(isAbsolute(path) ? relative(root, path).replaceAll('\\', '/') : path)
}
