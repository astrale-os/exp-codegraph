import type {
  VerificationAdapter,
  VerificationRun,
  VerificationRunOptions,
} from '../../application/interaction/qualification.ts'

import {
  VERIFICATION_HEADER,
  VERIFICATION_PROTOCOL,
  VerificationAdapterError,
} from '../../application/interaction/qualification.ts'
import { parseVerificationResponse } from './verification-response.ts'

export function httpVerificationAdapter(endpoint: string): VerificationAdapter {
  return {
    async run(request: VerificationRun, options: VerificationRunOptions = {}) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [VERIFICATION_HEADER]: '1',
        },
        body: JSON.stringify({ protocol: VERIFICATION_PROTOCOL, ...request }),
        signal: options.signal,
      })
      return parseVerificationResponse(await responseJson(response), response, request)
    },
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `Verification adapter returned a non-JSON HTTP ${response.status} response.`,
      { cause: error },
    )
  }
}
