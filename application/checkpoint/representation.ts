import type {
  ApiModelV2,
  ApiSource,
  ApiToken,
} from '../../api/model.ts'
import type { SpecificationModuleSnapshot, SpecificationSnapshot } from '../../specification/index.ts'
import type {
  DeclarationResource,
  PortResource,
} from '../../specification/resource/index.ts'
import { canonicalJson, sha256 } from '../../workspace/checkpoint/validation.ts'

type SpecificationDeclarationResource = DeclarationResource<ApiModelV2>
type SpecificationPortResource = PortResource<ApiModelV2>

/** One deduplicated declaration source and all tokens attributed to that source. */
export interface PackedApiPayload {
  readonly source: ApiSource
  readonly tokens: readonly ApiToken[]
}

/** Caller-owned content-addressed payload table shared by packed snapshots. */
export type ApiPayloadStore = Map<string, PackedApiPayload>

const admittedPayloadKeys = new WeakMap<object, string>()

/** ApiModelV2 with source bodies/tokens moved to the shared payload table. */
export interface PackedApiModelV2 extends Omit<ApiModelV2, 'sources' | 'tokens'> {
  readonly sourceKeys: readonly string[]
  /** One source index per token when the original order was interleaved. */
  readonly tokenSourceIndexes?: readonly number[]
}

type PackedDeclarationResource = Omit<SpecificationDeclarationResource, 'model'> & {
  readonly model?: PackedApiModelV2
}

type PackedPortResource = Omit<SpecificationPortResource, 'model'> & {
  readonly model?: PackedApiModelV2
}

export interface PackedSpecificationModuleSnapshot
  extends Omit<SpecificationModuleSnapshot, 'api' | 'internal' | 'ports'> {
  readonly api?: PackedDeclarationResource
  readonly internal?: PackedDeclarationResource
  readonly ports: readonly PackedPortResource[]
}

export type PackedSpecificationSnapshot = Omit<SpecificationSnapshot, 'module'> & {
  readonly module: PackedSpecificationModuleSnapshot
}

/**
 * Replace every API model in a specification module with content-addressed payload references.
 *
 * The supplied map is deliberately shared by the caller: packing several snapshots into the
 * same map deduplicates identical `{ source, tokens }` payloads across API, internal, and port
 * models without making the snapshot codec depend on a storage implementation.
 */
export function packSpecificationSnapshot(
  snapshot: SpecificationSnapshot,
  payloads: ApiPayloadStore,
): PackedSpecificationSnapshot {
  const module = snapshot.module
  const { api, internal, ports, ...moduleWithoutModels } = module
  return {
    ...snapshot,
    module: {
      ...moduleWithoutModels,
      ...(api ? { api: packDeclarationResource(api, payloads) } : {}),
      ...(internal ? { internal: packDeclarationResource(internal, payloads) } : {}),
      ports: ports.map((port) => packPortResource(port, payloads)),
    },
  }
}

/** Restore all API models from their shared payload references. */
export function unpackSpecificationSnapshot(
  packed: PackedSpecificationSnapshot,
  payloads: ReadonlyMap<string, PackedApiPayload>,
): SpecificationSnapshot {
  const module = packedModule(packed)
  const { api, internal, ports, ...moduleWithoutModels } = module
  return {
    ...packed,
    module: {
      ...moduleWithoutModels,
      ...(api ? { api: unpackDeclarationResource(api, payloads) } : {}),
      ...(internal ? { internal: unpackDeclarationResource(internal, payloads) } : {}),
      ports: ports.map((port) => unpackPortResource(port, payloads)),
    },
  } as SpecificationSnapshot
}

function packDeclarationResource(
  resource: SpecificationDeclarationResource,
  payloads: ApiPayloadStore,
): PackedDeclarationResource {
  if (!resource.model) {
    const { model: _model, ...withoutModel } = resource
    return withoutModel as PackedDeclarationResource
  }
  return { ...resource, model: packApiModel(resource.model, payloads) }
}

function packPortResource(
  resource: SpecificationPortResource,
  payloads: ApiPayloadStore,
): PackedPortResource {
  if (!resource.model) {
    const { model: _model, ...withoutModel } = resource
    return withoutModel as PackedPortResource
  }
  return { ...resource, model: packApiModel(resource.model, payloads) }
}

function unpackDeclarationResource(
  resource: PackedDeclarationResource,
  payloads: ReadonlyMap<string, PackedApiPayload>,
): SpecificationDeclarationResource {
  if (!resource.model) {
    const { model: _model, ...withoutModel } = resource
    return withoutModel as SpecificationDeclarationResource
  }
  return { ...resource, model: unpackApiModel(resource.model, payloads) }
}

function unpackPortResource(
  resource: PackedPortResource,
  payloads: ReadonlyMap<string, PackedApiPayload>,
): SpecificationPortResource {
  if (!resource.model) {
    const { model: _model, ...withoutModel } = resource
    return withoutModel as SpecificationPortResource
  }
  return { ...resource, model: unpackApiModel(resource.model, payloads) }
}

function packApiModel(model: ApiModelV2, payloads: ApiPayloadStore): PackedApiModelV2 {
  const groupedTokens: ApiToken[] = []
  const sourceFiles = new Set<string>()
  for (const source of model.sources) {
    if (sourceFiles.has(source.file)) {
      throw new TypeError(`API model contains duplicate source file: ${source.file}`)
    }
    sourceFiles.add(source.file)
  }
  for (const token of model.tokens) {
    if (!sourceFiles.has(token.file)) {
      throw new TypeError(`API model token references an unknown source file: ${token.file}`)
    }
  }
  const sourceKeys = model.sources.map((source) => {
    const tokens = model.tokens.filter((token) => token.file === source.file)
    groupedTokens.push(...tokens)
    return putPayload(payloads, {
      source: { ...source },
      tokens: tokens.map((token) => ({ ...token })),
    })
  })

  const packed: PackedApiModelV2 = {
    ...withoutSourcesAndTokens(model),
    sourceKeys,
    ...(sameEntries(model.tokens, groupedTokens)
      ? {}
      : { tokenSourceIndexes: tokenSourceIndexes(model, sourceFiles) }),
  }
  return packed
}

function unpackApiModel(
  packed: PackedApiModelV2,
  payloads: ReadonlyMap<string, PackedApiPayload>,
): ApiModelV2 {
  validatePackedModel(packed)
  const sources: ApiSource[] = []
  const tokensBySource: ApiToken[][] = []
  const seenKeys = new Set<string>()
  const seenFiles = new Set<string>()
  for (const key of packed.sourceKeys) {
    if (seenKeys.has(key)) throw new TypeError(`Packed API model repeats payload key: ${key}`)
    seenKeys.add(key)
    const payload = payloadForKey(payloads, key)
    if (seenFiles.has(payload.source.file)) {
      throw new TypeError(`Packed API model repeats source file: ${payload.source.file}`)
    }
    seenFiles.add(payload.source.file)
    validatePayload(payload)
    sources.push(payload.source)
    tokensBySource.push([...payload.tokens])
  }

  const groupedTokens = tokensBySource.flatMap((tokens) => tokens)
  const indexes = packed.tokenSourceIndexes
  if (indexes === undefined) {
    return {
      ...withoutPackedSourceFields(packed),
      sources,
      tokens: groupedTokens,
    } as ApiModelV2
  }
  if (sameEntries(indexes, groupedSourceIndexes(tokensBySource))) {
    throw new TypeError('Packed API model contains redundant token order metadata.')
  }
  if (indexes.length !== groupedTokens.length) {
    throw new TypeError('Packed API model token order length does not match payload tokens.')
  }

  const cursors = tokensBySource.map(() => 0)
  const tokens: ApiToken[] = []
  for (const sourceIndex of indexes) {
    if (
      !Number.isSafeInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= tokensBySource.length
    ) {
      throw new TypeError(`Packed API model token source index is invalid: ${sourceIndex}`)
    }
    const cursor = cursors[sourceIndex]!
    const token = tokensBySource[sourceIndex]![cursor]
    if (!token) throw new TypeError('Packed API model token order over-consumes a source payload.')
    tokens.push(token)
    cursors[sourceIndex] = cursor + 1
  }
  if (cursors.some((cursor, index) => cursor !== tokensBySource[index]!.length)) {
    throw new TypeError('Packed API model token order does not consume every source token.')
  }
  return {
    ...withoutPackedSourceFields(packed),
    sources,
    tokens,
  } as ApiModelV2
}

function withoutSourcesAndTokens(model: ApiModelV2): Omit<ApiModelV2, 'sources' | 'tokens'> {
  const { sources: _sources, tokens: _tokens, ...rest } = model
  return rest
}

function withoutPackedSourceFields(
  model: PackedApiModelV2,
): Omit<PackedApiModelV2, 'sourceKeys' | 'tokenSourceIndexes'> {
  const { sourceKeys: _sourceKeys, tokenSourceIndexes: _tokenSourceIndexes, ...rest } = model
  return rest
}

function tokenSourceIndexes(model: ApiModelV2, sourceFiles: ReadonlySet<string>): readonly number[] {
  const indices = new Map(model.sources.map((source, index) => [source.file, index]))
  return model.tokens.map((token) => {
    if (!sourceFiles.has(token.file)) {
      throw new TypeError(`API model token references an unknown source file: ${token.file}`)
    }
    return indices.get(token.file)!
  })
}

function groupedSourceIndexes(tokensBySource: readonly (readonly ApiToken[])[]): readonly number[] {
  return tokensBySource.flatMap((tokens, sourceIndex) => tokens.map(() => sourceIndex))
}

function putPayload(payloads: ApiPayloadStore, payload: PackedApiPayload): string {
  validatePayload(payload)
  const serialized = canonicalPayload(payload)
  const key = sha256(Buffer.from(serialized, 'utf8'))
  if (payloads.has(key)) {
    const existing = payloads.get(key)
    if (existing === undefined || canonicalPayload(existing) !== serialized) {
      throw new TypeError(`API payload digest collision: ${key}`)
    }
    return key
  }
  payloads.set(key, payload)
  return key
}

function payloadForKey(
  payloads: ReadonlyMap<string, PackedApiPayload>,
  key: string,
): PackedApiPayload {
  const payload = payloads.get(key)
  if (payload === undefined) throw new TypeError(`API payload is missing: ${key}`)
  const admitted = admittedPayloadKeys.get(payload)
  if (admitted !== undefined) {
    if (admitted !== key) throw new TypeError(`API payload digest collision: ${key}`)
    return payload
  }
  const expected = sha256(Buffer.from(canonicalPayload(payload), 'utf8'))
  if (expected !== key) throw new TypeError(`API payload digest collision: ${key}`)
  admittedPayloadKeys.set(payload, key)
  return payload
}

function canonicalPayload(payload: PackedApiPayload): string {
  return canonicalJson({ source: payload.source, tokens: payload.tokens })
}

function validatePayload(payload: PackedApiPayload): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('API payload is invalid.')
  }
  if (
    !payload.source ||
    typeof payload.source !== 'object' ||
    typeof payload.source.file !== 'string' ||
    typeof payload.source.revision !== 'string' ||
    (payload.source.text !== undefined && typeof payload.source.text !== 'string')
  ) {
    throw new TypeError('API payload source is invalid.')
  }
  if (!Array.isArray(payload.tokens)) throw new TypeError('API payload tokens are invalid.')
  for (const token of payload.tokens) {
    if (!token || typeof token !== 'object' || typeof token.file !== 'string') {
      throw new TypeError('API payload token is invalid.')
    }
    if (token.file !== payload.source.file) {
      throw new TypeError(
        `API payload token file does not match its source: ${token.file} !== ${payload.source.file}`,
      )
    }
  }
}

function validatePackedModel(model: PackedApiModelV2): void {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new TypeError('Packed API model is invalid.')
  }
  if (model.format !== 'astrale.api' || model.version !== 2) {
    throw new TypeError('Packed API model format or version is invalid.')
  }
  if (Object.hasOwn(model, 'sources') || Object.hasOwn(model, 'tokens')) {
    throw new TypeError('Packed API model must not contain unpacked sources or tokens.')
  }
  if (!Array.isArray(model.sourceKeys) || !model.sourceKeys.every((key) => typeof key === 'string')) {
    throw new TypeError('Packed API model source keys are invalid.')
  }
  if (
    model.tokenSourceIndexes !== undefined &&
    (!Array.isArray(model.tokenSourceIndexes) ||
      !model.tokenSourceIndexes.every((index) => Number.isSafeInteger(index)))
  ) {
    throw new TypeError('Packed API model token source indexes are invalid.')
  }
}

function packedModule(snapshot: PackedSpecificationSnapshot): PackedSpecificationModuleSnapshot {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.module) {
    throw new TypeError('Packed specification snapshot module is missing.')
  }
  if (!Array.isArray(snapshot.module.ports)) {
    throw new TypeError('Packed specification snapshot ports are invalid.')
  }
  return snapshot.module
}

function sameEntries(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
