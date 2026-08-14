import type {
  SpecRevealAdapter,
  SpecRevealOptions,
  SpecRevealRequest,
  SpecRevealResponse,
} from '../../application/interaction/reveal.ts'

import {
  SPEC_REVEAL_HEADER,
  SPEC_REVEAL_PROTOCOL,
  SpecRevealAdapterError,
} from '../../application/interaction/reveal.ts'

export function httpSpecRevealAdapter(endpoint: string): SpecRevealAdapter {
  return {
    async reveal(request: SpecRevealRequest, options: SpecRevealOptions = {}) {
      const response = await fetch(withParameter(endpoint, 'source', request.source), {
        method: 'POST',
        headers: { [SPEC_REVEAL_HEADER]: '1' },
        signal: options.signal,
      })
      const result = normalizeResponse(await responseJson(response))
      if (!response.ok || result.status === 'rejected') {
        throw new SpecRevealAdapterError(
          result.status === 'rejected' ? result.code : 'RESPONSE_INVALID',
          result.status === 'rejected'
            ? result.message
            : `Reveal adapter returned HTTP ${response.status}.`,
        )
      }
      if (result.source !== request.source) {
        throw new SpecRevealAdapterError(
          'RESPONSE_MISMATCH',
          'Reveal adapter returned another spec.',
        )
      }
    },
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new SpecRevealAdapterError(
      'RESPONSE_INVALID',
      `Reveal adapter returned a non-JSON HTTP ${response.status} response.`,
      { cause: error },
    )
  }
}

function normalizeResponse(value: unknown): SpecRevealResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  if (input.protocol !== SPEC_REVEAL_PROTOCOL) invalid()
  if (input.status === 'revealed') {
    exactKeys(input, new Set(['protocol', 'status', 'source']))
    if (typeof input.source !== 'string' || !input.source) invalid()
    return { protocol: SPEC_REVEAL_PROTOCOL, status: 'revealed', source: input.source }
  }
  if (input.status === 'rejected') {
    exactKeys(input, new Set(['protocol', 'status', 'code', 'message']))
    if (
      !['REQUEST_INVALID', 'SNAPSHOT_CHANGED', 'SOURCE_NOT_FOUND', 'REVEAL_FAILED'].includes(String(input.code)) ||
      typeof input.message !== 'string' ||
      !input.message
    ) {
      invalid()
    }
    return {
      protocol: SPEC_REVEAL_PROTOCOL,
      status: 'rejected',
      code: input.code as Extract<SpecRevealResponse, { status: 'rejected' }>['code'],
      message: input.message,
    }
  }
  return invalid()
}

function withParameter(endpoint: string, name: string, value: string): string {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid()
}

function invalid(): never {
  throw new SpecRevealAdapterError(
    'RESPONSE_INVALID',
    'Reveal adapter returned an invalid response.',
  )
}
