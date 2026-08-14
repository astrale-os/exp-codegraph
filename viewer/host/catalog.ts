import type { ApiModelV2 } from '../../api/model.ts'
import type { DeclarationResource, PortResource } from '../../specification/resource/index.ts'
import type { ViewerSpecificationModule } from '../../viewer-host/specification.ts'
import type {
  CatalogSourcePayload,
  CatalogSpecEntry,
  CatalogSpecPayload,
  PackedApiModel,
  PackedDeclarationResource,
  PackedPortResource,
  PackedSpecModule,
  ViewerSpecification,
} from '../../viewer-host/catalog.ts'

import {
  CATALOG_SOURCE_ENDPOINT,
  CATALOG_SOURCE_FORMAT,
  CATALOG_SPEC_ENDPOINT,
  CATALOG_SPEC_FORMAT,
  CATALOG_TRANSPORT_VERSION,
} from '../../viewer-host/catalog.ts'

export interface CatalogLoader {
  load(entry: CatalogSpecEntry): Promise<ViewerSpecification>
}

export interface HttpCatalogLoaderOptions {
  readonly fetch?: typeof fetch
  readonly specCapacity?: number
  readonly sourceCapacity?: number
}

/** Load and hydrate immutable Spec payloads while sharing declaration sources across revisions. */
export function createHttpCatalogLoader(options: HttpCatalogLoaderOptions = {}): CatalogLoader {
  const fetchPayload = options.fetch ?? fetch
  const specs = new Map<string, Promise<ViewerSpecification>>()
  const sources = new Map<string, Promise<CatalogSourcePayload>>()
  const specCapacity = positiveInteger(options.specCapacity, 64)
  const sourceCapacity = positiveInteger(options.sourceCapacity, 512)

  return {
    load(entry) {
      const identity = `${entry.source}\0${entry.revision}`
      return cached(specs, identity, specCapacity, async () => {
        const payload = await requestJson(
          fetchPayload,
          `${CATALOG_SPEC_ENDPOINT}?${new URLSearchParams({
            source: entry.source,
            revision: entry.revision,
          })}`,
        )
        assertSpecPayload(payload, entry)
        return hydrateSpec(payload, (key) =>
          cached(sources, key, sourceCapacity, async () => {
            const source = await requestJson(
              fetchPayload,
              `${CATALOG_SOURCE_ENDPOINT}?${new URLSearchParams({ key })}`,
            )
            assertSourcePayload(source, key)
            return source
          }),
        )
      })
    },
  }
}

async function hydrateSpec(
  payload: CatalogSpecPayload,
  source: (key: string) => Promise<CatalogSourcePayload>,
): Promise<ViewerSpecification> {
  const { modules, ...spec } = payload.spec
  return {
    ...spec,
    modules: await Promise.all(modules.map((module) => hydrateModule(module, source))),
    ...(payload.semanticReferences ? { semanticReferences: payload.semanticReferences } : {}),
  }
}

async function hydrateModule(
  module: PackedSpecModule,
  source: (key: string) => Promise<CatalogSourcePayload>,
): Promise<ViewerSpecificationModule> {
  const { api, ports, ...rest } = module
  return {
    ...rest,
    ...(api ? { api: await hydrateDeclaration(api, source) } : {}),
    ports: await Promise.all(ports.map((port) => hydratePort(port, source))),
  }
}

async function hydrateDeclaration(
  resource: PackedDeclarationResource,
  source: (key: string) => Promise<CatalogSourcePayload>,
): Promise<DeclarationResource> {
  const { model, ...declaration } = resource
  return {
    ...declaration,
    ...(model ? { model: await hydrateModel(model, source) } : {}),
  }
}

async function hydratePort(
  resource: PackedPortResource,
  source: (key: string) => Promise<CatalogSourcePayload>,
): Promise<PortResource> {
  const { model, ...port } = resource
  return {
    ...port,
    ...(model ? { model: await hydrateModel(model, source) } : {}),
  }
}

async function hydrateModel(
  model: PackedApiModel,
  source: (key: string) => Promise<CatalogSourcePayload>,
): Promise<ApiModelV2> {
  const { sourceKeys, ...api } = model
  const payloads = await Promise.all(sourceKeys.map(source))
  return {
    ...api,
    sources: payloads.map((payload) => payload.source),
    tokens: payloads.flatMap((payload) => payload.tokens),
  }
}

async function requestJson(fetchPayload: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchPayload(url, { cache: 'force-cache', credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`Catalog payload request failed with HTTP ${response.status}.`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new Error('Catalog payload response is not valid JSON.', { cause: error })
  }
}

function assertSpecPayload(
  value: unknown,
  entry: CatalogSpecEntry,
): asserts value is CatalogSpecPayload {
  if (!record(value)) throw new Error('Catalog Spec payload must be an object.')
  if (value.format !== CATALOG_SPEC_FORMAT || value.version !== CATALOG_TRANSPORT_VERSION) {
    throw new Error('Catalog Spec payload protocol is not supported.')
  }
  if (
    value.source !== entry.source ||
    value.revision !== entry.revision ||
    value.snapshot !== entry.snapshot ||
    !record(value.spec) ||
    (value.semanticReferences !== undefined && !record(value.semanticReferences))
  ) {
    throw new Error('Catalog Spec payload does not match its requested identity.')
  }
}

function assertSourcePayload(value: unknown, key: string): asserts value is CatalogSourcePayload {
  if (!record(value)) throw new Error('Catalog declaration source payload must be an object.')
  if (value.format !== CATALOG_SOURCE_FORMAT || value.version !== CATALOG_TRANSPORT_VERSION) {
    throw new Error('Catalog declaration source protocol is not supported.')
  }
  if (value.key !== key || !record(value.source) || !Array.isArray(value.tokens)) {
    throw new Error('Catalog declaration source payload does not match its requested identity.')
  }
}

function cached<Key, Value>(
  entries: Map<Key, Promise<Value>>,
  key: Key,
  capacity: number,
  load: () => Promise<Value>,
): Promise<Value> {
  const existing = entries.get(key)
  if (existing) {
    remember(entries, key, existing)
    return existing
  }
  const pending = load()
  entries.set(key, pending)
  void pending.then(
    () => prune(entries, capacity),
    () => entries.delete(key),
  )
  return pending
}

function remember<Key, Value>(entries: Map<Key, Value>, key: Key, value: Value): void {
  entries.delete(key)
  entries.set(key, value)
}

function prune<Key, Value>(entries: Map<Key, Value>, capacity: number): void {
  while (entries.size > capacity) entries.delete(entries.keys().next().value!)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}
