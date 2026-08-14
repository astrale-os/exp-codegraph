import { afterEach, describe, expect, it, vi } from 'vitest'

import { SOURCE_EDIT_HEADER, SOURCE_EDIT_PROTOCOL } from '../application/interaction/editing.ts'
import { SPEC_REVEAL_HEADER, SPEC_REVEAL_PROTOCOL } from '../application/interaction/reveal.ts'
import { VERIFICATION_HEADER, VERIFICATION_PROTOCOL } from '../application/interaction/qualification.ts'
import { adaptersFromManifest } from '../viewer/host/adapters.ts'
import { httpSourceEditAdapter } from '../viewer/host/editing-http.ts'
import { httpSpecRevealAdapter } from '../viewer/host/reveal-http.ts'
import { httpVerificationAdapter } from '../viewer/host/verification-http.ts'

afterEach(() => vi.unstubAllGlobals())

describe('reveal adapter', () => {
  it('resolves the host capability and validates the revealed specification', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/reveal?source=alpha%2F.spec%2Fapi.d.ts')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get(SPEC_REVEAL_HEADER)).toBe('1')
      return Response.json({
        protocol: SPEC_REVEAL_PROTOCOL,
        status: 'revealed',
        source: 'alpha/.spec/api.d.ts',
      })
    })
    vi.stubGlobal('fetch', fetch)
    const adapter = adaptersFromManifest({
      reveal: {
        transport: 'http',
        protocol: SPEC_REVEAL_PROTOCOL,
        endpoint: '/reveal',
      },
    }).reveal

    await expect(adapter?.reveal({ source: 'alpha/.spec/api.d.ts' })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects malformed and mismatched host responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          protocol: SPEC_REVEAL_PROTOCOL,
          status: 'revealed',
          source: 'other/.spec/api.d.ts',
        }),
      ),
    )
    await expect(
      httpSpecRevealAdapter('/reveal').reveal({ source: 'alpha/.spec/api.d.ts' }),
    ).rejects.toMatchObject({ code: 'RESPONSE_MISMATCH' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'revealed' })),
    )
    await expect(
      httpSpecRevealAdapter('/reveal').reveal({ source: 'alpha/.spec/api.d.ts' }),
    ).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
})

describe('verification adapter', () => {
  it('resolves an HTTP manifest and returns a validated verification result', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { source: string; revision: string }
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get(VERIFICATION_HEADER)).toBe('1')
      return Response.json({
        protocol: VERIFICATION_PROTOCOL,
        status: 'completed',
        ...request,
        verification: {
          status: 'pass',
          profiles: [
            {
              id: 'custom.behavior',
              provider: 'custom.verifier.mjs',
              status: 'pass',
              target: {
                id: 'source',
                adapter: 'typescript',
                project: 'tsconfig.json',
                root: 'src',
                entrypoint: 'src/index.ts',
                aliases: ['src/v1.ts'],
                internals: ['src/shared.ts'],
              },
              evidence: {
                proof: {
                  exactDeclarations: [{ id: 'Service', label: 'Service · interface' }],
                  identityDeclarations: [{ id: 'Payload', label: 'Payload · value' }],
                  unprovenObservations: [
                    {
                      code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
                      message: 'Implementation type was not evaluated.',
                      severity: 'info',
                    },
                  ],
                },
              },
              rules: [{ id: 'contract', status: 'pass', diagnostics: [] }],
            },
          ],
          rules: [{ id: 'contract', status: 'pass', diagnostics: [] }],
          dependencies: ['src'],
          durationMs: 4,
        },
      })
    })
    vi.stubGlobal('fetch', fetch)
    const adapter = adaptersFromManifest({
      verification: {
        transport: 'http',
        protocol: VERIFICATION_PROTOCOL,
        endpoint: '/verification',
      },
    }).verification

    await expect(
      adapter?.run({ source: 'alpha/.spec/api.d.ts', revision: 'a'.repeat(64) }),
    ).resolves.toEqual({
      status: 'pass',
      profiles: [
        {
          id: 'custom.behavior',
          provider: 'custom.verifier.mjs',
          status: 'pass',
          target: {
            id: 'source',
            adapter: 'typescript',
            project: 'tsconfig.json',
            root: 'src',
            entrypoint: 'src/index.ts',
            aliases: ['src/v1.ts'],
            internals: ['src/shared.ts'],
          },
          evidence: {
            proof: {
              exactDeclarations: [{ id: 'Service', label: 'Service · interface' }],
              identityDeclarations: [{ id: 'Payload', label: 'Payload · value' }],
              unprovenObservations: [
                {
                  code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
                  message: 'Implementation type was not evaluated.',
                  severity: 'info',
                },
              ],
            },
          },
          rules: [{ id: 'contract', status: 'pass', diagnostics: [] }],
        },
      ],
      rules: [{ id: 'contract', status: 'pass', diagnostics: [] }],
      dependencies: ['src'],
      durationMs: 4,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects host errors and mismatched results without exposing transport details to the viewer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            protocol: VERIFICATION_PROTOCOL,
            status: 'rejected',
            code: 'SOURCE_CHANGED',
            message: 'Specification source changed.',
          },
          { status: 409 },
        ),
      ),
    )
    const adapter = httpVerificationAdapter('/verification')
    const rejection = adapter.run({ source: 'alpha/.spec/api.d.ts', revision: 'a'.repeat(64) })
    await expect(rejection).rejects.toMatchObject({
      code: 'SOURCE_CHANGED',
      message: 'Specification source changed.',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          protocol: VERIFICATION_PROTOCOL,
          status: 'completed',
          source: 'other/.spec/api.d.ts',
          revision: 'a'.repeat(64),
          verification: {
            status: 'pass',
            rules: [{ id: 'contract', status: 'pass', diagnostics: [] }],
            dependencies: [],
            durationMs: 1,
          },
        }),
      ),
    )
    await expect(
      adapter.run({ source: 'alpha/.spec/api.d.ts', revision: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'RESPONSE_MISMATCH' })
  })

  it('rejects internally inconsistent coverage evidence', async () => {
    const revision = 'a'.repeat(64)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          protocol: VERIFICATION_PROTOCOL,
          status: 'completed',
          source: 'alpha/.spec/api.d.ts',
          revision,
          verification: {
            status: 'fail',
            profiles: [
              {
                id: 'contract.module.surface',
                provider: 'astrale.typespec.module-surface',
                status: 'fail',
                rules: [
                  {
                    id: 'module.export.Graph.class',
                    status: 'fail',
                    diagnostics: [{ message: 'Missing.' }],
                  },
                ],
                coverage: {
                  forward: {
                    matched: 0,
                    total: 1,
                    percent: 99,
                    unmatched: [{ id: 'module.export.Graph.class', label: 'Missing.' }],
                  },
                  inverse: { matched: 0, total: 0, percent: null, unmatched: [] },
                },
              },
            ],
            rules: [
              {
                id: 'contract.module.surface/module.export.Graph.class',
                status: 'fail',
                diagnostics: [{ message: 'Missing.' }],
              },
            ],
            dependencies: [],
            durationMs: 1,
          },
        }),
      ),
    )

    await expect(
      httpVerificationAdapter('/verification').run({ source: 'alpha/.spec/api.d.ts', revision }),
    ).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
})

describe('editing adapter', () => {
  it('resolves the host manifest and preserves optimistic concurrency', async () => {
    const revision = 'a'.repeat(64)
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/editing?source=alpha%2F.spec%2Fapi.d.ts')
      expect(init?.method).toBe('PUT')
      const headers = new Headers(init?.headers)
      expect(headers.get(SOURCE_EDIT_HEADER)).toBe('1')
      expect(headers.get('if-match')).toBe(`"${revision}"`)
      expect(init?.body).toBe('export interface Beta {}\n')
      return Response.json({ status: 'saved', revision: 'b'.repeat(64) })
    })
    vi.stubGlobal('fetch', fetch)
    const adapter = adaptersFromManifest({
      editing: {
        transport: 'http',
        protocol: SOURCE_EDIT_PROTOCOL,
        endpoint: '/editing',
      },
    }).editing

    await expect(
      adapter?.save({
        source: 'alpha/.spec/api.d.ts',
        revision,
        text: 'export interface Beta {}\n',
      }),
    ).resolves.toEqual({ status: 'saved', revision: 'b'.repeat(64) })
  })

  it('rejects malformed host responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'saved', revision: 'bad' })),
    )
    await expect(
      httpSourceEditAdapter('/editing').save({
        source: 'alpha/.spec/api.d.ts',
        revision: 'a'.repeat(64),
        text: 'export interface Beta {}\n',
      }),
    ).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
})
