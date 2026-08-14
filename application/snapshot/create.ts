import { createHash } from 'node:crypto'

import type { TypeSpecApplicationSnapshot, TypeSpecApplicationSnapshotId } from '../model.ts'

export function createApplicationSnapshot(
  input: Omit<TypeSpecApplicationSnapshot, 'format' | 'version' | 'id'>,
): TypeSpecApplicationSnapshot {
  const content = {
    format: 'astrale.typespec.application' as const,
    version: 2 as const,
    ...input,
  }
  const id = `application:${createHash('sha256').update(stableJson(content)).digest('hex')}` as TypeSpecApplicationSnapshotId
  return immutable({ ...content, id })
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
  return Object.freeze(value)
}
