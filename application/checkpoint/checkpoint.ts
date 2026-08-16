import type { AnalysisGenerationId, ProjectUniverseId } from '../../analysis/index.ts'
import { createHash } from 'node:crypto'
import type { QualificationSnapshot } from '../../conformance/index.ts'
import type { RepositoryStatisticsReport } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type { FileWorkspaceCheckpointStore, JsonValue } from '../../workspace/checkpoint/index.ts'
import type {
  ApplicationCheckpoint,
  ApplicationCheckpointExpectation,
  ApplicationCheckpointLoadResult,
} from './model.ts'
import type { TypeSpecApplicationSnapshot } from '../model.ts'

import { createApplicationSnapshot } from '../snapshot/index.ts'

const FORMAT = 'astrale.codegraph.application-checkpoint'
const VERSION = 1
const SCOPE_PREFIX = 'application-'
const CORPUS = 'corpus/index.json'
const STATISTICS = 'corpus/statistics.json'
const INVENTORY = 'corpus/inventory.json'
const QUALIFICATIONS = 'snapshot/qualifications-index.json'
const SNAPSHOT = 'snapshot/core.json'

interface ApplicationCheckpointOptions {
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
}

/** Bind application identities and schemas to the generic content-addressed checkpoint store. */
export function createApplicationCheckpoint(options: ApplicationCheckpointOptions): ApplicationCheckpoint {
  if (!options.producerFingerprint.trim()) {
    throw new TypeError('Application checkpoint producerFingerprint must be non-empty.')
  }
  return {
    async load(expectation) {
      let loaded
      try {
        loaded = await options.store.load(checkpointScope(expectation), signalOptions(expectation))
      } catch {
        return miss('unavailable')
      }
      if (!loaded.ok) {
        return miss(
          loaded.reason === 'manifest-missing'
            ? 'missing'
            : loaded.reason.includes('corrupt')
              ? 'corrupt'
              : 'unavailable',
        )
      }
      try {
        const payload = record(loaded.manifest.payload)
        if (
          loaded.manifest.format !== FORMAT ||
          loaded.manifest.version !== VERSION ||
          loaded.manifest.producerFingerprint !== options.producerFingerprint ||
          payload.repository !== expectation.repository ||
          payload.inventory !== expectation.inventory ||
          payload.request !== expectation.request
        ) {
          return miss('incompatible')
        }
        const corpusIndex = artifactIndex(loaded.artifacts, CORPUS)
        const specifications = corpusIndex.map(({ source, key }) => {
          const specification = jsonArtifact<SpecificationSnapshot>(loaded.artifacts, key)
          if (specification.source !== source) throw new Error('Checkpoint specification index drifted.')
          return specification
        })
        const statistics = jsonArtifact<RepositoryStatisticsReport>(loaded.artifacts, STATISTICS)
        const inventory = jsonArtifact<import('../../repository/index.ts').RepositoryInventory>(
          loaded.artifacts,
          INVENTORY,
        )
        const qualificationIndex = artifactIndex(loaded.artifacts, QUALIFICATIONS)
        const qualifications = qualificationIndex.map(({ source, key }) => {
          const qualification = jsonArtifact<QualificationSnapshot>(loaded.artifacts, key)
          if (qualification.specification.source !== source) {
            throw new Error('Checkpoint qualification index drifted.')
          }
          return qualification
        })
        const core = record(jsonArtifact<unknown>(loaded.artifacts, SNAPSHOT))
        if (
          statistics.repository !== expectation.repository ||
          statistics.inventory !== expectation.inventory ||
          inventory.repository !== expectation.repository ||
          inventory.revision !== expectation.inventory ||
          !Array.isArray(inventory.files) ||
          !Array.isArray(statistics.files)
        ) return miss('incompatible')
        const bySource = new Map(specifications.map((value) => [value.source, value]))
        const included = stringArray(core.specifications).map((source) => {
          const specification = bySource.get(source)
          if (!specification) throw new Error(`Checkpoint specification is missing: ${source}`)
          return specification
        })
        const candidate = createApplicationSnapshot({
          repository: expectation.repository,
          inventory: expectation.inventory,
          selection: core.selection as TypeSpecApplicationSnapshot['selection'],
          specifications: included,
          statistics,
          qualifications,
          ...(core.analysis === undefined
            ? {}
            : { analysis: core.analysis as NonNullable<TypeSpecApplicationSnapshot['analysis']> }),
          diagnostics: array(core.diagnostics) as TypeSpecApplicationSnapshot['diagnostics'],
          analysisDiagnostics: stringArray(core.analysisDiagnostics),
        })
        if (candidate.id !== payload.snapshot) return miss('incompatible')
        return {
          ok: true,
          content: { snapshot: candidate, specifications, inventory, statistics },
        }
      } catch {
        return miss('corrupt')
      }
    },

    async publish(expectation, content) {
      const snapshot = content.snapshot
      if (
        snapshot.repository !== expectation.repository ||
        snapshot.inventory !== expectation.inventory ||
        content.statistics.repository !== expectation.repository ||
        content.statistics.inventory !== expectation.inventory ||
        content.inventory.repository !== expectation.repository ||
        content.inventory.revision !== expectation.inventory
      ) {
        throw new Error('Application checkpoint content does not match its exact expectation.')
      }
      const specificationIndex = [...content.specifications]
        .sort((left, right) => left.source.localeCompare(right.source))
        .map((specification) => ({
          source: specification.source,
          key: artifactKey('specification', specification.source),
          value: specification,
        }))
      const qualificationIndex = [...snapshot.qualifications]
        .sort((left, right) => left.specification.source.localeCompare(right.specification.source))
        .map((qualification) => ({
          source: qualification.specification.source,
          key: artifactKey('qualification', qualification.specification.source),
          value: qualification,
        }))
      const artifacts = new Map<string, Uint8Array>([
        [CORPUS, jsonBytes(specificationIndex.map(({ source, key }) => ({ source, key })))],
        [STATISTICS, jsonBytes(content.statistics)],
        [INVENTORY, jsonBytes(content.inventory)],
        [QUALIFICATIONS, jsonBytes(qualificationIndex.map(({ source, key }) => ({ source, key })))],
        [
          SNAPSHOT,
          jsonBytes({
            selection: snapshot.selection,
            specifications: snapshot.specifications.map((value) => value.source),
            analysis: snapshot.analysis,
            diagnostics: snapshot.diagnostics,
            analysisDiagnostics: snapshot.analysisDiagnostics,
          }),
        ],
      ])
      for (const { key, value } of specificationIndex) artifacts.set(key, jsonBytes(value))
      for (const { key, value } of qualificationIndex) artifacts.set(key, jsonBytes(value))
      await options.store.publish(
        checkpointScope(expectation),
        {
          manifest: {
            format: FORMAT,
            version: VERSION,
            producerFingerprint: options.producerFingerprint,
            payload: {
              repository: expectation.repository,
              inventory: expectation.inventory,
              request: expectation.request,
              snapshot: snapshot.id,
            },
          },
          artifacts,
        },
        signalOptions(expectation),
      )
    },
  }
}

function checkpointScope(expectation: ApplicationCheckpointExpectation): string {
  return `${SCOPE_PREFIX}${createHash('sha256').update(expectation.request).digest('hex').slice(0, 32)}`
}

function signalOptions(expectation: ApplicationCheckpointExpectation): { readonly signal?: AbortSignal } {
  return expectation.signal ? { signal: expectation.signal } : {}
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function jsonArtifact<Value>(artifacts: ReadonlyMap<string, Uint8Array>, key: string): Value {
  const bytes = artifacts.get(key)
  if (!bytes) throw new Error(`Checkpoint artifact is missing: ${key}`)
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Value
}

function artifactIndex(
  artifacts: ReadonlyMap<string, Uint8Array>,
  key: string,
): readonly { readonly source: string; readonly key: string }[] {
  const value: unknown = jsonArtifact(artifacts, key)
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        recordOrUndefined(entry) !== undefined &&
        typeof recordOrUndefined(entry)?.source === 'string' &&
        typeof recordOrUndefined(entry)?.key === 'string',
    )
  ) throw new TypeError('Checkpoint artifact index is invalid.')
  return value as { readonly source: string; readonly key: string }[]
}

function artifactKey(kind: string, source: string): string {
  return `${kind}/${createHash('sha256').update(source).digest('hex')}.json`
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Checkpoint value is not an object.')
  }
  return value as Record<string, unknown>
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Checkpoint value is not an array.')
  return value
}

function stringArray(value: unknown): readonly string[] {
  const values = array(value)
  if (!values.every((entry) => typeof entry === 'string')) {
    throw new TypeError('Checkpoint value is not a string array.')
  }
  return values
}

function miss(reason: Exclude<ApplicationCheckpointLoadResult, { readonly ok: true }>['reason']): ApplicationCheckpointLoadResult {
  return { ok: false, reason }
}

/** Compile-time assertion that the manifest payload stays inside the generic JSON boundary. */
const _jsonBoundary: JsonValue = { format: FORMAT, version: VERSION }
void _jsonBoundary

/** Restore exact generation identities without exposing physical database identifiers. */
export function checkpointGenerations(
  snapshot: TypeSpecApplicationSnapshot,
): ReadonlyMap<ProjectUniverseId, AnalysisGenerationId> {
  return new Map(
    (snapshot.analysis?.generations ?? []).map(({ universe, generation }) => [universe, generation]),
  )
}
