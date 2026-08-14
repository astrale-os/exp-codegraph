import { createHash } from 'node:crypto'
import { isAbsolute, posix } from 'node:path'

declare const analysisIdentity: unique symbol

export type AnalysisId<Kind extends string> = string & {
  readonly [analysisIdentity]: Kind
}

export type AnalysisGenerationId = AnalysisId<'generation'>
export type FactId = AnalysisId<'fact'>
export type FactShardKey = AnalysisId<'fact-shard-key'>
export type FactShardDigest = AnalysisId<'fact-shard-digest'>
export type OccurrenceId = AnalysisId<'occurrence'>
export type PassId = AnalysisId<'pass'>
export type PolicyId = AnalysisId<'policy'>
export type ProducerId = AnalysisId<'producer'>
export type ProjectUniverseId = AnalysisId<'project-universe'>
export type RepositoryId = AnalysisId<'repository'>
export type SnapshotSetId = AnalysisId<'snapshot-set'>
export type SourceId = AnalysisId<'source'>
export type SourceManifestId = AnalysisId<'source-manifest'>
export type SourceRevisionId = AnalysisId<'source-revision'>
export type SymbolId = AnalysisId<'symbol'>

export interface PortableSourceCoordinate {
  readonly repository: RepositoryId
  readonly path: string
}

const kindPattern = /^[a-z][a-z0-9-]*$/u
const valuePattern = /^[a-z][a-z0-9-]*:[a-f0-9]{64}$/u

export function admitAnalysisId<Kind extends string>(kind: Kind, value: string): AnalysisId<Kind> {
  if (!kindPattern.test(kind)) throw new TypeError(`Invalid analysis identity kind: ${kind}`)
  if (!valuePattern.test(value) || !value.startsWith(`${kind}:`)) {
    throw new TypeError(`Invalid ${kind} analysis identity: ${value}`)
  }
  return value as AnalysisId<Kind>
}

export function deriveAnalysisId<Kind extends string>(
  kind: Kind,
  namespace: string,
  input: unknown,
): AnalysisId<Kind> {
  if (!kindPattern.test(kind)) throw new TypeError(`Invalid analysis identity kind: ${kind}`)
  if (!namespace || namespace.includes('\0')) throw new TypeError('Identity namespace is required.')
  const digest = createHash('sha256')
    .update('astrale.analysis.identity\0')
    .update(kind)
    .update('\0')
    .update(namespace)
    .update('\0')
    .update(stableJson(input))
    .digest('hex')
  return `${kind}:${digest}` as AnalysisId<Kind>
}

export function portablePath(path: string): string {
  if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) {
    throw new TypeError(`Analysis path must be a non-empty relative POSIX path: ${path}`)
  }
  const normalized = posix.normalize(path)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new TypeError(`Analysis path escapes its logical root: ${path}`)
  }
  return normalized
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === undefined) return { $undefined: true }
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (!value || typeof value !== 'object') return value
  if (value instanceof Date) return { $date: value.toISOString() }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      // Go's encoding/json orders valid UTF-8 map keys by Unicode scalar value.
      // Locale collation is machine-dependent and, even for ASCII, places
      // `callables` before `callSignatureCount`; that made native digests fail
      // only once a real surface contained both keys.
      .sort(([left], [right]) => compareUnicodeScalars(left, right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function compareUnicodeScalars(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (difference) return difference
  }
  return a.length - b.length
}
