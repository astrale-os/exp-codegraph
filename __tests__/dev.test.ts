import { access, readFile, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { ViewerSpecification } from '../viewer-host/specification.ts'
import type { CatalogSpecEntry, CatalogSpecPayload } from '../viewer-host/catalog.ts'

import { SOURCE_EDIT_ENDPOINT, SOURCE_EDIT_PROTOCOL } from '../application/interaction/editing.ts'
import {
  SPEC_REVEAL_ENDPOINT,
  SPEC_REVEAL_HEADER,
  SPEC_REVEAL_PROTOCOL,
} from '../application/interaction/reveal.ts'
import { startDev, type RunningDevServer } from '../server/index.ts'
import { DEV_SERVER_WATCH_IGNORES } from '../server/watch.ts'
import {
  VERIFICATION_ENDPOINT,
  VERIFICATION_HEADER,
  VERIFICATION_PROTOCOL,
} from '../application/interaction/qualification.ts'
import { CATALOG_SOURCE_ENDPOINT, CATALOG_SPEC_ENDPOINT } from '../viewer-host/catalog.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []
const servers: RunningDevServer[] = []

function identityValue(name: string): string {
  return `/** @conformance identity */\nexport type ${name} = unknown`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((item) => item.close()))
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
})

describe('universal specification dev server', () => {
  it('serves Mermaid through its browser-native ESM graph', async () => {
    const current = await fixture(conventionFiles('alpha', 'Alpha'))
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    const rendererResponse = await fetch(`${running.url}/markdown/mermaid.ts`)
    expect(rendererResponse.status).toBe(200)
    const renderer = await rendererResponse.text()
    const browserModule = renderer.match(/import\("([^"]*\/mermaid\.esm\.min\.mjs[^"]*)"\)/)?.[1]
    expect(browserModule).toBeDefined()

    const moduleResponse = await fetch(new URL(browserModule!, running.url))
    expect(moduleResponse.status).toBe(200)
    const module = await moduleResponse.text()
    expect(module).not.toContain('/dayjs/dayjs.min.js')

    const markdownDependency = fileURLToPath(import.meta.resolve('mdast-util-from-markdown'))
    const markdownResponse = await fetch(`${running.url}/@fs/${encodeURI(markdownDependency)}`)
    expect(markdownResponse.status).toBe(200)
    expect(await markdownResponse.text()).toContain('fromMarkdown')
  })

  it('serves on loopback and denies foreign hosts and filesystem escapes', async () => {
    const external = await fixture({ 'secret.txt': 'not served' })
    const current = await fixture(conventionFiles('alpha', 'Alpha'))
    fixtures.push(external, current)
    await symlink(external.root, join(current.root, 'outside'))

    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(running.server.httpServer?.address()).toMatchObject({ address: '127.0.0.1' })
    const page = await fetch(running.url)
    expect(page.status).toBe(200)
    expect(page.headers.get('access-control-allow-origin')).toBeNull()
    expect(await page.text()).toContain('Live, validated specification viewer')
    expect(await requestStatus(running.url, 'example.test')).toBe(403)

    const escaped = await fetch(`${running.url}/@fs/etc/passwd`)
    expect(escaped.status).toBe(403)
    await escaped.text()

    const linkedPath = join(current.root, 'outside', 'secret.txt')
    const linked = await fetch(`${running.url}/@fs/${encodeURI(linkedPath)}`)
    expect(linked.status).toBe(403)
    await linked.text()
  })

  it('honors port zero, removes its temporary cache, and rejects file roots', async () => {
    const current = await fixture({
      ...conventionFiles('alpha', 'Alpha'),
      'not-a-root': 'plain file',
    })
    fixtures.push(current)

    const running = await startDev({ root: current.root, port: 0, cache: false })
    const cache = running.server.config.cacheDir
    expect(cache).toContain('astrale-spec-vite-')
    expect(running.server.config.server.watch.ignored).toEqual(
      expect.arrayContaining([...DEV_SERVER_WATCH_IGNORES]),
    )
    await access(cache)
    await running.close()
    await expect(access(cache)).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(
      startDev({ root: join(current.root, 'not-a-root'), port: 0, cache: false }),
    ).rejects.toThrow('Root must be a directory.')
  })

  it('advertises only built-in local adapters and rejects unauthorized requests', async () => {
    const current = await fixture(conventionFiles('alpha', 'Alpha'))
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    expect(live.adapterManifest).toEqual({
      editing: {
        transport: 'http',
        protocol: SOURCE_EDIT_PROTOCOL,
        endpoint: expect.stringMatching(/^\/__astrale\/spec-source\?snapshot=application%3A[a-f\d]{64}$/u),
      },
      reveal: {
        transport: 'http',
        protocol: SPEC_REVEAL_PROTOCOL,
        endpoint: expect.stringMatching(/^\/__astrale\/spec-reveal\?snapshot=application%3A[a-f\d]{64}$/u),
      },
      verification: {
        transport: 'http',
        protocol: VERIFICATION_PROTOCOL,
        endpoint: expect.stringMatching(/^\/__astrale\/spec-verification\?snapshot=application%3A[a-f\d]{64}$/u),
      },
    })
    expect(live.renderers).toBeUndefined()

    const revealWithoutHeader = await fetch(
      `${running.url}${SPEC_REVEAL_ENDPOINT}?source=${encodeURIComponent('alpha/.spec/api.d.ts')}`,
      { method: 'POST' },
    )
    expect(revealWithoutHeader.status).toBe(403)

    const foreignOrigin = await fetch(
      `${running.url}${SPEC_REVEAL_ENDPOINT}?source=${encodeURIComponent('alpha/.spec/api.d.ts')}`,
      {
        method: 'POST',
        headers: { [SPEC_REVEAL_HEADER]: '1', origin: 'https://example.test' },
      },
    )
    expect(foreignOrigin.status).toBe(403)
  })

  it('serves exact immutable Spec and shared declaration-source payloads', async () => {
    const current = await fixture(moduleVerificationFiles())
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    const entry = live.index.specs[0] as CatalogSpecEntry
    const specResponse = await fetch(specPayloadUrl(running.url, entry))
    expect(specResponse.status).toBe(200)
    expect(specResponse.headers.get('cache-control')).toContain('immutable')
    expect(specResponse.headers.get('etag')).toBe(`"${entry.revision}"`)
    const payload = (await specResponse.json()) as CatalogSpecPayload
    const sourceKey = payload.spec.modules[0]?.api?.model?.sourceKeys[0]
    expect(sourceKey).toMatch(/^[a-f\d]{64}$/)

    const sourceUrl = `${running.url}${CATALOG_SOURCE_ENDPOINT}?${new URLSearchParams({
      key: sourceKey!,
    })}`
    const sourceResponse = await fetch(sourceUrl)
    expect(sourceResponse.status).toBe(200)
    expect(sourceResponse.headers.get('cache-control')).toContain('immutable')
    expect(sourceResponse.headers.get('etag')).toBe(`"${sourceKey}"`)
    await expect(sourceResponse.json()).resolves.toMatchObject({
      key: sourceKey,
      source: { file: expect.stringContaining('.d.ts') },
      tokens: expect.any(Array),
    })

    const unchanged = await fetch(sourceUrl, { headers: { 'if-none-match': `"${sourceKey}"` } })
    expect(unchanged.status).toBe(304)
    expect(await unchanged.text()).toBe('')
  })

  it('edits only declared resources and enforces optimistic revisions', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
    })
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    const initial = await loadSpec(running.url, live.index.specs[0])
    const api = initial.modules[0]!.api!
    const next = api.text.replace('Alpha', 'Beta')
    const saved = await fetch(
      editUrl(running.url, live.index.snapshot, api.source),
      {
        method: 'PUT',
        headers: editHeaders(running.url, api.revision),
        body: next,
      },
    )
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({
      status: 'saved',
      revision: expect.stringMatching(/^[a-f\d]{64}$/),
    })
    expect(await readFile(join(current.root, api.source), 'utf8')).toBe(next)

    const stale = await fetch(
      editUrl(running.url, live.index.snapshot, api.source),
      {
        method: 'PUT',
        headers: editHeaders(running.url, api.revision),
        body: api.text,
      },
    )
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({ status: 'conflict', text: next })

    const unknown = await fetch(
      editUrl(running.url, live.index.snapshot, 'alpha/UNKNOWN.md'),
      {
        method: 'PUT',
        headers: editHeaders(running.url, api.revision),
        body: '# Unknown\n',
      },
    )
    expect(unknown.status).toBe(404)
  })

  it('runs and hot-reloads the built-in module verifier without sidecars', async () => {
    const current = await fixture(moduleVerificationFiles())
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, verify: true, cache: false })
    servers.push(running)

    const initial = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    const spec = await loadSpec(running.url, initial.index.specs[0])
    expect(spec.verification?.status, JSON.stringify(spec, null, 2)).toBe('pass')

    const oneShot = await runVerification(
      running.url,
      spec.source,
      spec.verificationRevision,
      initial.index.snapshot,
    )
    expect(oneShot.status).toBe(200)
    const completed = await oneShot.json() as {
      protocol: string
      status: string
      verification: { status: string; profiles: readonly { id: string; status: string }[] }
    }
    expect(completed).toMatchObject({
      protocol: VERIFICATION_PROTOCOL,
      status: 'completed',
      verification: { status: 'pass' },
    })
    expect(completed.verification.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'contract.module.structure', status: 'pass' }),
        expect.objectContaining({ id: 'contract.module.surface', status: 'pass' }),
        expect.objectContaining({ id: 'contract.module.dependencies', status: 'pass' }),
      ]),
    )

    const implementation = join(current.root, 'module/index.ts')
    await writeFile(implementation, 'export const drift = true\n')
    running.server.watcher.emit('change', implementation)
    await expect
      .poll(
        async () => {
          const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
          return live.index.specs[0].metrics.status
        },
        { timeout: 5_000 },
      )
      .toBe('fail')

    const staleReveal = await fetch(
      `${running.url}${SPEC_REVEAL_ENDPOINT}?${new URLSearchParams({
        snapshot: initial.index.snapshot,
        source: spec.source,
      })}`,
      {
        method: 'POST',
        headers: { [SPEC_REVEAL_HEADER]: '1', origin: running.url },
      },
    )
    expect(staleReveal.status).toBe(409)
    await expect(staleReveal.json()).resolves.toMatchObject({
      protocol: SPEC_REVEAL_PROTOCOL,
      status: 'rejected',
      code: 'SNAPSHOT_CHANGED',
    })

    await writeFile(implementation, 'export type Thing = string\n')
    running.server.watcher.emit('change', implementation)
    await expect
      .poll(
        async () => {
          const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
          return live.index.specs[0].metrics.status
        },
        { timeout: 5_000 },
      )
      .toBe('pass')
  }, 30_000)

  it('publishes every dependent Spec revision together and retains the previous generation', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts':
        "import type { Shared } from '../../shared/.spec/shared.js'\nexport interface Alpha { readonly shared: Shared }\n",
      'beta/.spec/api.d.ts':
        "import type { Shared } from '../../shared/.spec/shared.js'\nexport interface Beta { readonly shared: Shared }\n",
      'shared/.spec/shared.d.ts': 'export interface Shared { readonly value: string }\n',
    })
    fixtures.push(current)
    const running = await startDev({ root: current.root, port: 0, cache: false })
    servers.push(running)

    const initial = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    const before = new Map(
      (initial.index.specs as CatalogSpecEntry[]).map((entry) => [entry.source, entry]),
    )
    const shared = join(current.root, 'shared/.spec/shared.d.ts')
    await writeFile(shared, 'export interface Shared { readonly value: number }\n')
    running.server.watcher.emit('change', shared)

    await expect
      .poll(
        async () => {
          const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
          return live.index.generation
        },
        { timeout: 10_000 },
      )
      .not.toBe(initial.index.generation)

    const updated = await running.server.ssrLoadModule('virtual:spec-catalog-index')
    for (const entry of updated.index.specs as CatalogSpecEntry[]) {
      expect(entry.revision).not.toBe(before.get(entry.source)?.revision)
    }
    for (const entry of before.values()) {
      const retained = await fetch(specPayloadUrl(running.url, entry))
      expect(retained.status).toBe(200)
      await retained.body?.cancel()
    }
  }, 30_000)
})

async function loadSpec(url: string, entry: CatalogSpecEntry): Promise<ViewerSpecification> {
  const response = await fetch(specPayloadUrl(url, entry))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('immutable')
  const payload = (await response.json()) as { spec: ViewerSpecification }
  return payload.spec
}

function specPayloadUrl(url: string, entry: CatalogSpecEntry): string {
  return `${url}${CATALOG_SPEC_ENDPOINT}?${new URLSearchParams({
    source: entry.source,
    revision: entry.revision,
  })}`
}

async function requestStatus(url: string, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url)
    const call = request(
      {
        hostname: requestUrl.hostname,
        port: requestUrl.port,
        path: '/',
        headers: { host },
      },
      (response) => {
        response.resume()
        resolve(response.statusCode)
      },
    )
    call.once('error', reject)
    call.end()
  })
}

function editHeaders(origin: string, revision: string): Record<string, string> {
  return {
    'content-type': 'text/plain; charset=utf-8',
    'if-match': `"${revision}"`,
    'x-astrale-spec-edit': '1',
    origin,
  }
}

function runVerification(
  origin: string,
  source: string,
  revision: string,
  snapshot: string,
): Promise<Response> {
  return fetch(`${origin}${VERIFICATION_ENDPOINT}?${new URLSearchParams({ snapshot })}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [VERIFICATION_HEADER]: '1',
      origin,
    },
    body: JSON.stringify({ protocol: VERIFICATION_PROTOCOL, source, revision }),
  })
}

function editUrl(origin: string, snapshot: string, source: string): string {
  return `${origin}${SOURCE_EDIT_ENDPOINT}?${new URLSearchParams({ snapshot, source })}`
}

function moduleVerificationFiles(): Record<string, string> {
  const files = {
    'module/package.json': JSON.stringify({
      name: '@fixture/dev-module',
      type: 'module',
      exports: { '.': './index.ts' },
    }),
    'module/tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
      },
      include: ['*.ts'],
    }),
    'module/index.ts': 'export type Thing = string\n',
    'module/.spec/api.d.ts': `${identityValue('Thing')}\n`,
  }
  return files
}

function conventionFiles(directory: string, name: string): Record<string, string> {
  return { [`${directory}/.spec/api.d.ts`]: `export interface ${name} {}\n` }
}
