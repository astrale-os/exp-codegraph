import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type { TypeSpecApplicationSnapshotId } from '../application/index.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from '../application/limits.ts'
import type { ApiOwnershipDeclaration } from '../api/ownership.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'
import type {
  CatalogIndex,
  CatalogSourcePayload,
  CatalogSpecPayload,
} from '../viewer-host/catalog.ts'
import {
  CATALOG_SOURCE_FORMAT,
  CATALOG_INDEX_FORMAT,
  CATALOG_SPEC_FORMAT,
  CATALOG_TRANSPORT_VERSION,
} from '../viewer-host/catalog.ts'
import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts'
import type { ViewerQualification } from '../viewer-host/qualification.ts'
import {
  createFileWorkspaceCheckpointStore,
  decodeWorkspaceCheckpointJson,
  encodeWorkspaceCheckpointJson,
  WORKSPACE_CHECKPOINT_JSON_ENCODING,
  type FileWorkspaceCheckpointStore,
} from '../workspace/checkpoint/index.ts'
import type {
  CatalogProjectionContext,
  CatalogProjectionSpecification,
  CatalogSnapshot,
} from './catalog-snapshot.ts'
import {
  catalogProjectionFromPayloads,
  catalogProjectionTopology,
  createCatalogIndexModule,
} from './catalog-snapshot.ts'

const FORMAT = 'astrale.codegraph.viewer-catalog-checkpoint'
const VERSION = 4
const LEGACY_VERSION = 3
const CATALOG = 'viewer/catalog-transport-index.json.br'
const CATALOG_SCOPE = 'viewer-catalog'
const VERIFICATION_SCOPE = 'viewer-verification'
const VERIFICATIONS = 'viewer/verifications.json.br'
const SPEC_PAYLOAD_CACHE = 16
const SOURCE_PAYLOAD_CACHE = 128

interface PayloadDescriptor {
  readonly key: string
  readonly artifact: string
  readonly decodedBytes: number
}

interface PersistedCatalog {
  readonly specs: ReadonlyMap<string, PayloadDescriptor>
  readonly sources: ReadonlyMap<string, PayloadDescriptor>
  readonly artifacts: ReadonlyMap<string, Uint8Array>
}

export interface ServerVerificationCheckpoint {
  readonly source: string
  readonly revision: string
  readonly inputs: string
  readonly verification: ViewerQualification
}

export interface ServerCatalogCheckpoint {
  load(
    snapshot: TypeSpecApplicationSnapshotId,
    adapter: ViewerAdapterManifest,
  ): Promise<CatalogSnapshot | undefined>
  publish(snapshot: CatalogSnapshot): Promise<void>
  loadVerifications(): Promise<readonly ServerVerificationCheckpoint[]>
  publishVerifications(values: readonly ServerVerificationCheckpoint[]): Promise<void>
  dispose(): Promise<void>
}

/** Derived server transport cache; it has no authority over application or analysis state. */
export async function createServerCatalogCheckpoint(
  root: string,
): Promise<ServerCatalogCheckpoint> {
  const store = createFileWorkspaceCheckpointStore({
    directory: join(
      defaultTypeSpecCacheDirectory(),
      'workspaces',
      createHash('sha256').update(resolve(root)).digest('hex'),
      'viewer',
    ),
    maxArtifacts: 4_096,
    maximumScopes: 4,
  })
  const producer = `@astrale-os/codegraph@${await codegraphVersion()}:viewer-catalog/4`
  return checkpoint(store, producer)
}

function checkpoint(
  store: FileWorkspaceCheckpointStore,
  producerFingerprint: string,
): ServerCatalogCheckpoint {
  let verificationDigest: string | undefined
  let persistedCatalog: PersistedCatalog | undefined
  const legacyProducerFingerprint = producerFingerprint.replace(/\/4$/u, '/3')
  let service: ServerCatalogCheckpoint
  service = {
    async load(snapshot, adapter) {
      try {
        const loaded = await store.load(CATALOG_SCOPE)
        if (
          !loaded.ok ||
          loaded.manifest.format !== FORMAT ||
          (loaded.manifest.version !== VERSION && loaded.manifest.version !== LEGACY_VERSION) ||
          !validProducer(
            loaded.manifest.version,
            loaded.manifest.producerFingerprint,
            producerFingerprint,
            legacyProducerFingerprint,
          ) ||
          !isRecord(loaded.manifest.payload) ||
          loaded.manifest.payload.snapshot !== snapshot ||
          loaded.manifest.payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
          !validDecodedBytes(loaded.manifest.payload.decodedBytes)
        ) return
        const bytes = loaded.artifacts.get(CATALOG)
        if (!bytes) return
        const decoded = decodeArtifact(bytes)
        const seed = decoded.value
        if (
          !isRecord(seed) ||
          !isCatalogIndex(seed.index, snapshot) ||
          typeof seed.topology !== 'string' ||
          !Array.isArray(seed.specs) ||
          !Array.isArray(seed.sources)
        ) return
        const specs = payloadDescriptors(seed.specs)
        const sources = payloadDescriptors(seed.sources)
        if (
          [...specs, ...sources].some((descriptor) => !loaded.artifacts.has(descriptor.artifact))
        ) return
        const sourceKeys = new Set(sources.map((value) => value.key))
        const declaredBytes = decoded.decodedBytes + descriptorBytes(specs) + descriptorBytes(sources)
        assertDecodedCheckpointBytes(declaredBytes)
        if (declaredBytes !== loaded.manifest.payload.decodedBytes) return
        assertIndexPayloads(seed.index, specs)
        const specPayloads = new LazyCheckpointMap(
          specs,
          loaded.artifacts,
          SPEC_PAYLOAD_CACHE,
          (value, key) => admitSpecPayload(value, key, sourceKeys),
        )
        const sourcePayloads = new LazyCheckpointMap(
          sources,
          loaded.artifacts,
          SOURCE_PAYLOAD_CACHE,
          admitSourcePayload,
        )
        const projection = isRecord(seed.projection)
          ? admitProjection(seed.projection, seed.index)
          : catalogProjectionFromPayloads(seed.index, specPayloads)
        const topology = catalogProjectionTopology(projection.specifications)
        if (isRecord(seed.projection) && topology !== seed.topology) return
        persistedCatalog = {
          specs: new Map(specs.map((value) => [value.key, value])),
          sources: new Map(sources.map((value) => [value.key, value])),
          artifacts: loaded.artifacts,
        }
        const restored: CatalogSnapshot = {
          index: seed.index,
          indexModule: createCatalogIndexModule(seed.index, adapter),
          specs: specPayloads,
          sources: sourcePayloads,
          inputs: new Map(),
          projection,
          topology,
        }
        if (loaded.manifest.version === LEGACY_VERSION) await service.publish(restored)
        return restored
      } catch {
        return
      }
    },

    async publish(snapshot) {
      try {
        const artifacts = new Map<string, Uint8Array>()
        let decodedBytes = 0
        const add = (key: string, value: unknown): number => {
          const encoded = encodeArtifact(value)
          decodedBytes += encoded.decodedBytes
          assertDecodedCheckpointBytes(decodedBytes)
          artifacts.set(key, encoded.value)
          return encoded.decodedBytes
        }
        const addPayload = <Value>(
          kind: 'specification' | 'source',
          key: string,
          values: ReadonlyMap<string, Value>,
          retained: ReadonlyMap<string, PayloadDescriptor> | undefined,
        ): PayloadDescriptor => {
          const existing = retained?.get(key)
          const existingBytes = existing && persistedCatalog?.artifacts.get(existing.artifact)
          if (existing && existingBytes) {
            decodedBytes += existing.decodedBytes
            assertDecodedCheckpointBytes(decodedBytes)
            artifacts.set(existing.artifact, existingBytes)
            return existing
          }
          const artifact = catalogArtifactKey(kind, key)
          const value = values.get(key)
          if (value === undefined) throw new Error(`Catalog payload ${key} is missing.`)
          return { key, artifact, decodedBytes: add(artifact, value) }
        }
        const specDescriptors = [...snapshot.specs.keys()].map((key) =>
          addPayload('specification', key, snapshot.specs, persistedCatalog?.specs),
        )
        const sourceDescriptors = [...snapshot.sources.keys()].map((key) =>
          addPayload('source', key, snapshot.sources, persistedCatalog?.sources),
        )
        add(CATALOG, {
          index: snapshot.index,
          topology: snapshot.topology,
          projection: snapshot.projection,
          specs: specDescriptors,
          sources: sourceDescriptors,
        })
        await store.publish(CATALOG_SCOPE, {
          manifest: {
            format: FORMAT,
            version: VERSION,
            producerFingerprint,
            payload: {
              snapshot: snapshot.index.snapshot,
              encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
              decodedBytes,
            },
          },
          artifacts,
        })
        persistedCatalog = {
          specs: new Map(specDescriptors.map((value) => [value.key, value])),
          sources: new Map(sourceDescriptors.map((value) => [value.key, value])),
          artifacts,
        }
      } catch {
        // Presentation persistence is advisory and never blocks a coherent live catalog.
      }
    },

    async loadVerifications() {
      try {
        const loaded = await store.load(VERIFICATION_SCOPE)
        if (
          !loaded.ok ||
          loaded.manifest.format !== FORMAT ||
          (loaded.manifest.version !== VERSION && loaded.manifest.version !== LEGACY_VERSION) ||
          !validProducer(
            loaded.manifest.version,
            loaded.manifest.producerFingerprint,
            producerFingerprint,
            legacyProducerFingerprint,
          ) ||
          !isRecord(loaded.manifest.payload) ||
          loaded.manifest.payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
          !validDecodedBytes(loaded.manifest.payload.decodedBytes)
        ) return []
        const bytes = loaded.artifacts.get(VERIFICATIONS)
        if (!bytes) return []
        const decoded = decodeArtifact(bytes)
        if (decoded.decodedBytes !== loaded.manifest.payload.decodedBytes) return []
        const values = decoded.value
        if (!Array.isArray(values)) return []
        verificationDigest = createHash('sha256').update(bytes).digest('hex')
        return values.filter(isVerificationCheckpoint)
      } catch {
        return []
      }
    },

    async publishVerifications(values) {
      try {
        const encoded = encodeArtifact(values)
        const bytes = encoded.value
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (digest === verificationDigest) return
        await store.publish(VERIFICATION_SCOPE, {
          manifest: {
            format: FORMAT,
            version: VERSION,
            producerFingerprint,
            payload: {
              records: values.length,
              encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
              decodedBytes: encoded.decodedBytes,
            },
          },
          artifacts: { [VERIFICATIONS]: bytes },
        })
        verificationDigest = digest
      } catch {
        // Verification projection persistence is advisory.
      }
    },
    dispose: () => store.dispose(),
  }
  return service
}

class LazyCheckpointMap<Value> implements ReadonlyMap<string, Value> {
  readonly #descriptors: ReadonlyMap<string, PayloadDescriptor>
  readonly #artifacts: ReadonlyMap<string, Uint8Array>
  readonly #cache = new Map<string, Value>()
  readonly #capacity: number
  readonly #admit: (value: unknown, key: string) => Value

  constructor(
    descriptors: readonly PayloadDescriptor[],
    artifacts: ReadonlyMap<string, Uint8Array>,
    capacity: number,
    admit: (value: unknown, key: string) => Value,
  ) {
    this.#descriptors = new Map(descriptors.map((value) => [value.key, value]))
    this.#artifacts = artifacts
    this.#capacity = capacity
    this.#admit = admit
  }

  get size(): number {
    return this.#descriptors.size
  }

  has(key: string): boolean {
    return this.#descriptors.has(key)
  }

  get(key: string): Value | undefined {
    const cached = this.#cache.get(key)
    if (cached !== undefined) {
      this.#cache.delete(key)
      this.#cache.set(key, cached)
      return cached
    }
    const descriptor = this.#descriptors.get(key)
    if (!descriptor) return
    const bytes = this.#artifacts.get(descriptor.artifact)
    if (!bytes) throw new Error(`Catalog checkpoint is missing ${descriptor.artifact}.`)
    const decoded = decodeArtifact(bytes)
    if (decoded.decodedBytes !== descriptor.decodedBytes) {
      throw new Error(`Catalog checkpoint decoded size drifted for ${descriptor.artifact}.`)
    }
    const value = this.#admit(decoded.value, key)
    this.#cache.set(key, value)
    while (this.#cache.size > this.#capacity) this.#cache.delete(this.#cache.keys().next().value!)
    return value
  }

  keys(): ReturnType<ReadonlyMap<string, Value>['keys']> {
    return this.#descriptors.keys()
  }

  values(): ReturnType<ReadonlyMap<string, Value>['values']> {
    return this.materialize().values()
  }

  entries(): ReturnType<ReadonlyMap<string, Value>['entries']> {
    return this.materialize().entries()
  }

  forEach(
    callbackfn: (value: Value, key: string, map: ReadonlyMap<string, Value>) => void,
    thisArg?: unknown,
  ): void {
    for (const key of this.#descriptors.keys()) callbackfn.call(thisArg, this.get(key)!, key, this)
  }

  [Symbol.iterator](): ReturnType<ReadonlyMap<string, Value>[typeof Symbol.iterator]> {
    return this.entries()
  }

  private materialize(): Map<string, Value> {
    return new Map([...this.#descriptors.keys()].map((key) => [key, this.get(key)!]))
  }
}

function payloadDescriptors(value: readonly unknown[]): readonly PayloadDescriptor[] {
  const output: PayloadDescriptor[] = []
  const keys = new Set<string>()
  const artifacts = new Set<string>()
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== 'string' ||
      typeof entry.artifact !== 'string' ||
      !Number.isSafeInteger(entry.decodedBytes) ||
      (entry.decodedBytes as number) < 0 ||
      (entry.decodedBytes as number) >
        TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes ||
      keys.has(entry.key) ||
      artifacts.has(entry.artifact)
    ) throw new TypeError('Catalog checkpoint payload descriptor is invalid.')
    keys.add(entry.key)
    artifacts.add(entry.artifact)
    output.push({
      key: entry.key,
      artifact: entry.artifact,
      decodedBytes: entry.decodedBytes as number,
    })
  }
  return output
}

function descriptorBytes(values: readonly PayloadDescriptor[]): number {
  return values.reduce((total, value) => {
    const next = total + value.decodedBytes
    assertDecodedCheckpointBytes(next)
    return next
  }, 0)
}

function assertIndexPayloads(
  index: CatalogIndex,
  specifications: readonly PayloadDescriptor[],
): void {
  const payloads = new Set(specifications.map((value) => value.key))
  if (payloads.size !== index.specs.length) {
    throw new Error('Catalog checkpoint specification payload count drifted.')
  }
  for (const entry of index.specs) {
    if (!payloads.has(`${entry.source}\0${entry.revision}`)) {
      throw new Error(`Catalog checkpoint is missing the indexed payload for ${entry.source}.`)
    }
  }
}

function admitProjection(value: Record<string, unknown>, index: CatalogIndex): CatalogProjectionContext {
  if (!Array.isArray(value.specifications) || !Array.isArray(value.sourceKeys)) {
    throw new TypeError('Catalog checkpoint projection context is invalid.')
  }
  const specifications = value.specifications.map(admitProjectionSpecification)
  const sourceKeys = value.sourceKeys.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      !Array.isArray(entry.keys) ||
      !entry.keys.every((key) => typeof key === 'string') ||
      new Set(entry.keys).size !== entry.keys.length
    ) throw new TypeError('Catalog checkpoint projection source keys are invalid.')
    return { source: entry.source, keys: entry.keys as string[] }
  })
  const indexedSources = index.specs.map((entry) => entry.source)
  if (
    !sameStrings(specifications.map((entry) => entry.source), indexedSources) ||
    !sameStrings(sourceKeys.map((entry) => entry.source), indexedSources)
  ) throw new TypeError('Catalog checkpoint projection inventory drifted.')
  return { specifications, sourceKeys }
}

function admitProjectionSpecification(value: unknown): CatalogProjectionSpecification {
  if (!isRecord(value) || typeof value.source !== 'string' || !Array.isArray(value.modules)) {
    throw new TypeError('Catalog checkpoint projection specification is invalid.')
  }
  const modules = value.modules.map((module) => {
    if (
      !isRecord(module) ||
      typeof module.id !== 'string' ||
      typeof module.name !== 'string' ||
      typeof module.declarationPointer !== 'string' ||
      !Array.isArray(module.imports) ||
      !module.imports.every((item) =>
        isRecord(item) && typeof item.key === 'string' && typeof item.source === 'string',
      )
    ) throw new TypeError('Catalog checkpoint projection module is invalid.')
    const api = module.api === undefined ? undefined : admitProjectionApi(module.api)
    return {
      id: module.id,
      name: module.name,
      declarationPointer: module.declarationPointer,
      ...(api ? { api } : {}),
      imports: module.imports as { key: string; source: string }[],
    }
  })
  return { source: value.source, modules }
}

function admitProjectionApi(value: unknown): CatalogProjectionSpecification['modules'][number]['api'] {
  if (!isRecord(value) || !isRecord(value.model)) {
    throw new TypeError('Catalog checkpoint projection API is invalid.')
  }
  const model = value.model
  if (
    typeof model.entrypoint !== 'string' ||
    !isRecord(model.surface) ||
    !Array.isArray(model.surface.declarations) ||
    !Array.isArray(model.surface.exports)
  ) throw new TypeError('Catalog checkpoint projection API model is invalid.')
  const declarations = model.surface.declarations.map((declaration) => {
    if (
      !isRecord(declaration) ||
      typeof declaration.identity !== 'string' ||
      !isRecord(declaration.location) ||
      !Number.isSafeInteger(declaration.location.line) ||
      !Number.isSafeInteger(declaration.location.column) ||
      !(
        typeof declaration.location.file === 'string' ||
        typeof declaration.location.external === 'string'
      )
    ) throw new TypeError('Catalog checkpoint projection declaration is invalid.')
    return declaration as unknown as ApiOwnershipDeclaration
  })
  const exports = model.surface.exports.map((item) => {
    if (!isRecord(item) || typeof item.declaration !== 'string') {
      throw new TypeError('Catalog checkpoint projection export is invalid.')
    }
    if (!Array.isArray(item.path) || !item.path.every((part) => typeof part === 'string')) {
      throw new TypeError('Catalog checkpoint projection export path is invalid.')
    }
    return { declaration: item.declaration, path: item.path as string[] }
  })
  return { model: { entrypoint: model.entrypoint, surface: { declarations, exports } } }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isCatalogIndex(value: unknown, snapshot: TypeSpecApplicationSnapshotId): value is CatalogIndex {
  return (
    isRecord(value) &&
    value.format === CATALOG_INDEX_FORMAT &&
    value.version === CATALOG_TRANSPORT_VERSION &&
    value.snapshot === snapshot &&
    typeof value.generation === 'string' &&
    Array.isArray(value.specs) &&
    value.specs.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.source === 'string' &&
        typeof entry.revision === 'string',
    ) &&
    Array.isArray(value.diagnostics)
  )
}

function admitSpecPayload(
  value: unknown,
  key: string,
  sourceKeys: ReadonlySet<string>,
): CatalogSpecPayload {
  if (
    !isRecord(value) ||
    value.format !== CATALOG_SPEC_FORMAT ||
    value.version !== CATALOG_TRANSPORT_VERSION ||
    typeof value.source !== 'string' ||
    typeof value.revision !== 'string' ||
    `${value.source}\0${value.revision}` !== key ||
    !isRecord(value.spec)
  ) throw new TypeError('Catalog checkpoint specification payload is invalid.')
  for (const sourceKey of packedSourceKeys(value.spec)) {
    if (!sourceKeys.has(sourceKey)) {
      throw new Error(`Catalog checkpoint is missing source payload ${sourceKey}.`)
    }
  }
  return value as unknown as CatalogSpecPayload
}

function packedSourceKeys(specification: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(specification.modules)) return []
  const output: string[] = []
  for (const module of specification.modules) {
    if (!isRecord(module)) throw new TypeError('Catalog checkpoint packed module is invalid.')
    collectModelSourceKeys(isRecord(module.api) ? module.api.model : undefined, output)
    if (!Array.isArray(module.ports)) throw new TypeError('Catalog checkpoint packed ports are invalid.')
    for (const port of module.ports) {
      if (!isRecord(port)) throw new TypeError('Catalog checkpoint packed port is invalid.')
      collectModelSourceKeys(port.model, output)
    }
  }
  return output
}

function collectModelSourceKeys(value: unknown, output: string[]): void {
  if (value === undefined) return
  if (!isRecord(value) || !Array.isArray(value.sourceKeys)) {
    throw new TypeError('Catalog checkpoint packed API model is invalid.')
  }
  for (const key of value.sourceKeys) {
    if (typeof key !== 'string') throw new TypeError('Catalog checkpoint source key is invalid.')
    output.push(key)
  }
}

function admitSourcePayload(value: unknown, key: string): CatalogSourcePayload {
  if (
    !isRecord(value) ||
    value.format !== CATALOG_SOURCE_FORMAT ||
    value.version !== CATALOG_TRANSPORT_VERSION ||
    value.key !== key ||
    !isRecord(value.source) ||
    !Array.isArray(value.tokens)
  ) throw new TypeError('Catalog checkpoint source payload is invalid.')
  return value as unknown as CatalogSourcePayload
}

function catalogArtifactKey(kind: string, identity: string): string {
  return `viewer/${kind}/${createHash('sha256').update(identity).digest('hex')}.json.br`
}

function encodeArtifact(value: unknown): ReturnType<typeof encodeWorkspaceCheckpointJson> {
  return encodeWorkspaceCheckpointJson(value, {
    maximumDecodedBytes: TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes,
  })
}

function decodeArtifact(bytes: Uint8Array): ReturnType<typeof decodeWorkspaceCheckpointJson> {
  return decodeWorkspaceCheckpointJson(bytes, {
    maximumDecodedBytes: TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes,
  })
}

function validDecodedBytes(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes
  )
}

function validProducer(
  version: unknown,
  actual: unknown,
  current: string,
  legacy: string,
): boolean {
  return actual === current || (version === LEGACY_VERSION && actual === legacy)
}

function assertDecodedCheckpointBytes(value: number): void {
  if (value > TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes) {
    throw new RangeError('Viewer catalog checkpoint exceeds its decoded byte budget.')
  }
}

async function codegraphVersion(): Promise<string> {
  const candidate = resolve(import.meta.dirname, '..')
  const packageRoot = basename(candidate) === 'dist' ? dirname(candidate) : candidate
  const value: unknown = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    !value.version.trim()
  ) throw new Error('Installed @astrale-os/codegraph package has no version.')
  return value.version
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVerificationCheckpoint(value: unknown): value is ServerVerificationCheckpoint {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.revision === 'string' &&
    typeof value.inputs === 'string' &&
    isViewerQualification(value.verification)
  )
}

function isViewerQualification(value: unknown): value is ViewerQualification {
  return (
    isRecord(value) &&
    isQualificationStatus(value.status) &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    Array.isArray(value.dependencies) &&
    value.dependencies.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.rules) &&
    value.rules.every(isQualificationRule) &&
    Array.isArray(value.profiles) &&
    value.profiles.every((profile) =>
      isRecord(profile) &&
      typeof profile.id === 'string' &&
      typeof profile.provider === 'string' &&
      isQualificationStatus(profile.status) &&
      Array.isArray(profile.rules) &&
      profile.rules.every(isQualificationRule),
    )
  )
}

function isQualificationRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isQualificationStatus(value.status) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every((diagnostic) =>
      isRecord(diagnostic) &&
      typeof diagnostic.message === 'string' &&
      (diagnostic.severity === undefined ||
        diagnostic.severity === 'error' ||
        diagnostic.severity === 'warning' ||
        diagnostic.severity === 'info'),
    )
  )
}

function isQualificationStatus(value: unknown): boolean {
  return value === 'pass' || value === 'fail' || value === 'idle' || value === 'error'
}
