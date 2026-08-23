import type { AnalysisGenerationId, ProjectUniverseId } from '../../analysis/index.ts'
import { createHash } from 'node:crypto'
import type { QualificationSnapshot } from '../../conformance/index.ts'
import type { RepositoryStatisticsReport } from '../../repository/index.ts'
import { specificationSnapshotIdentity } from '../../specification/snapshot/identity.ts'
import type {
  FileWorkspaceCheckpointStore,
  JsonValue,
  WorkspaceCheckpointManifest,
} from '../../workspace/checkpoint/index.ts'
import {
  decodeWorkspaceCheckpointJson,
  encodeWorkspaceCheckpointJson,
  WORKSPACE_CHECKPOINT_JSON_ENCODING,
} from '../../workspace/checkpoint/index.ts'
import { canonicalJson, sha256 } from '../../workspace/checkpoint/validation.ts'
import type {
  ApplicationCheckpoint,
  ApplicationCheckpointExpectation,
  ApplicationCheckpointManifestAdmission,
  ApplicationCheckpointManifestExpectation,
  ApplicationCheckpointLoadResult,
} from './model.ts'
import type { TypeSpecApplicationSnapshot } from '../model.ts'

import { createApplicationSnapshot } from '../snapshot/index.ts'
import {
  applicationCheckpointSpecificationDependencies,
  projectedApplicationCheckpointSources,
} from './projection.optimization.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.ts'
import {
  packSpecificationSnapshot,
  unpackSpecificationSnapshot,
  type PackedApiPayload,
  type PackedSpecificationSnapshot,
} from './representation.ts'

const FORMAT = 'astrale.codegraph.application-checkpoint'
const VERSION = 6
const MAXIMUM_DECODED_ARTIFACT_BYTES =
  TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes
const MAXIMUM_DECODED_CHECKPOINT_BYTES = TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes
const SCOPE_PREFIX = 'application-'
const CORPUS = 'corpus/index.json.br'
const STATISTICS = 'corpus/statistics.json.br'
const INVENTORY = 'corpus/inventory.json.br'
const QUALIFICATIONS = 'snapshot/qualifications-index.json.br'
const SNAPSHOT = 'snapshot/core.json.br'
const API_PAYLOADS = 'corpus/api-payloads-index.json.br'
const PACKED_REPRESENTATION = 'packed-api-payloads/1'

interface ApplicationCheckpointOptions {
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
}

interface PersistedDescriptor {
  readonly key: string
  readonly identity: string
  readonly payloads?: readonly string[]
}

interface CorpusIndexDescriptor extends PersistedDescriptor {
  readonly source: string
  readonly root: string
  readonly dependencies: readonly string[]
  readonly payloads: readonly string[]
}

interface PersistedApplicationCheckpoint {
  readonly specifications: ReadonlyMap<string, PersistedDescriptor>
  readonly apiPayloads: ReadonlyMap<string, PersistedDescriptor>
  readonly qualifications: ReadonlyMap<string, PersistedDescriptor>
  readonly artifacts: ReadonlyMap<string, Uint8Array>
  readonly decodedBytes: ReadonlyMap<string, number>
}

/** Bind application identities and schemas to the generic content-addressed checkpoint store. */
export function createApplicationCheckpoint(options: ApplicationCheckpointOptions): ApplicationCheckpoint {
  if (!options.producerFingerprint.trim()) {
    throw new TypeError('Application checkpoint producerFingerprint must be non-empty.')
  }
  let persisted: PersistedApplicationCheckpoint | undefined
  const checkpoint: ApplicationCheckpoint = {
    publication: 'enabled',
    async load(expectation) {
      let loaded
      try {
        if (expectation.projection) {
          const requestCheckpoint = await options.store.load(
            applicationCheckpointRequestScope(expectation),
            signalOptions(expectation),
          )
          if (requestCheckpoint.ok) loaded = requestCheckpoint
        }
        if (!loaded && expectation.projection) {
          const admitted = await options.store.load(
            applicationCheckpointScope(expectation),
            { artifactKeys: [], ...signalOptions(expectation) },
          )
          if (!admitted.ok) return checkpointStoreMiss(admitted.reason)
          const payload = compatibleManifestPayload(
            admitted.manifest,
            expectation,
            options.producerFingerprint,
          )
          if (!payload) return miss('incompatible')
          if (
            payload.complete === true &&
            payload.request !== expectation.request &&
            payload.inventory === expectation.inventory
          ) {
            try {
              return await loadProjectedApplicationCorpus(
                options.store,
                admitted.manifest,
                payload,
                expectation,
              )
            } catch {
              return miss('corrupt')
            }
          }
        }
        loaded ??= await options.store.load(
          applicationCheckpointScope(expectation),
          signalOptions(expectation),
        )
      } catch {
        return miss('unavailable')
      }
      if (!loaded.ok) return checkpointStoreMiss(loaded.reason)
      try {
        const payload = compatibleManifestPayload(
          loaded.manifest,
          expectation,
          options.producerFingerprint,
        )
        if (!payload) return miss('incompatible')
        if (
          payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
          payload.representation !== PACKED_REPRESENTATION ||
          !Number.isSafeInteger(payload.decodedBytes) ||
          (payload.decodedBytes as number) < 0 ||
          (payload.decodedBytes as number) > MAXIMUM_DECODED_CHECKPOINT_BYTES
        ) return miss('incompatible')
        if (
          typeof payload.statistics !== 'boolean' ||
          typeof payload.complete !== 'boolean' ||
          (payload.complete === false &&
            (!expectation.projection || payload.request !== expectation.request))
        ) return miss('incompatible')
        const hasStatistics = payload.statistics
        const decoded = { bytes: 0, artifacts: new Map<string, number>() }
        const apiPayloads = new Map<string, PackedApiPayload>()
        const apiPayloadIndex = artifactIndex(loaded.artifacts, API_PAYLOADS, decoded)
        for (const { source: key, key: artifact } of apiPayloadIndex) {
          const value = jsonArtifact<PackedApiPayload>(loaded.artifacts, artifact, decoded)
          if (apiPayloads.has(key)) throw new Error(`Checkpoint API payload is duplicated: ${key}`)
          apiPayloads.set(key, value)
        }
        const corpusIndex = artifactIndex(loaded.artifacts, CORPUS, decoded)
        const specificationDescriptors = new Map<string, PersistedDescriptor>()
        const specifications = corpusIndex.map(({ source, key }) => {
          const packed = jsonArtifact<PackedSpecificationSnapshot>(
            loaded.artifacts,
            key,
            decoded,
          )
          const specification = unpackSpecificationSnapshot(packed, apiPayloads)
          if (specification.source !== source) throw new Error('Checkpoint specification index drifted.')
          if (specificationDescriptors.has(source)) {
            throw new Error(`Checkpoint specification source is duplicated: ${source}`)
          }
          specificationDescriptors.set(source, {
            key,
            identity: specification.id,
            payloads: packedSpecificationPayloadKeys(packed),
          })
          return specification
        })
        const statistics = hasStatistics
          ? jsonArtifact<RepositoryStatisticsReport>(loaded.artifacts, STATISTICS, decoded)
          : undefined
        const inventory = jsonArtifact<import('../../repository/index.ts').RepositoryInventory>(
          loaded.artifacts,
          INVENTORY,
          decoded,
        )
        const qualificationIndex = artifactIndex(loaded.artifacts, QUALIFICATIONS, decoded)
        const qualificationDescriptors = new Map<string, PersistedDescriptor>()
        const qualifications = qualificationIndex.map(({ source, key }) => {
          const qualification = jsonArtifact<QualificationSnapshot>(loaded.artifacts, key, decoded)
          if (qualification.specification.source !== source) {
            throw new Error('Checkpoint qualification index drifted.')
          }
          if (qualificationDescriptors.has(source)) {
            throw new Error(`Checkpoint qualification source is duplicated: ${source}`)
          }
          qualificationDescriptors.set(source, { key, identity: qualification.id })
          return qualification
        })
        const core = record(jsonArtifact<unknown>(loaded.artifacts, SNAPSHOT, decoded))
        const capabilities = stringArray(core.capabilities)
        if (decoded.bytes !== payload.decodedBytes) return miss('corrupt')
        if (
          (statistics !== undefined &&
            (statistics.repository !== expectation.repository ||
              statistics.inventory !== inventory.revision)) ||
          inventory.repository !== expectation.repository ||
          inventory.revision !== payload.inventory ||
          !Array.isArray(inventory.files) ||
          (statistics !== undefined && !Array.isArray(statistics.files)) ||
          !validCapabilities(capabilities) ||
          !sameStrings(stringArray(payload.capabilities), capabilities) ||
          capabilities.includes('repository-statistics') !== hasStatistics
        ) return miss('incompatible')
        const bySource = new Map(specifications.map((value) => [value.source, value]))
        const analysis = core.analysis === undefined
          ? undefined
          : core.analysis as NonNullable<TypeSpecApplicationSnapshot['analysis']>
        for (const qualification of qualifications) {
          const specification = bySource.get(qualification.specification.source)
          if (
            !specification ||
            qualification.specification.id !== specification.id ||
            qualification.specification.revision !== specification.revision
          ) {
            throw new Error('Checkpoint qualification does not match its specification snapshot.')
          }
          if (
            !analysis ||
            qualification.analysis.id !== analysis.id ||
            !sameStrings(qualification.analysis.universes, analysis.universes)
          ) {
            throw new Error('Checkpoint qualification does not match its analysis snapshot.')
          }
        }
        const included = stringArray(core.specifications).map((source) => {
          const specification = bySource.get(source)
          if (!specification) throw new Error(`Checkpoint specification is missing: ${source}`)
          return specification
        })
        const includedSources = new Set(included.map((value) => value.source))
        if (includedSources.size !== included.length) {
          throw new Error('Checkpoint selected specification sources are duplicated.')
        }
        if (qualifications.some((value) => !includedSources.has(value.specification.source))) {
          throw new Error('Checkpoint qualification is outside the selected specification corpus.')
        }
        const candidate = createApplicationSnapshot({
          repository: expectation.repository,
          inventory: inventory.revision,
          capabilities: capabilities as TypeSpecApplicationSnapshot['capabilities'],
          selection: core.selection as TypeSpecApplicationSnapshot['selection'],
          specifications: included,
          ...(statistics ? { statistics } : {}),
          qualifications,
          ...(analysis === undefined ? {} : { analysis }),
          diagnostics: array(core.diagnostics) as TypeSpecApplicationSnapshot['diagnostics'],
          analysisDiagnostics: stringArray(core.analysisDiagnostics),
        })
        if (candidate.id !== payload.snapshot) return miss('incompatible')
        persisted = {
          specifications: specificationDescriptors,
          apiPayloads: new Map(
            apiPayloadIndex.map(({ source, key }) => [source, { key, identity: source }]),
          ),
          qualifications: qualificationDescriptors,
          artifacts: loaded.artifacts,
          decodedBytes: decoded.artifacts,
        }
        const content = {
          snapshot: candidate,
          specifications,
          inventory,
          complete: payload.complete,
          ...(statistics ? { statistics } : {}),
        }
        return {
          ok: true,
          exact:
            payload.inventory === expectation.inventory &&
            payload.request === expectation.request,
          request: payload.request === expectation.request,
          work: {
            projection: payload.complete ? 'complete' : 'request-closure',
            artifacts: loaded.artifacts.size, decodedBytes: decoded.bytes,
            specifications: specifications.length, apiPayloads: apiPayloads.size,
          },
          content,
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
        (content.statistics !== undefined &&
          (content.statistics.repository !== expectation.repository ||
            content.statistics.inventory !== expectation.inventory)) ||
        content.inventory.repository !== expectation.repository ||
        content.inventory.revision !== expectation.inventory ||
        typeof content.complete !== 'boolean' ||
        (!content.complete && !expectation.projection) ||
        !validCapabilities(snapshot.capabilities) ||
        snapshot.capabilities.includes('repository-statistics') !==
          (content.statistics !== undefined)
      ) {
        throw new Error('Application checkpoint content does not match its exact expectation.')
      }
      const apiPayloads = new Map<string, PackedApiPayload>()
      const specificationIndex = [...content.specifications]
        .sort((left, right) => left.source.localeCompare(right.source))
        .map((specification) => {
          const retained = persisted?.specifications.get(specification.source)
          if (retained?.identity === specification.id && retained.payloads) {
            return {
              source: specification.source,
              key: retained.key,
              identity: specification.id,
              payloads: retained.payloads,
            }
          }
          const value = packSpecificationSnapshot(specification, apiPayloads)
          return {
            source: specification.source,
            key: artifactKey('specification', specification.source),
            identity: specification.id,
            payloads: packedSpecificationPayloadKeys(value),
            value,
          }
        })
      const requiredApiPayloads = new Set(specificationIndex.flatMap((value) => value.payloads))
      const specificationsBySource = new Map(
        content.specifications.map((value) => [value.source, value] as const),
      )
      const corpusSources = new Set(specificationsBySource.keys())
      const apiPayloadIndex = [...requiredApiPayloads]
        .sort((left, right) => left.localeCompare(right))
        .map((source) => ({
          source,
          key: persisted?.apiPayloads.get(source)?.key ?? artifactKey('api-payload', source),
          identity: source,
          ...(apiPayloads.has(source) ? { value: apiPayloads.get(source)! } : {}),
        }))
      const qualificationIndex = [...snapshot.qualifications]
        .sort((left, right) => left.specification.source.localeCompare(right.specification.source))
        .map((qualification) => {
          const source = qualification.specification.source
          const retained = persisted?.qualifications.get(source)
          return {
            source,
            key: retained?.identity === qualification.id
              ? retained.key
              : artifactKey('qualification', source),
            identity: qualification.id,
            ...(retained?.identity === qualification.id ? {} : { value: qualification }),
          }
        })
      const artifacts = new Map<string, Uint8Array>()
      const artifactDecodedBytes = new Map<string, number>()
      let decodedBytes = 0
      const add = (key: string, value: unknown): void => {
        const encoded = encodeWorkspaceCheckpointJson(value, {
          maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
        })
        decodedBytes += encoded.decodedBytes
        if (decodedBytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
          throw new RangeError('Application checkpoint exceeds its decoded byte budget.')
        }
        artifacts.set(key, encoded.value)
        artifactDecodedBytes.set(key, encoded.decodedBytes)
      }
      const retain = (key: string): boolean => {
        const bytes = persisted?.artifacts.get(key)
        const size = persisted?.decodedBytes.get(key)
        if (!bytes || size === undefined) return false
        decodedBytes += size
        if (decodedBytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
          throw new RangeError('Application checkpoint exceeds its decoded byte budget.')
        }
        artifacts.set(key, bytes)
        artifactDecodedBytes.set(key, size)
        return true
      }
      add(CORPUS, specificationIndex.map(({ source, key, identity, payloads }) => ({
        source,
        root: specificationsBySource.get(source)!.root,
        key,
        identity,
        payloads,
        dependencies: applicationCheckpointSpecificationDependencies(
          specificationsBySource.get(source)!,
          corpusSources,
        ),
      })))
      add(API_PAYLOADS, apiPayloadIndex.map(({ source, key, identity }) => ({ source, key, identity })))
      if (content.statistics) add(STATISTICS, content.statistics)
      add(INVENTORY, content.inventory)
      add(QUALIFICATIONS, qualificationIndex.map(({ source, key, identity }) => ({
        source,
        key,
        identity,
      })))
      add(
        SNAPSHOT,
        {
          capabilities: snapshot.capabilities,
          selection: snapshot.selection,
          specifications: snapshot.specifications.map((value) => value.source),
          ...(snapshot.analysis === undefined ? {} : { analysis: snapshot.analysis }),
          diagnostics: snapshot.diagnostics,
          analysisDiagnostics: snapshot.analysisDiagnostics,
        },
      )
      for (const descriptor of specificationIndex) {
        if ('value' in descriptor) add(descriptor.key, descriptor.value)
        else if (!retain(descriptor.key)) throw new Error(`Retained specification artifact is missing: ${descriptor.source}`)
      }
      for (const descriptor of apiPayloadIndex) {
        if ('value' in descriptor) add(descriptor.key, descriptor.value)
        else if (!retain(descriptor.key)) throw new Error(`Retained API payload artifact is missing: ${descriptor.source}`)
      }
      for (const descriptor of qualificationIndex) {
        if ('value' in descriptor) add(descriptor.key, descriptor.value)
        else if (!retain(descriptor.key)) throw new Error(`Retained qualification artifact is missing: ${descriptor.source}`)
      }
      await options.store.publish(
        content.complete
          ? applicationCheckpointScope(expectation)
          : applicationCheckpointRequestScope(expectation),
        {
          manifest: {
            format: FORMAT,
            version: VERSION,
            producerFingerprint: options.producerFingerprint,
            payload: {
              repository: expectation.repository,
              inventory: expectation.inventory,
              corpus: expectation.corpus,
              request: expectation.request,
              capabilities: snapshot.capabilities,
              ...(expectation.sourceProof ? { sourceProof: expectation.sourceProof } : {}),
              snapshot: snapshot.id,
              encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
              representation: PACKED_REPRESENTATION,
              statistics: content.statistics !== undefined,
              complete: content.complete,
              decodedBytes,
            },
          },
          artifacts,
        },
        signalOptions(expectation),
      )
      persisted = {
        specifications: new Map(
          specificationIndex.map(({ source, key, identity, payloads }) => [
            source,
            { key, identity, payloads },
          ]),
        ),
        apiPayloads: new Map(
          apiPayloadIndex.map(({ source, key, identity }) => [source, { key, identity }]),
        ),
        qualifications: new Map(
          qualificationIndex.map(({ source, key, identity }) => [source, { key, identity }]),
        ),
        artifacts,
        decodedBytes: artifactDecodedBytes,
      }
    },
  }
  return checkpoint
}

export function applicationCheckpointCorpus(exclude: readonly string[]): string {
  return JSON.stringify({
    exclude: [...new Set(exclude)].sort((left, right) => left.localeCompare(right)),
  })
}

export function applicationCheckpointScope(
  expectation: Pick<ApplicationCheckpointExpectation, 'corpus' | 'sourceProof'>,
): string {
  const identity = expectation.sourceProof
    ? `${expectation.corpus}\0${expectation.sourceProof}`
    : expectation.corpus
  return `${SCOPE_PREFIX}${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

/** Keep a focused corpus physically unable to shadow the complete corpus or another request. */
function applicationCheckpointRequestScope(expectation: ApplicationCheckpointExpectation): string {
  const identity = [expectation.corpus, expectation.sourceProof ?? '', expectation.request].join('\0')
  return `${SCOPE_PREFIX}request-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

export async function admitApplicationCheckpointManifest(
  options: ApplicationCheckpointOptions,
  expectation: ApplicationCheckpointManifestExpectation,
): Promise<ApplicationCheckpointManifestAdmission> {
  try {
    const loaded = await options.store.load(applicationCheckpointScope(expectation), {
      artifactKeys: [],
    })
    if (!loaded.ok) {
      return {
        ok: false,
        reason: loaded.reason === 'manifest-missing' ? 'missing' : 'unavailable',
      }
    }
    const payload = record(loaded.manifest.payload)
    if (
      loaded.manifest.format !== FORMAT ||
      loaded.manifest.version !== VERSION ||
      loaded.manifest.producerFingerprint !== options.producerFingerprint ||
      payload.repository !== expectation.repository ||
      payload.inventory !== expectation.inventory ||
      payload.corpus !== expectation.corpus ||
      payload.sourceProof !== expectation.sourceProof ||
      payload.complete !== true
    ) {
      return { ok: false, reason: 'incompatible' }
    }
    return {
      ok: true,
      reference: {
        scope: loaded.manifest.scope,
        manifestSha256: checkpointManifestSha256(loaded.manifest),
      },
    }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

function compatibleManifestPayload(
  manifest: WorkspaceCheckpointManifest,
  expectation: ApplicationCheckpointExpectation,
  producerFingerprint: string,
): Record<string, unknown> | undefined {
  const payload = record(manifest.payload)
  if (
    manifest.format !== FORMAT ||
    manifest.version !== VERSION ||
    manifest.producerFingerprint !== producerFingerprint ||
    (expectation.manifestSha256 !== undefined &&
      checkpointManifestSha256(manifest) !== expectation.manifestSha256) ||
    payload.repository !== expectation.repository ||
    payload.corpus !== expectation.corpus ||
    payload.sourceProof !== expectation.sourceProof
  ) return
  return payload
}

async function loadProjectedApplicationCorpus(
  store: FileWorkspaceCheckpointStore,
  admittedManifest: WorkspaceCheckpointManifest,
  payload: Record<string, unknown>,
  expectation: ApplicationCheckpointExpectation,
): Promise<ApplicationCheckpointLoadResult> {
  const projection = expectation.projection
  if (!projection) return miss('incompatible')
  if (
    payload.complete !== true ||
    payload.representation !== PACKED_REPRESENTATION ||
    payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
    !Number.isSafeInteger(payload.decodedBytes) ||
    (payload.decodedBytes as number) < 0 ||
    (payload.decodedBytes as number) > MAXIMUM_DECODED_CHECKPOINT_BYTES ||
    !validCapabilities(projection.capabilities) ||
    !sameStrings(stringArray(payload.capabilities), projection.capabilities) ||
    typeof payload.statistics !== 'boolean' ||
    payload.statistics !== projection.capabilities.includes('repository-statistics')
  ) return miss('incompatible')

  const scope = applicationCheckpointScope(expectation)
  const indexKeys = [
    CORPUS,
    API_PAYLOADS,
    INVENTORY,
    ...(payload.statistics ? [STATISTICS] : []),
  ]
  const indexed = await store.load(scope, {
    artifactKeys: indexKeys,
    ...signalOptions(expectation),
  })
  if (!indexed.ok) return checkpointStoreMiss(indexed.reason)
  if (checkpointManifestSha256(indexed.manifest) !== checkpointManifestSha256(admittedManifest)) {
    return miss('unavailable')
  }

  const decoded = { bytes: 0, artifacts: new Map<string, number>() }
  const corpusIndex = corpusArtifactIndex(indexed.artifacts, decoded)
  const apiPayloadIndex = artifactIndex(indexed.artifacts, API_PAYLOADS, decoded)
  const apiArtifacts = new Map(apiPayloadIndex.map(({ source, key }) => [source, key] as const))
  if (apiArtifacts.size !== apiPayloadIndex.length) {
    throw new TypeError('Checkpoint API payload index contains duplicate sources.')
  }
  const inventory = jsonArtifact<import('../../repository/index.ts').RepositoryInventory>(
    indexed.artifacts,
    INVENTORY,
    decoded,
  )
  const statistics = payload.statistics
    ? jsonArtifact<RepositoryStatisticsReport>(indexed.artifacts, STATISTICS, decoded)
    : undefined
  if (
    inventory.repository !== expectation.repository ||
    inventory.revision !== payload.inventory ||
    inventory.revision !== expectation.inventory ||
    !Array.isArray(inventory.files) ||
    (statistics !== undefined &&
      (statistics.repository !== expectation.repository ||
        statistics.inventory !== inventory.revision ||
        !Array.isArray(statistics.files)))
  ) return miss('incompatible')

  const selectedSources = projectedApplicationCheckpointSources(corpusIndex, projection)
  const selected = corpusIndex.filter(({ source }) => selectedSources.has(source))
  const payloadSources = new Set(selected.flatMap(({ payloads }) => payloads))
  const selectedPayloads = [...payloadSources].sort().map((source) => {
    const key = apiArtifacts.get(source)
    if (!key) throw new Error(`Checkpoint API payload index is missing: ${source}`)
    return { source, key }
  })
  const selectedKeys = [
    ...selected.map(({ key }) => key),
    ...selectedPayloads.map(({ key }) => key),
  ]
  const loaded = await store.load(scope, {
    artifactKeys: selectedKeys,
    ...signalOptions(expectation),
  })
  if (!loaded.ok) return checkpointStoreMiss(loaded.reason)
  if (checkpointManifestSha256(loaded.manifest) !== checkpointManifestSha256(admittedManifest)) {
    return miss('unavailable')
  }

  const apiPayloads = new Map<string, PackedApiPayload>()
  for (const { source, key } of selectedPayloads) {
    apiPayloads.set(source, jsonArtifact<PackedApiPayload>(loaded.artifacts, key, decoded))
  }
  const specifications = selected.map((descriptor) => {
    const packed = jsonArtifact<PackedSpecificationSnapshot>(
      loaded.artifacts,
      descriptor.key,
      decoded,
    )
    if (
      packed.source !== descriptor.source ||
      packed.id !== descriptor.identity ||
      !sameStrings(packedSpecificationPayloadKeys(packed), descriptor.payloads)
    ) throw new Error(`Checkpoint specification index drifted: ${descriptor.source}`)
    const specification = unpackSpecificationSnapshot(packed, apiPayloads)
    const { id: _id, ...identityPreimage } = specification
    if (specificationSnapshotIdentity(identityPreimage) !== specification.id) {
      throw new Error(`Checkpoint specification identity is invalid: ${descriptor.source}`)
    }
    return specification
  })
  if (decoded.bytes > (payload.decodedBytes as number)) return miss('corrupt')
  return {
    ok: true,
    exact: false,
    request: false,
    work: {
      projection: 'request-closure', artifacts: indexKeys.length + selectedKeys.length,
      decodedBytes: decoded.bytes, specifications: specifications.length,
      apiPayloads: apiPayloads.size,
    },
    content: {
      specifications,
      inventory,
      complete: specifications.length === corpusIndex.length,
      ...(statistics ? { statistics } : {}),
    },
  }
}

function corpusArtifactIndex(
  artifacts: ReadonlyMap<string, Uint8Array>,
  decoded: { bytes: number; artifacts?: Map<string, number> },
): readonly CorpusIndexDescriptor[] {
  const value: unknown = jsonArtifact(artifacts, CORPUS, decoded)
  if (!Array.isArray(value) || !value.every(isCorpusIndexDescriptor)) {
    throw new TypeError('Checkpoint corpus index is invalid.')
  }
  const entries = value as readonly CorpusIndexDescriptor[]
  const sources = entries.map(({ source }) => source)
  if (new Set(sources).size !== sources.length || !sameStrings([...sources].sort(), sources)) {
    throw new TypeError('Checkpoint corpus index is not uniquely source-ordered.')
  }
  const admittedSources = new Set(sources)
  if (entries.some(({ dependencies }) =>
    dependencies.some((source) => !admittedSources.has(source)))) {
    throw new TypeError('Checkpoint corpus dependency is outside the admitted index.')
  }
  return entries
}

function isCorpusIndexDescriptor(value: unknown): value is CorpusIndexDescriptor {
  const entry = recordOrUndefined(value)
  return Boolean(
    entry &&
    typeof entry.source === 'string' &&
    typeof entry.root === 'string' &&
    typeof entry.key === 'string' &&
    typeof entry.identity === 'string' &&
    Array.isArray(entry.payloads) &&
    entry.payloads.every((item) => typeof item === 'string') &&
    new Set(entry.payloads).size === entry.payloads.length &&
    Array.isArray(entry.dependencies) &&
    entry.dependencies.every((item) => typeof item === 'string') &&
    new Set(entry.dependencies).size === entry.dependencies.length &&
    sameStrings([...entry.payloads].sort(), entry.payloads as string[]) &&
    sameStrings([...entry.dependencies].sort(), entry.dependencies as string[]),
  )
}

function checkpointStoreMiss(
  reason: import('../../workspace/checkpoint/index.ts').WorkspaceCheckpointMissReason,
): ApplicationCheckpointLoadResult {
  return miss(
    reason === 'manifest-missing'
      ? 'missing'
      : reason.includes('corrupt')
        ? 'corrupt'
        : 'unavailable',
  )
}

function checkpointManifestSha256(manifest: unknown): string {
  return sha256(Buffer.from(canonicalJson(manifest), 'utf8'))
}

function signalOptions(expectation: ApplicationCheckpointExpectation): { readonly signal?: AbortSignal } {
  return expectation.signal ? { signal: expectation.signal } : {}
}

function jsonArtifact<Value>(
  artifacts: ReadonlyMap<string, Uint8Array>,
  key: string,
  decoded: { bytes: number; artifacts?: Map<string, number> },
): Value {
  const bytes = artifacts.get(key)
  if (!bytes) throw new Error(`Checkpoint artifact is missing: ${key}`)
  const artifact = decodeWorkspaceCheckpointJson(bytes, {
    maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
  })
  decoded.bytes += artifact.decodedBytes
  decoded.artifacts?.set(key, artifact.decodedBytes)
  if (decoded.bytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
    throw new RangeError('Application checkpoint exceeds its decoded byte budget.')
  }
  return artifact.value as Value
}

function packedSpecificationPayloadKeys(
  specification: PackedSpecificationSnapshot,
): readonly string[] {
  const module = specification.module
  return [...new Set([
    ...(module.api?.model?.sourceKeys ?? []),
    ...(module.internal?.model?.sourceKeys ?? []),
    ...module.ports.flatMap((port) => port.model?.sourceKeys ?? []),
  ])].sort()
}

function artifactIndex(
  artifacts: ReadonlyMap<string, Uint8Array>,
  key: string,
  decoded: { bytes: number },
): readonly { readonly source: string; readonly key: string }[] {
  const value: unknown = jsonArtifact(artifacts, key, decoded)
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
  return `${kind}/${createHash('sha256').update(source).digest('hex')}.json.br`
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

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validCapabilities(values: readonly string[]): boolean {
  return (
    values.length <= 3 &&
    values.every(
      (value) =>
        value === 'declaration-models' ||
        value === 'declaration-navigation' ||
        value === 'repository-statistics',
    ) &&
    (!values.includes('declaration-navigation') || values.includes('declaration-models')) &&
    values.every((value, index) => index === 0 || values[index - 1]! < value)
  )
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
