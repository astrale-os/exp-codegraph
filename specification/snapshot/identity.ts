import { createHash } from 'node:crypto'

import type { ApiModel } from '../../api/model.ts'
import type { SpecificationSnapshot, SpecificationSnapshotId } from './model.ts'

/** Deterministic identity namespace for one module inside a specification anchor. */
export function specificationModuleId(source: string, declarationPointer: string): string {
  return declarationPointer ? `${source}#${declarationPointer}` : source
}

/** Bind normative snapshot meaning while reducing repeated declaration presentation payloads. */
export function specificationSnapshotIdentity(
  snapshot: Omit<SpecificationSnapshot, 'id'>,
): SpecificationSnapshotId {
  const digest = createHash('sha256')
    .update('astrale.typespec.specification\0')
    .update(stableJson(identityPreimage(snapshot)))
    .digest('hex')
  return `specification:${digest}`
}

function identityPreimage(snapshot: Omit<SpecificationSnapshot, 'id'>): unknown {
  return {
    ...snapshot,
    module: {
      ...snapshot.module,
      ...(snapshot.module.api
        ? { api: declarationResourceIdentity(snapshot.module.api) }
        : {}),
      ...(snapshot.module.internal
        ? { internal: declarationResourceIdentity(snapshot.module.internal) }
        : {}),
      ports: snapshot.module.ports.map(declarationResourceIdentity),
    },
  }
}

function declarationResourceIdentity<Resource extends { readonly model?: ApiModel }>(
  resource: Resource,
): unknown {
  if (!resource.model) return resource
  const { model, ...content } = resource
  return {
    ...content,
    model: {
      format: model.format,
      version: model.version,
      entrypoint: model.entrypoint,
      fingerprint: model.fingerprint,
      sourceRevision: model.sourceRevision,
      dependencies: model.dependencies,
      sources: model.sources.map(({ text: _text, ...source }) => source),
      navigation: createHash('sha256').update(stableJson(model.tokens)).digest('hex'),
    },
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === undefined) return { $undefined: true }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}
