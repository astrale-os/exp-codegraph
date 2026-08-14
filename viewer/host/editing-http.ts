import type {
  SourceEditAdapter,
  SourceEditOptions,
  SourceEditRequest,
  SourceEditResponse,
} from '../../application/interaction/editing.ts'

import { SOURCE_EDIT_HEADER, SourceEditAdapterError } from '../../application/interaction/editing.ts'

export function httpSourceEditAdapter(endpoint: string): SourceEditAdapter {
  return {
    async save(request: SourceEditRequest, options: SourceEditOptions = {}) {
      const response = await fetch(withParameter(endpoint, 'source', request.source), {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'if-match': `"${request.revision}"`,
          [SOURCE_EDIT_HEADER]: '1',
        },
        body: request.text,
        signal: options.signal,
      })
      const result = normalizeResponse(await responseJson(response))
      if (result.status === 'saved' && !response.ok) {
        throw new SourceEditAdapterError(
          'RESPONSE_INVALID',
          `Editing adapter returned saved with HTTP ${response.status}.`,
        )
      }
      return result
    },
  }
}

function withParameter(endpoint: string, name: string, value: string): string {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new SourceEditAdapterError(
      'RESPONSE_INVALID',
      `Editing adapter returned a non-JSON HTTP ${response.status} response.`,
      { cause: error },
    )
  }
}

function normalizeResponse(value: unknown): SourceEditResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  if (input.status === 'saved') {
    exactKeys(input, new Set(['status', 'revision']))
    return { status: 'saved', revision: revision(input.revision) }
  }
  if (input.status === 'conflict') {
    exactKeys(input, new Set(['status', 'revision', 'text']))
    if (typeof input.text !== 'string') invalid()
    return { status: 'conflict', revision: revision(input.revision), text: input.text }
  }
  if (input.status === 'error') {
    exactKeys(input, new Set(['status', 'message']))
    if (typeof input.message !== 'string' || !input.message) invalid()
    return { status: 'error', message: input.message }
  }
  return invalid()
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/.test(value)) invalid()
  return value
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid()
}

function invalid(): never {
  throw new SourceEditAdapterError(
    'RESPONSE_INVALID',
    'Editing adapter returned an invalid response.',
  )
}
