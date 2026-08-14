import type { IncomingMessage, ServerResponse } from 'node:http'

import type { SpecRevealResponse } from '../reveal.ts'

import { SPEC_REVEAL_ENDPOINT, SPEC_REVEAL_HEADER, SPEC_REVEAL_PROTOCOL } from '../reveal.ts'

export async function handleSpecRevealHttp(
  request: IncomingMessage,
  response: ServerResponse,
  execute: (source: string, snapshot: `application:${string}`) => Promise<SpecRevealResponse>,
): Promise<boolean> {
  if (!request.url) return false
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname !== SPEC_REVEAL_ENDPOINT) return false

  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    reject(response, 405, 'REQUEST_INVALID', 'Method not allowed.')
    return true
  }
  if (request.headers[SPEC_REVEAL_HEADER] !== '1') {
    reject(response, 403, 'REQUEST_INVALID', 'Reveal header missing.')
    return true
  }
  if (!sameOrigin(request)) {
    reject(response, 403, 'REQUEST_INVALID', 'Cross-origin reveal is not allowed.')
    return true
  }

  const sources = url.searchParams.getAll('source')
  const snapshots = url.searchParams.getAll('snapshot')
  const unsupported = [...url.searchParams.keys()].some(
    (key) => key !== 'source' && key !== 'snapshot',
  )
  if (
    sources.length !== 1 ||
    unsupported ||
    sources[0]!.length === 0 ||
    sources[0]!.includes('\0') ||
    snapshots.length !== 1 ||
    !/^application:[a-f\d]{64}$/u.test(snapshots[0]!)
  ) {
    reject(response, 400, 'REQUEST_INVALID', 'Exactly one specification source is required.')
    return true
  }

  try {
    const result = await execute(sources[0]!, snapshots[0]! as `application:${string}`)
    send(response, result.status === 'revealed' ? 200 : statusOf(result.code), result)
  } catch (error) {
    reject(response, 500, 'REVEAL_FAILED', error instanceof Error ? error.message : String(error))
  }
  return true
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function statusOf(code: Exclude<SpecRevealResponse, { status: 'revealed' }>['code']): number {
  if (code === 'SOURCE_NOT_FOUND') return 404
  if (code === 'SNAPSHOT_CHANGED') return 409
  if (code === 'REQUEST_INVALID') return 400
  return 500
}

function reject(
  response: ServerResponse,
  status: number,
  code: Exclude<SpecRevealResponse, { status: 'revealed' }>['code'],
  message: string,
): void {
  send(response, status, { protocol: SPEC_REVEAL_PROTOCOL, status: 'rejected', code, message })
}

function send(response: ServerResponse, status: number, value: SpecRevealResponse): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}
