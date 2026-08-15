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
  const id = `application:${digest(identityPreimage(content))}` as TypeSpecApplicationSnapshotId
  return immutable({ ...content, id })
}

/**
 * Compose already content-addressed children instead of duplicating their rich payloads in one
 * repository-sized JSON string. Statistics do not yet expose their own identity, so they receive
 * one bounded local digest while the application remains their immutable owner.
 */
function identityPreimage(
  content: Omit<TypeSpecApplicationSnapshot, 'id'>,
): unknown {
  return {
    format: content.format,
    version: content.version,
    repository: content.repository,
    inventory: content.inventory,
    selection: content.selection,
    specifications: content.specifications.map((value) => value.id),
    statistics: digest(content.statistics),
    qualifications: content.qualifications.map((value) => value.id),
    analysis: content.analysis,
    diagnostics: content.diagnostics,
    analysisDiagnostics: content.analysisDiagnostics,
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
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
