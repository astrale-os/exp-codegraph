import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from 'node:zlib'

import { canonicalJson } from './validation.ts'

export const WORKSPACE_CHECKPOINT_JSON_ENCODING = 'br-json/1' as const

export interface WorkspaceCheckpointJsonOptions {
  readonly maximumDecodedBytes: number
}

export interface WorkspaceCheckpointJsonArtifact<Value = unknown> {
  readonly value: Value
  readonly decodedBytes: number
}

/** Deterministically encode one independently bounded JSON checkpoint artifact. */
export function encodeWorkspaceCheckpointJson(
  value: unknown,
  options: WorkspaceCheckpointJsonOptions,
): WorkspaceCheckpointJsonArtifact<Uint8Array> {
  const maximumDecodedBytes = positiveLimit(options.maximumDecodedBytes)
  const json = canonicalJson(value)
  const decoded = Buffer.from(json, 'utf8')
  if (decoded.byteLength > maximumDecodedBytes) {
    throw new RangeError('Checkpoint JSON exceeds maximumDecodedBytes.')
  }
  return {
    value: brotliCompressSync(decoded, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 2,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: decoded.byteLength,
      },
    }),
    decodedBytes: decoded.byteLength,
  }
}

/** Decode one checkpoint artifact while bounding expansion before JSON parsing. */
export function decodeWorkspaceCheckpointJson(
  bytes: Uint8Array,
  options: WorkspaceCheckpointJsonOptions,
): WorkspaceCheckpointJsonArtifact {
  const maximumDecodedBytes = positiveLimit(options.maximumDecodedBytes)
  const decoded = brotliDecompressSync(bytes, { maxOutputLength: maximumDecodedBytes })
  return {
    value: JSON.parse(decoded.toString('utf8')) as unknown,
    decodedBytes: decoded.byteLength,
  }
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('maximumDecodedBytes must be a positive safe integer.')
  }
  return value
}
