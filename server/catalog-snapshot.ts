import type { ApiModelV2, ApiSource, ApiToken } from '../api/model.ts'
import type {
  DeclarationResource,
  MarkdownResource,
  PortResource,
} from '../specification/resource/index.ts'
import type {
  CatalogIndex,
  CatalogSourcePayload,
  CatalogSpecEntry,
  CatalogSpecPayload,
  CatalogSemanticReference,
  PackedApiModel,
  PackedDeclarationResource,
  PackedPortResource,
  PackedSpec,
  PackedSpecModule,
} from '../viewer-host/catalog.ts'
import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts'
import type { ViewerQualification } from '../viewer-host/qualification.ts'
import type { ViewerCatalog, ViewerSpecification } from '../viewer-host/specification.ts'

import {
  indexCatalogApis,
  type ApiCatalogSpecification,
  type ApiOwnershipModel,
} from '../api/ownership.ts'
import { sourceRevision } from '../source/file.ts'
import {
  CATALOG_INDEX_FORMAT,
  CATALOG_SOURCE_FORMAT,
  CATALOG_SPEC_FORMAT,
  CATALOG_TRANSPORT_VERSION,
  catalogSpecMetrics,
} from '../viewer-host/catalog.ts'
import { projectMarkdownHtml } from './catalog-markdown.ts'
import { catalogReferenceProjection } from './catalog-references.ts'

const MAX_SEARCH_TEXT_CHARACTERS = 64 * 1_024

export interface CatalogSnapshot {
  readonly index: CatalogIndex
  readonly indexModule: string
  readonly specs: ReadonlyMap<string, CatalogSpecPayload>
  readonly sources: ReadonlyMap<string, CatalogSourcePayload>
  readonly inputs: ReadonlyMap<string, ViewerSpecification>
  readonly projection: CatalogProjectionContext
  readonly topology: string
}

export interface CatalogProjectionModule {
  readonly id: string
  readonly name: string
  readonly declarationPointer: string
  readonly api?: { readonly model: ApiOwnershipModel }
  readonly imports: readonly { readonly key: string; readonly source: string }[]
}

export interface CatalogProjectionSpecification extends ApiCatalogSpecification {
  readonly modules: readonly CatalogProjectionModule[]
}

/** Small global context required to project one changed Spec without hydrating the whole catalog. */
export interface CatalogProjectionContext {
  readonly specifications: readonly CatalogProjectionSpecification[]
  readonly sourceKeys: readonly {
    readonly source: string
    readonly keys: readonly string[]
  }[]
}

/** Reconstruct the small delta-projection context from persisted immutable payloads. */
export function catalogProjectionFromPayloads(
  index: CatalogIndex,
  payloads: ReadonlyMap<string, CatalogSpecPayload>,
): CatalogProjectionContext {
  const specifications: CatalogProjectionSpecification[] = []
  const sourceKeys: CatalogProjectionContext['sourceKeys'][number][] = []
  for (const entry of index.specs) {
    const payload = payloads.get(specPayloadKey(entry.source, entry.revision))
    if (!payload) throw new Error(`Catalog payload is missing for ${entry.source}.`)
    specifications.push({
      source: entry.source,
      modules: payload.spec.modules.map((module) => ({
        id: module.id,
        name: module.name,
        declarationPointer: module.declarationPointer,
        ...(module.api?.model
          ? {
              api: {
                model: {
                  entrypoint: module.api.model.entrypoint,
                  surface: {
                    declarations: module.api.model.surface.declarations.map((declaration) => ({
                      identity: declaration.identity,
                      location: declaration.location,
                    })),
                    exports: module.api.model.surface.exports.map((item) => ({
                      declaration: item.declaration,
                      path: item.path,
                    })),
                  },
                },
              },
            }
          : {}),
        imports:
          module.contract?.imports.map((item) => ({ key: item.key, source: item.source })) ?? [],
      })),
    })
    sourceKeys.push({ source: entry.source, keys: packedSpecSourceKeys(payload.spec) })
  }
  return { specifications, sourceKeys }
}

/** Build the immutable browser projection of one already-coherent server Catalog. */
export function createCatalogSnapshot(
  catalog: ViewerCatalog,
  adapterManifest: ViewerAdapterManifest,
  applicationSnapshot: `application:${string}` = `application:${'0'.repeat(64)}`,
  previous?: CatalogSnapshot,
): CatalogSnapshot {
  const reusablePrevious = currentTransportSnapshot(previous) ? previous : undefined
  const sources = new Map<string, CatalogSourcePayload>()
  const specs = new Map<string, CatalogSpecPayload>()
  const entries: CatalogSpecEntry[] = []
  const projectedSpecifications = catalog.specs.map(projectionSpecification)
  const apiIndex = indexCatalogApis({ specs: projectedSpecifications })
  const topology = catalogProjectionTopology(projectedSpecifications)
  if (reusablePrevious?.topology === topology) {
    for (const [key, value] of reusablePrevious.sources) sources.set(key, value)
  }
  const inputs = new Map(
    catalog.specs.map((specification) => [specification.source, specification]),
  )
  const declarationIdentities = ownedDeclarationIdentities(apiIndex)
  const specSourceByModuleId = sourceByModule(projectedSpecifications)
  const sourceKeys: CatalogProjectionContext['sourceKeys'][number][] = []

  for (const spec of catalog.specs) {
    const retained = reusablePayload(reusablePrevious, topology, spec)
    if (retained) {
      specs.set(specPayloadKey(spec.source, retained.entry.revision), retained.payload)
      entries.push(retained.entry)
      sourceKeys.push({
        source: spec.source,
        keys:
          reusablePrevious!.projection.sourceKeys.find((value) => value.source === spec.source)
            ?.keys ?? [],
      })
      continue
    }
    const projection = catalogReferenceProjection(spec, apiIndex)
    const packed = packSpec(spec, sources, projection.documents)
    const semanticReferences = projection.semanticReferences
    const revision = specContentRevision(packed, semanticReferences)
    const payload: CatalogSpecPayload = {
      format: CATALOG_SPEC_FORMAT,
      version: CATALOG_TRANSPORT_VERSION,
      source: spec.source,
      revision,
      spec: packed,
      ...(semanticReferences ? { semanticReferences } : {}),
    }
    specs.set(specPayloadKey(spec.source, revision), payload)
    sourceKeys.push({ source: spec.source, keys: packedSpecSourceKeys(packed) })
    entries.push({
      source: spec.source,
      title: spec.title,
      searchText: specSearchText(spec),
      revision,
      metrics: catalogSpecMetrics(spec),
      ...(spec.icon ? { icon: spec.icon.icon } : {}),
      ...(declarationIdentities.get(spec.source)?.length
        ? { apiDeclarationIdentities: declarationIdentities.get(spec.source) }
        : {}),
      ...catalogContractDependencies(spec, specSourceByModuleId),
    })
  }

  const generation = indexContentRevision(catalog.diagnostics, entries)
  const index: CatalogIndex = {
    format: CATALOG_INDEX_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    generation,
    snapshot: applicationSnapshot,
    specs: entries,
    diagnostics: catalog.diagnostics,
  }
  return {
    index,
    indexModule: createCatalogIndexModule(index, adapterManifest),
    specs,
    sources,
    inputs,
    projection: { specifications: projectedSpecifications, sourceKeys },
    topology,
  }
}

/**
 * Patch one restored transport snapshot from changed presentation records.
 * Returns undefined when global API/dependency ownership changed and a full projection is required.
 */
export function updateCatalogSnapshot(
  previous: CatalogSnapshot,
  changed: readonly ViewerSpecification[],
  sources: readonly string[],
  diagnostics: ViewerCatalog['diagnostics'],
  adapterManifest: ViewerAdapterManifest,
  applicationSnapshot: `application:${string}`,
): CatalogSnapshot | undefined {
  if (!currentTransportSnapshot(previous)) return
  const expectedSources = previous.projection.specifications.map((value) => value.source)
  if (!sameStrings(expectedSources, sources)) return
  const changedBySource = new Map(changed.map((value) => [value.source, value]))
  if (
    changedBySource.size !== changed.length ||
    [...changedBySource.keys()].some((source) => !expectedSources.includes(source))
  ) {
    return
  }
  const projectedSpecifications = previous.projection.specifications.map((value) =>
    changedBySource.has(value.source)
      ? projectionSpecification(changedBySource.get(value.source)!)
      : value,
  )
  const topology = catalogProjectionTopology(projectedSpecifications)
  if (topology !== previous.topology) return

  const apiIndex = indexCatalogApis({ specs: projectedSpecifications })
  const declarationIdentities = ownedDeclarationIdentities(apiIndex)
  const specSourceByModuleId = sourceByModule(projectedSpecifications)
  const specChanges = new Map<string, CatalogSpecPayload>()
  const removedSpecs = new Set<string>()
  const sourceChanges = new Map<string, CatalogSourcePayload>()
  const nextSourceKeys = new Map(
    previous.projection.sourceKeys.map((value) => [value.source, value.keys]),
  )
  const entryChanges = new Map<string, CatalogSpecEntry>()

  for (const specification of changed) {
    const previousEntry = previous.index.specs.find(
      (value) => value.source === specification.source,
    )
    if (!previousEntry) return
    const projection = catalogReferenceProjection(specification, apiIndex)
    const packed = packSpec(specification, sourceChanges, projection.documents)
    const semanticReferences = projection.semanticReferences
    const revision = specContentRevision(packed, semanticReferences)
    const payload: CatalogSpecPayload = {
      format: CATALOG_SPEC_FORMAT,
      version: CATALOG_TRANSPORT_VERSION,
      source: specification.source,
      revision,
      spec: packed,
      ...(semanticReferences ? { semanticReferences } : {}),
    }
    removedSpecs.add(specPayloadKey(previousEntry.source, previousEntry.revision))
    specChanges.set(specPayloadKey(specification.source, revision), payload)
    nextSourceKeys.set(specification.source, packedSpecSourceKeys(packed))
    entryChanges.set(specification.source, {
      source: specification.source,
      title: specification.title,
      searchText: specSearchText(specification),
      revision,
      metrics: catalogSpecMetrics(specification),
      ...(specification.icon ? { icon: specification.icon.icon } : {}),
      ...(declarationIdentities.get(specification.source)?.length
        ? { apiDeclarationIdentities: declarationIdentities.get(specification.source) }
        : {}),
      ...catalogContractDependencies(specification, specSourceByModuleId),
    })
  }

  const retainedSourceKeys = new Set([...nextSourceKeys.values()].flat())
  const removedSources = new Set(
    [...previous.sources.keys()].filter((key) => !retainedSourceKeys.has(key)),
  )
  const specs = overlayMap(previous.specs, specChanges, removedSpecs)
  const payloadSources = overlayMap(previous.sources, sourceChanges, removedSources)
  const entries = previous.index.specs.map((entry) => entryChanges.get(entry.source) ?? entry)
  const generation = indexContentRevision(diagnostics, entries)
  const index: CatalogIndex = {
    format: CATALOG_INDEX_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    generation,
    snapshot: applicationSnapshot,
    specs: entries,
    diagnostics: [...diagnostics],
  }
  return {
    index,
    indexModule: createCatalogIndexModule(index, adapterManifest),
    specs,
    sources: payloadSources,
    inputs: overlayMap(previous.inputs, changedBySource, new Set()),
    projection: {
      specifications: projectedSpecifications,
      sourceKeys: expectedSources.map((source) => ({
        source,
        keys: nextSourceKeys.get(source) ?? [],
      })),
    },
    topology,
  }
}

/** Overlay independently persisted verification onto an exact restored transport snapshot. */
export function restoreCatalogSnapshotVerifications(
  previous: CatalogSnapshot,
  records: readonly {
    readonly source: string
    readonly revision: string
    readonly verification: ViewerQualification
  }[],
  adapterManifest: ViewerAdapterManifest,
): CatalogSnapshot {
  if (!currentTransportSnapshot(previous)) {
    throw new Error('Catalog snapshot transport is not supported.')
  }
  const bySource = new Map(records.map((record) => [record.source, record]))
  const changes = new Map<string, CatalogSpecPayload>()
  const removed = new Set<string>()
  const entries = previous.index.specs.map((entry) => {
    const record = bySource.get(entry.source)
    if (!record) return entry
    const priorKey = specPayloadKey(entry.source, entry.revision)
    const payload = previous.specs.get(priorKey)
    if (
      !payload ||
      payload.spec.verificationRevision !== record.revision ||
      payload.spec.verification !== undefined
    )
      return entry
    const spec = { ...payload.spec, verification: record.verification }
    const revision = specContentRevision(spec, payload.semanticReferences)
    changes.set(specPayloadKey(entry.source, revision), { ...payload, revision, spec })
    removed.add(priorKey)
    return { ...entry, revision, metrics: catalogSpecMetrics(spec) }
  })
  if (!changes.size) return previous
  const generation = indexContentRevision(previous.index.diagnostics, entries)
  const index = { ...previous.index, generation, specs: entries }
  return {
    ...previous,
    index,
    indexModule: createCatalogIndexModule(index, adapterManifest),
    specs: overlayMap(previous.specs, changes, removed),
  }
}

function reusablePayload(
  previous: CatalogSnapshot | undefined,
  topology: string,
  specification: ViewerSpecification,
): { readonly entry: CatalogSpecEntry; readonly payload: CatalogSpecPayload } | undefined {
  if (
    !previous ||
    previous.topology !== topology ||
    previous.inputs.get(specification.source) !== specification
  ) {
    return
  }
  const entry = previous.index.specs.find((candidate) => candidate.source === specification.source)
  if (!entry) return
  const payload = previous.specs.get(specPayloadKey(entry.source, entry.revision))
  return payload ? { entry, payload } : undefined
}

function currentTransportSnapshot(
  snapshot: CatalogSnapshot | undefined,
): snapshot is CatalogSnapshot {
  return !!snapshot &&
    snapshot.index.format === CATALOG_INDEX_FORMAT &&
    snapshot.index.version === CATALOG_TRANSPORT_VERSION
}

export function catalogProjectionTopology(
  specifications: readonly CatalogProjectionSpecification[],
): string {
  return contentRevision(specifications)
}

function projectionSpecification(
  specification: ViewerSpecification,
): CatalogProjectionSpecification {
  return {
    source: specification.source,
    modules: specification.modules.map((module) => ({
      id: module.id,
      name: module.name,
      declarationPointer: module.declarationPointer,
      ...(module.api?.model
        ? {
            api: {
              model: {
                entrypoint: module.api.model.entrypoint,
                surface: {
                  declarations: module.api.model.surface.declarations.map((declaration) => ({
                    identity: declaration.identity,
                    location: declaration.location,
                  })),
                  exports: module.api.model.surface.exports.map((item) => ({
                    declaration: item.declaration,
                    path: item.path,
                  })),
                },
              },
            },
          }
        : {}),
      imports:
        module.contract?.imports.map((item) => ({ key: item.key, source: item.source })) ?? [],
    })),
  }
}

function sourceByModule(
  specifications: readonly CatalogProjectionSpecification[],
): ReadonlyMap<string, string> {
  return new Map(
    specifications.flatMap((specification) =>
      specification.modules.map((module) => [module.id, specification.source] as const),
    ),
  )
}

function catalogContractDependencies(
  spec: ViewerSpecification,
  specSourceByModuleId: ReadonlyMap<string, string>,
): Pick<CatalogSpecEntry, 'contractDependencies'> {
  const counts = new Map<string, Set<string>>()
  for (const module of spec.modules) {
    for (const dependency of module.contract?.imports ?? []) {
      const target = specSourceByModuleId.get(dependency.source)
      if (!target || target === spec.source) continue
      const declarations = counts.get(target)
      if (declarations) declarations.add(dependency.key)
      else counts.set(target, new Set([dependency.key]))
    }
  }
  if (!counts.size) return {}
  return {
    contractDependencies: [...counts]
      .map(([source, declarations]) => ({ source, declarations: declarations.size }))
      .sort((left, right) => left.source.localeCompare(right.source)),
  }
}

function specSearchText(spec: ViewerSpecification): string {
  return [
    spec.title,
    spec.source,
    ...spec.modules.flatMap((module) => [
      ...(module.api?.model?.surface.exports.map((item) => item.path.join('.')) ?? []),
      ...module.ports.map((port) => `${port.namespace ?? ''} ${port.port.name}`),
    ]),
    ...spec.capabilities.flatMap((resource) =>
      resource.definitions.map((definition) => `${definition.id} ${definition.statement}`),
    ),
    ...spec.laws.flatMap((resource) =>
      resource.definitions.map((definition) => `${definition.id} ${definition.statement}`),
    ),
    ...spec.benchmarks.flatMap((resource) =>
      resource.definitions.map((definition) => `${definition.id} ${definition.statement}`),
    ),
    ...spec.states.flatMap((resource) =>
      resource.definitions.map((definition) => definition.exportName),
    ),
    ...(spec.layout?.entries.map((entry) => entry.path) ?? []),
    ...spec.packages.map((resource) => `${resource.package} ${resource.purpose}`),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_SEARCH_TEXT_CHARACTERS)
}

function ownedDeclarationIdentities(
  index: ReturnType<typeof indexCatalogApis>,
): ReadonlyMap<string, readonly string[]> {
  const identities = new Map<string, string[]>()
  for (const [identity, owner] of index.owner) {
    const current = identities.get(owner.spec.source)
    if (current) current.push(identity)
    else identities.set(owner.spec.source, [identity])
  }
  for (const current of identities.values()) current.sort()
  return identities
}

export function specPayloadKey(source: string, revision: string): string {
  return `${source}\0${revision}`
}

function packSpec(
  spec: ViewerSpecification,
  sourcePayloads: Map<string, CatalogSourcePayload>,
  documentReferences: ReadonlyMap<object, readonly CatalogSemanticReference[]>,
): PackedSpec {
  const modules = spec.modules.map((module) => packModule(module, sourcePayloads))
  return packModuleSpecification(spec, modules, documentReferences)
}

function packModuleSpecification(
  spec: ViewerSpecification,
  modules: readonly PackedSpecModule[],
  documentReferences: ReadonlyMap<object, readonly CatalogSemanticReference[]>,
): PackedSpec {
  return {
    ...spec,
    modules,
    ...(spec.architecture
      ? { architecture: packMarkdownResource(spec.architecture, documentReferences) }
      : {}),
    history: spec.history.map((resource) =>
      resource.document
        ? {
            ...resource,
            document: packMarkdownDocument(resource.document, documentReferences),
          }
        : resource,
    ),
    ...(spec.internal
      ? {
          internal: {
            ref: spec.internal.ref,
            source: spec.internal.source,
            text: spec.internal.text,
            revision: spec.internal.revision,
          },
        }
      : {}),
  }
}

function packMarkdownResource(
  resource: MarkdownResource,
  references: ReadonlyMap<object, readonly CatalogSemanticReference[]>,
): MarkdownResource {
  return { ...resource, document: packMarkdownDocument(resource.document, references) }
}

function packMarkdownDocument(
  document: MarkdownResource['document'],
  references: ReadonlyMap<object, readonly CatalogSemanticReference[]>,
): MarkdownResource['document'] {
  return {
    ...document,
    html: projectMarkdownHtml(document, references.get(document) ?? []),
  }
}

function packModule(
  module: ViewerSpecification['modules'][number],
  sourcePayloads: Map<string, CatalogSourcePayload>,
): PackedSpecModule {
  const { api, ports, ...rest } = module
  return {
    ...rest,
    ...(api ? { api: packDeclaration(api, sourcePayloads) } : {}),
    ports: ports.map((port) => packPort(port, sourcePayloads)),
  }
}

function packDeclaration(
  resource: DeclarationResource,
  sources: Map<string, CatalogSourcePayload>,
): PackedDeclarationResource {
  const { model, ...rest } = resource
  return {
    ...rest,
    ...(model ? { model: packModel(model, sources) } : {}),
  }
}

function packPort(
  resource: PortResource,
  sources: Map<string, CatalogSourcePayload>,
): PackedPortResource {
  const { model, ...rest } = resource
  return {
    ...rest,
    ...(model ? { model: packModel(model, sources) } : {}),
  }
}

function packModel(
  api: ApiModelV2,
  sourcePayloads: Map<string, CatalogSourcePayload>,
): PackedApiModel {
  const { sources, tokens, ...model } = api
  const tokensByFile = tokensGroupedByFile(tokens)
  const knownFiles = new Set(sources.map((source) => source.file))
  const unknownToken = tokens.find((token) => !knownFiles.has(token.file))
  if (unknownToken) {
    throw new Error(`API token source ${JSON.stringify(unknownToken.file)} is not declared.`)
  }
  const sourceKeys = sources.map((source) => {
    const sourceTokens = tokensByFile.get(source.file) ?? []
    return registerSource(source, sourceTokens, sourcePayloads)
  })
  return { ...model, sourceKeys }
}

function packedSpecSourceKeys(specification: PackedSpec): readonly string[] {
  return [
    ...new Set(
      specification.modules.flatMap((module) => [
        ...(module.api?.model?.sourceKeys ?? []),
        ...module.ports.flatMap((port) => port.model?.sourceKeys ?? []),
      ]),
    ),
  ].sort()
}

function registerSource(
  source: ApiSource,
  tokens: readonly ApiToken[],
  payloads: Map<string, CatalogSourcePayload>,
): string {
  const key = sourceContentRevision(source, tokens)
  const existing = payloads.get(key)
  if (existing) {
    if (
      safeJson({ source: existing.source, tokens: existing.tokens }) !==
      safeJson({ source, tokens })
    ) {
      throw new Error(`Declaration source digest collision for ${JSON.stringify(source.file)}.`)
    }
    return key
  }
  payloads.set(key, {
    format: CATALOG_SOURCE_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    key,
    source,
    tokens,
  })
  return key
}

function tokensGroupedByFile(tokens: readonly ApiToken[]): Map<string, ApiToken[]> {
  const output = new Map<string, ApiToken[]>()
  for (const token of tokens) {
    const entries = output.get(token.file)
    if (entries) entries.push(token)
    else output.set(token.file, [token])
  }
  return output
}

export function createCatalogIndexModule(
  index: CatalogIndex,
  manifest: ViewerAdapterManifest,
): string {
  return `export const index = JSON.parse(${JSON.stringify(safeJson(index))});\nexport const adapterManifest = JSON.parse(${JSON.stringify(safeJson(manifest))});\n`
}

function contentRevision(value: unknown): string {
  return sourceRevision(safeJson(value))
}

function sourceContentRevision(source: ApiSource, tokens: readonly ApiToken[]): string {
  return contentRevision({
    format: CATALOG_SOURCE_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    source,
    tokens,
  })
}

function specContentRevision(
  spec: PackedSpec,
  semanticReferences: CatalogSpecPayload['semanticReferences'],
): string {
  return contentRevision({
    format: CATALOG_SPEC_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    spec,
    semanticReferences,
  })
}

function indexContentRevision(
  diagnostics: CatalogIndex['diagnostics'],
  specs: CatalogIndex['specs'],
): string {
  return contentRevision({
    format: CATALOG_INDEX_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    diagnostics,
    specs,
  })
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function overlayMap<Key, Value>(
  base: ReadonlyMap<Key, Value>,
  changes: ReadonlyMap<Key, Value>,
  removed: ReadonlySet<Key>,
): ReadonlyMap<Key, Value> {
  return new OverlayMap(base, changes, removed)
}

class OverlayMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #base: ReadonlyMap<Key, Value>
  readonly #changes: ReadonlyMap<Key, Value>
  readonly #removed: ReadonlySet<Key>

  constructor(
    base: ReadonlyMap<Key, Value>,
    changes: ReadonlyMap<Key, Value>,
    removed: ReadonlySet<Key>,
  ) {
    const prior = base instanceof OverlayMap ? base : undefined
    this.#base = prior ? prior.#base : base
    const combinedChanges = new Map(prior ? prior.#changes : [])
    const combinedRemoved = new Set(prior ? prior.#removed : [])
    for (const key of removed) {
      combinedChanges.delete(key)
      if (this.#base.has(key)) combinedRemoved.add(key)
      else combinedRemoved.delete(key)
    }
    for (const [key, value] of changes) {
      combinedRemoved.delete(key)
      combinedChanges.set(key, value)
    }
    this.#changes = combinedChanges
    this.#removed = combinedRemoved
  }

  get size(): number {
    return [...this.keys()].length
  }

  get(key: Key): Value | undefined {
    if (this.#changes.has(key)) return this.#changes.get(key)
    return this.#removed.has(key) ? undefined : this.#base.get(key)
  }

  has(key: Key): boolean {
    return this.#changes.has(key) || (!this.#removed.has(key) && this.#base.has(key))
  }

  *keys(): MapIterator<Key> {
    const emitted = new Set<Key>()
    for (const key of this.#base.keys()) {
      if (this.#removed.has(key) || this.#changes.has(key)) continue
      emitted.add(key)
      yield key
    }
    for (const key of this.#changes.keys()) {
      if (emitted.has(key)) continue
      yield key
    }
  }

  *values(): MapIterator<Value> {
    for (const key of this.keys()) yield this.get(key)!
  }

  *entries(): MapIterator<[Key, Value]> {
    for (const key of this.keys()) yield [key, this.get(key)!]
  }

  forEach(
    callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this)
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.entries()
  }
}
