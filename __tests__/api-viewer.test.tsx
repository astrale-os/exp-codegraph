import { describe, expect, it, vi } from 'vitest'

import type { ApiModel } from '../api/model.ts'
import type { ViewerSpecification } from '../viewer-host/catalog.ts'

import { createCatalogSnapshot, specPayloadKey } from '../server/catalog-snapshot.ts'
import { CATALOG_SOURCE_ENDPOINT, CATALOG_SPEC_ENDPOINT } from '../viewer-host/catalog.ts'
import { createHttpCatalogLoader } from '../viewer/host/catalog.ts'
import {
  apiDefinitionTarget,
  apiOwnedDefinitionTarget,
  apiOutline,
  restoreApiNavigation,
  visibleApiSourceTabs,
} from '../viewer/specification/api.tsx'
import {
  declarationClickNavigation,
  unknownPlaceholderRanges,
  detectedThrowReferences,
} from '../viewer/specification/declaration-editor.tsx'
import { groupPorts, principalExport, supportingExports } from '../viewer/specification/ports.tsx'
import { defaultSpecTab, selectedSpecTab, specTabs } from '../viewer/specification/tabs.ts'

describe('native declaration API viewer', () => {
  it('adds the API tab only when the universal api field is populated', () => {
    const spec = apiSpec()

    expect(specTabs(spec)).toEqual(['api', 'diagnostics'])
    expect(defaultSpecTab(spec)).toBe('api')
    expect(selectedSpecTab(spec, { source: spec.source, tab: 'api' })).toBe('api')
  })

  it('derives a stable IDE outline from exported declaration identities', () => {
    expect(apiOutline(apiModel())).toEqual([
      {
        type: 'export',
        identity: 'payload',
        name: 'Payload',
        path: 'Payload',
        declarationKind: 'interface',
      },
      {
        type: 'export',
        identity: 'client',
        name: 'Client',
        path: 'Client',
        declarationKind: 'class',
      },
    ])
  })

  it('groups namespaces recursively and keeps their export counts explicit', () => {
    const model = apiModel()
    const nested: ApiModel = {
      ...model,
      surface: {
        ...model.surface,
        exports: [
          ...model.surface.exports,
          {
            path: ['graph', 'query', 'Payload'],
            name: 'Payload',
            declaration: 'payload',
            kind: 'interface',
            typeOnly: true,
            location: model.surface.exports[0]!.location,
          },
          {
            path: ['graph', 'Client'],
            name: 'Client',
            declaration: 'client',
            kind: 'class',
            typeOnly: false,
            location: model.surface.exports[0]!.location,
          },
        ],
      },
    }

    expect(
      apiOutline(nested).find((node) => node.type === 'group' && node.name === 'graph'),
    ).toMatchObject({
      type: 'group',
      name: 'graph',
      path: 'graph',
      count: 2,
      children: [
        {
          type: 'group',
          name: 'query',
          path: 'graph.query',
          count: 1,
          children: [{ type: 'export', name: 'Payload', path: 'graph.query.Payload' }],
        },
        { type: 'export', name: 'Client', path: 'graph.Client' },
      ],
    })
  })

  it('makes progressive identity-only declarations explicit in the outline', () => {
    const model = apiModel()
    const progressive: ApiModel = {
      ...model,
      metadata: {
        ...model.metadata,
        payload: { ...model.metadata.payload!, conformance: 'identity' },
      },
    }

    expect(apiOutline(progressive)[0]).toMatchObject({
      type: 'export',
      name: 'Payload',
      conformance: 'identity',
    })
    expect(apiOutline(progressive)[1]).not.toHaveProperty('conformance')
  })

  it('preserves authored namespace order instead of alphabetizing the outline', () => {
    const model = apiModel()
    const ordered: ApiModel = {
      ...model,
      surface: {
        ...model.surface,
        exports: ['schema', 'graph', 'auth', 'logs'].map((namespace) => ({
          path: ['syscalls', namespace, 'call'],
          name: 'call',
          declaration: 'client',
          kind: 'callable' as const,
          typeOnly: false,
          location: model.surface.exports[0]!.location,
        })),
      },
    }

    const syscalls = apiOutline(ordered)[0]
    expect(syscalls).toMatchObject({
      type: 'group',
      name: 'syscalls',
      children: [
        { type: 'group', name: 'schema' },
        { type: 'group', name: 'graph' },
        { type: 'group', name: 'auth' },
        { type: 'group', name: 'logs' },
      ],
    })
  })

  it('preserves authored order when exports and namespace groups are interleaved', () => {
    const model = apiModel()
    const ordered: ApiModel = {
      ...model,
      surface: {
        ...model.surface,
        exports: [
          model.surface.exports[0]!,
          {
            path: ['graph', 'query'],
            name: 'query',
            declaration: 'client',
            kind: 'callable',
            typeOnly: false,
            location: model.surface.exports[0]!.location,
          },
          model.surface.exports[1]!,
        ],
      },
    }

    expect(apiOutline(ordered)).toMatchObject([
      { type: 'export', name: 'Payload' },
      { type: 'group', name: 'graph' },
      { type: 'export', name: 'Client' },
    ])
  })

  it('visually suppresses only standalone unknown declaration placeholders', () => {
    expect(
      suppressUnknownPlaceholders(`export function defineSchema(): unknown
export type CoreEndpoint = unknown
export type Meaningful = string | unknown
export interface Box { value: unknown }
`),
    ).toBe(`export function defineSchema()
export type CoreEndpoint
export type Meaningful = string | unknown
export interface Box { value: unknown }
`)
  })

  it('underlines only error codes already detected from throws metadata', () => {
    const text = '/** @throws DECLARED_FAILURE UNKNOWN_FAILURE */\nrun(): void\n'
    const references = detectedThrowReferences(text, ['DECLARED_FAILURE'])

    expect(references).toEqual([expect.objectContaining({ code: 'DECLARED_FAILURE' })])
    expect(text.slice(references[0]!.from, references[0]!.to)).toBe('DECLARED_FAILURE')
  })

  it('keeps ordinary reference clicks local and promotes modified clicks to definitions', () => {
    expect(declarationClickNavigation('shared', undefined, false)).toEqual({
      identity: 'shared',
      intent: 'peek',
    })
    expect(declarationClickNavigation('shared', undefined, true)).toEqual({
      identity: 'shared',
      intent: 'open-definition',
    })
    expect(declarationClickNavigation(undefined, 'shared', true)).toEqual({
      identity: 'shared',
      intent: 'open-definition',
    })
    expect(declarationClickNavigation(undefined, 'shared', false)).toBeUndefined()
  })

  it('restores valid per-module API navigation and rejects drifted state', () => {
    const model = apiModel()
    const outline = apiOutline(model)

    expect(
      restoreApiNavigation(
        { source: 'alpha/api.d.ts', declaration: 'payload', expanded: ['missing'] },
        model,
        model.sources,
        outline,
      ),
    ).toEqual({ source: 'alpha/api.d.ts', declaration: 'payload', expanded: [] })
    expect(
      restoreApiNavigation(
        { source: 'removed.d.ts', declaration: 'removed', expanded: ['missing'] },
        model,
        model.sources,
        outline,
      ),
    ).toEqual({ source: 'alpha/api.d.ts', expanded: [] })
  })

  it('defaults to the declared API entrypoint when imported sources are ordered first', () => {
    const model = apiModel()
    const imported = {
      file: 'core/auth/api.d.ts',
      revision: 'imported-revision',
      text: 'export interface Identity {}\n',
    }
    const sources = [imported, ...model.sources]
    const reordered = { ...model, sources }

    expect(restoreApiNavigation(undefined, reordered, sources)).toEqual({
      source: 'alpha/api.d.ts',
      expanded: [],
    })
    expect(
      restoreApiNavigation(
        { source: 'removed.d.ts', declaration: 'removed', expanded: [] },
        reordered,
        sources,
      ),
    ).toEqual({ source: 'alpha/api.d.ts', expanded: [] })
  })

  it('pins only the API entrypoint and reveals an imported source contextually', () => {
    const model = apiModel()
    const imported = {
      file: 'shared/payload.d.ts',
      revision: 'imported-revision',
      text: 'export interface SharedPayload {}\n',
    }
    const sources = [...model.sources, imported]

    expect(visibleApiSourceTabs(model, sources, model.sources[0]!)).toEqual([
      { source: model.sources[0], role: 'entrypoint' },
    ])
    expect(visibleApiSourceTabs(model, sources, imported)).toEqual([
      { source: model.sources[0], role: 'entrypoint' },
      { source: imported, role: 'imported' },
    ])
    expect(visibleApiSourceTabs(model, sources, model.sources[0]!, true)).toEqual([])
    expect(visibleApiSourceTabs(model, sources, imported, true)).toEqual([
      { source: model.sources[0], role: 'entrypoint' },
      { source: imported, role: 'imported' },
    ])
  })

  it('targets an imported declaration by exact catalog ownership', () => {
    const model = apiModel()
    const importedFile = 'shared/payload.d.ts'
    const importedIdentity = `${importedFile}:interface:Payload`
    const imported: ApiModel = {
      ...model,
      sources: [
        ...model.sources,
        {
          file: importedFile,
          revision: 'imported-revision',
          text: 'export interface Payload {}\n',
        },
      ],
      tokens: [
        ...model.tokens,
        {
          file: importedFile,
          from: 17,
          to: 24,
          text: 'Payload',
          declaration: importedIdentity,
        },
      ],
    }
    const owners = new Map([[importedIdentity, { source: 'shared/.spec/api.d.ts', title: 'Shared' }]])

    expect(
      apiOwnedDefinitionTarget(imported, importedIdentity, 'consumer/.spec/api.d.ts', owners),
    ).toEqual({
      owner: { source: 'shared/.spec/api.d.ts', title: 'Shared' },
      navigation: { source: importedFile, declaration: importedIdentity, expanded: [] },
    })
    expect(
      apiDefinitionTarget(
        imported,
        { source: importedFile, declaration: importedIdentity, expanded: ['consumer'] },
        'consumer/.spec/api.d.ts',
        owners,
      ),
    ).toEqual({
      owner: { source: 'shared/.spec/api.d.ts', title: 'Shared' },
      navigation: { source: importedFile, declaration: importedIdentity, expanded: [] },
    })
    expect(
      apiDefinitionTarget(
        imported,
        { source: importedFile, declaration: importedIdentity, expanded: [] },
        'shared/.spec/api.d.ts',
        owners,
      ),
    ).toBeUndefined()
  })

  it('groups supporting declarations beneath their principal Port interface', () => {
    expect(
      supportingExports({
        ref: './payload.d.ts',
        source: 'alpha/api.d.ts',
        text: '',
        revision: 'port-revision',
        declarationPointer: '/ports/0',
        port: { name: 'Payload', declaration: 'payload' },
        model: apiModel(),
      }),
    ).toEqual([expect.objectContaining({ identity: 'client', name: 'Client', path: 'Client' })])
  })

  it('groups Port resources by semantic namespace in authored order', () => {
    const port = (ref: string, namespace?: string) => ({
      ref,
      source: `alpha/${ref}`,
      text: '',
      revision: ref,
      declarationPointer: `/ports/${ref}`,
      ...(namespace ? { namespace } : {}),
      port: { name: 'Backend', declaration: `${ref}:backend` },
    })
    const queryOne = port('query-one.d.ts', 'query')
    const queryTwo = port('query-two.d.ts', 'query')
    const standalone = port('standalone.d.ts')
    const mutation = port('mutation.d.ts', 'mutation')

    expect(groupPorts([queryOne, queryTwo, standalone, mutation])).toEqual([
      { namespace: 'query', ports: [queryOne, queryTwo] },
      { ports: [standalone] },
      { namespace: 'mutation', ports: [mutation] },
    ])
  })

  it('shows only the discovered Port interface for a namespaced resource', () => {
    expect(
      principalExport({
        ref: './query.d.ts',
        source: 'alpha/api.d.ts',
        text: '',
        revision: 'port-revision',
        declarationPointer: '/ports/0/ports/0',
        namespace: 'query',
        port: { name: 'Payload', declaration: 'payload' },
        model: apiModel(),
      }),
    ).toEqual(expect.objectContaining({ identity: 'payload', name: 'Payload' }))
  })

  it('loads one immutable Spec and shares its declaration sources by content key', async () => {
    const expected = apiSpec()
    const snapshot = createCatalogSnapshot({ specs: [expected], diagnostics: [] }, {})
    const entry = snapshot.index.specs[0]!
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), 'http://127.0.0.1')
      const payload =
        url.pathname === CATALOG_SPEC_ENDPOINT
          ? snapshot.specs.get(
              specPayloadKey(url.searchParams.get('source')!, url.searchParams.get('revision')!),
            )
          : url.pathname === CATALOG_SOURCE_ENDPOINT
            ? snapshot.sources.get(url.searchParams.get('key')!)
            : undefined
      return new Response(JSON.stringify(payload), { status: payload ? 200 : 404 })
    }) as typeof fetch
    const loader = createHttpCatalogLoader({ fetch: request })

    const loaded = await loader.load(entry)
    await loader.load(entry)

    expect(loaded).toEqual(expected)
    expect(loaded.modules[0]?.api?.text).toBe('export interface Payload {}\n')
    expect(loaded.modules[0]?.api?.model).toEqual(apiModel())
    expect(loaded.modules[0]?.api?.model?.sources[0]).toMatchObject({
      file: 'alpha/api.d.ts',
      text: 'export interface Payload {}\n',
    })
    expect(loaded.modules[0]?.api?.model?.tokens).toEqual([
      expect.objectContaining({ declaration: 'payload', text: 'Payload' }),
    ])
    expect(snapshot.indexModule).not.toContain('export interface Payload')
    expect(request).toHaveBeenCalledTimes(2)
  })
})

function apiSpec(): ViewerSpecification {
  return {
    title: 'Alpha',
    source: 'alpha/.spec/api.d.ts',
    root: 'alpha',
    modules: [
      {
        id: 'alpha/.spec/api.d.ts',
        name: 'Alpha',
        declarationPointer: '',
        api: {
          ref: './api.d.ts',
          source: 'alpha/api.d.ts',
          text: 'export interface Payload {}\n',
          revision: 'api-revision',
          model: apiModel(),
        },
        ports: [],
        packages: [],
        diagnostics: [],
      },
    ],
    contracts: [],
    verificationRevision: 'verification-revision',
    schemas: [],
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    examples: [],
    diagnostics: [],
    benchmarks: [],
    packages: [],
    packagePatterns: [],
    sourceReferences: [],
    history: [],
    historyDiagnostics: [],
    historyRevision: 'history-revision',
    specRevision: 'specification-revision',
  }
}

function suppressUnknownPlaceholders(text: string): string {
  let result = text
  for (const range of [...unknownPlaceholderRanges(text)].reverse()) {
    result = `${result.slice(0, range.from)}${result.slice(range.to)}`
  }
  return result
}

function apiModel(): ApiModel {
  const location = { file: 'alpha/api.d.ts', line: 1, column: 1 } as const
  return {
    format: 'astrale.api',
    version: 2,
    entrypoint: 'alpha/api.d.ts',
    fingerprint: 'semantic-fingerprint',
    sourceRevision: 'source-revision',
    sources: [
      {
        file: 'alpha/api.d.ts',
        revision: 'entry-revision',
        text: 'export interface Payload {}\n',
      },
    ],
    surface: {
      exports: [
        {
          path: ['Payload'],
          name: 'Payload',
          declaration: 'payload',
          kind: 'interface',
          typeOnly: true,
          location,
        },
        {
          path: ['Client'],
          name: 'Client',
          declaration: 'client',
          kind: 'class',
          typeOnly: false,
          location,
        },
      ],
      declarations: [
        {
          identity: 'payload',
          name: 'Payload',
          kind: 'interface',
          location,
          exportPaths: [['Payload']],
          referencedDeclarations: [],
          issues: [],
        },
        {
          identity: 'client',
          name: 'Client',
          kind: 'class',
          location,
          exportPaths: [['Client']],
          referencedDeclarations: [],
          issues: [],
        },
      ],
      issues: [],
    },
    metadata: {
      payload: { conformance: 'exact', errors: [] },
      client: { conformance: 'exact', errors: [] },
    },
    tokens: [{ file: 'alpha/api.d.ts', from: 17, to: 24, text: 'Payload', declaration: 'payload' }],
  }
}
