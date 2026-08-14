import type { IncomingMessage, ServerResponse } from 'node:http'

import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import type { HistoryResource } from '../specification/resource/index.ts'

import { handleHistoryResourceHttp } from '../server/history-http.ts'
import { loadHistoryResource } from '../specification/module/history.ts'
import type { ModuleFile } from '../specification/module/inventory.ts'
import { HISTORY_RESOURCE_ENDPOINT } from '../viewer-host/catalog.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('context resource HTTP', () => {
  it('serves only a catalogued revision with inert media headers and byte ranges', async () => {
    const bytes = new TextEncoder().encode('%PDF-context-fixture')
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.history/report.pdf': bytes,
    })
    fixtures.push(current)
    const resource = (await loadHistoryResource(historyFile(current.root, 'report.pdf'))).resource
    expect(resource).toBeDefined()
    const lookup = {
      resource: (source: string, revision: string) =>
        resource?.source === source && resource.revision === revision ? resource : undefined,
    }

    const complete = await request(current.root, resource!, lookup)
    const partial = await request(current.root, resource!, lookup, 'bytes=5-11')

    expect(complete.statusCode).toBe(200)
    expect(complete.headers.get('content-type')).toBe('application/pdf')
    expect(complete.headers.get('x-content-type-options')).toBe('nosniff')
    expect(complete.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(complete.headers.get('referrer-policy')).toBe('no-referrer')
    expect([...complete.body]).toEqual([...bytes])
    expect(partial.statusCode).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 5-11/${bytes.length}`)
    expect(new TextDecoder().decode(partial.body)).toBe('context')
  })

  it('refuses to serve bytes after the catalogued context revision changes', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.history/notes.txt': 'first',
    })
    fixtures.push(current)
    const resource = (await loadHistoryResource(historyFile(current.root, 'notes.txt'))).resource!
    await current.write('module/.history/notes.txt', 'other')

    const response = await request(current.root, resource, {
      resource: () => resource,
    })

    expect(response.statusCode).toBe(409)
    expect(new TextDecoder().decode(response.body)).toContain('changed')
  })

  it('never serves context text as an active SVG document', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.history/diagram.svg':
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    })
    fixtures.push(current)
    const resource = (await loadHistoryResource(historyFile(current.root, 'diagram.svg'))).resource!

    const response = await request(current.root, resource, {
      resource: () => resource,
    })

    expect(resource.presentation).toBe('text')
    expect(resource.mediaType).toBe('image/svg+xml')
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })
})

function historyFile(root: string, relative: string): ModuleFile {
  return {
    absolute: join(root, 'module/.history', relative),
    relative,
    source: `module/.history/${relative}`,
  }
}

async function request(
  root: string,
  resource: HistoryResource,
  lookup: Parameters<typeof handleHistoryResourceHttp>[3],
  range?: string,
): Promise<MockResponse> {
  const response = new MockResponse()
  const url = `${HISTORY_RESOURCE_ENDPOINT}?${new URLSearchParams({
    source: resource.source,
    revision: resource.revision,
  })}`
  await handleHistoryResourceHttp(
    { url, method: 'GET', headers: range ? { range } : {} } as IncomingMessage,
    response as unknown as ServerResponse,
    root,
    lookup,
  )
  await response.finished
  return response
}

class MockResponse extends Writable {
  statusCode = 200
  readonly headers = new Map<string, string>()
  readonly chunks: Buffer[] = []
  readonly finished: Promise<void>
  #complete!: () => void

  constructor() {
    super()
    this.finished = new Promise((resolve) => {
      this.#complete = resolve
    })
    this.once('finish', () => this.#complete())
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
    return this
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  get body(): Uint8Array {
    return Buffer.concat(this.chunks)
  }
}
