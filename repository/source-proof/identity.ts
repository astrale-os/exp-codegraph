import { createHash } from 'node:crypto'

import type { SourceProof, SourceProofId } from './model.ts'

/** Create one canonical path-independent source proof identity. */
export function createSourceProof(input: Omit<SourceProof, 'id'>): SourceProof {
  const scope = {
    ...input.scope,
    exclude: [...new Set(input.scope.exclude)].sort(),
  }
  const overlay = [...input.overlay].sort(compareOverlay)
  const changedPaths = [...new Set(input.changedPaths)].sort()
  const value = {
    ...input,
    scope,
    overlay,
    changedPaths,
  }
  const id = `source-proof:${createHash('sha256')
    .update('astrale.codegraph.source-proof\0')
    .update(stableJson(value))
    .digest('hex')}` as SourceProofId
  return immutable({ ...value, id })
}

function compareOverlay(
  left: SourceProof['overlay'][number],
  right: SourceProof['overlay'][number],
): number {
  return left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
  return Object.freeze(value)
}
