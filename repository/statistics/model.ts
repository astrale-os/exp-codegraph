import type { Completeness } from '../../analysis/facts/index.ts'
import type { SourceId, SourceRevisionId } from '../../analysis/identity/index.ts'
import type {
  RepositoryClassification,
  RepositoryFile,
  RepositoryInventory,
} from '../model.ts'
import type { RepositorySourceService } from '../source/index.ts'

export interface SourceLineMetrics {
  /** Physical source lines. A terminal newline does not create an additional line. */
  readonly physical: number
  /** Lines containing at least one language token. */
  readonly code: number
  /** Comment-only lines. A line containing code and a trailing comment is code. */
  readonly comment: number
  readonly blank: number
  /** Non-blank lines for which the selected analyzer cannot distinguish code from comments. */
  readonly unclassified: number
}

export interface RepositorySourceLineInput {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly path: string
  readonly language: string
  readonly text: string
}

/** A language adapter. It classifies source text and never owns repository discovery. */
export interface RepositorySourceLineAnalyzer {
  readonly id: string
  readonly version: string
  supports(input: Pick<RepositorySourceLineInput, 'path' | 'language'>): boolean
  analyze(input: RepositorySourceLineInput): SourceLineMetrics
}

export interface RepositoryFileStatistics {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly path: string
  readonly language: string
  readonly bytes: number
  readonly package?: string
  readonly area?: string
  readonly classification: RepositoryClassification
  readonly lines: SourceLineMetrics
  readonly lineAnalyzer: { readonly id: string; readonly version: string }
  readonly completeness: Completeness
}

export interface RepositoryStatisticsSummary {
  readonly files: number
  readonly bytes: number
  readonly lines: SourceLineMetrics
  readonly averageCodeLines: number
  readonly medianCodeLines: number
  readonly p95CodeLines: number
  readonly largestFile?: {
    readonly path: string
    readonly bytes: number
    readonly codeLines: number
  }
}

export interface RepositoryStatisticsGroup {
  readonly dimension: string
  readonly key: string
  readonly label: string
  readonly summary: RepositoryStatisticsSummary
}

/** Extensible grouping seam used for packages, modules, ownership, or downstream domains. */
export interface RepositoryStatisticsGrouping {
  readonly id: string
  values(file: RepositoryFile): readonly { readonly key: string; readonly label?: string }[]
}

export interface RepositoryStatisticsIssue {
  readonly code:
    | 'REPOSITORY_STATISTICS_SOURCE_STALE'
    | 'REPOSITORY_STATISTICS_SOURCE_UNAVAILABLE'
    | 'REPOSITORY_STATISTICS_ANALYZER_FAILED'
  readonly source: SourceId
  readonly path: string
  readonly message: string
}

export interface RepositoryStatisticsReport {
  readonly repository: RepositoryInventory['repository']
  readonly inventory: RepositoryInventory['revision']
  readonly summary: RepositoryStatisticsSummary
  readonly files: readonly RepositoryFileStatistics[]
  readonly groups: readonly RepositoryStatisticsGroup[]
  readonly issues: readonly RepositoryStatisticsIssue[]
  readonly completeness: Completeness
}

export interface RepositoryStatisticsOptions {
  readonly inventory: RepositoryInventory
  readonly sources: RepositorySourceService
  readonly analyzers?: readonly RepositorySourceLineAnalyzer[]
  readonly groupings?: readonly RepositoryStatisticsGrouping[]
  readonly signal?: AbortSignal
}
