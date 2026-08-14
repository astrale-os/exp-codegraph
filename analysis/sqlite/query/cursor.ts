import type { AnalysisGenerationId } from '../../identity/index.ts'
import type { FactFilter } from '../../query/index.ts'

import { deriveAnalysisId } from '../../identity/index.ts'
import { stableJson } from '../../identity/model.ts'

export function encodeSQLiteCursor(
  generation: AnalysisGenerationId,
  filter: FactFilter,
  lastFact: string,
): string {
  return Buffer.from(
    stableJson({ generation, filter: filterSignature(filter), lastFact }),
  ).toString('base64url')
}

export function decodeSQLiteCursor(
  cursor: string,
  generation: AnalysisGenerationId,
  filter: FactFilter,
): string {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      readonly generation: string
      readonly filter: string
      readonly lastFact: string
    }
    if (
      decoded.generation !== generation ||
      decoded.filter !== filterSignature(filter) ||
      typeof decoded.lastFact !== 'string' ||
      !decoded.lastFact
    ) {
      throw new Error()
    }
    return decoded.lastFact
  } catch {
    throw new Error('Fact cursor is invalid or stale for this generation and filter.')
  }
}

function filterSignature(filter: FactFilter): string {
  return deriveAnalysisId('fact', 'astrale.analysis.query-filter.v1', filter)
}
