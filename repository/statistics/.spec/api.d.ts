import type { Completeness } from '../../../analysis/facts/.spec/api.js'
import type { SourceId, SourceRevisionId } from '../../../analysis/identity/.spec/api.js'
import type {
  RepositoryClassification,
  RepositoryFile,
  RepositoryInventory,
} from '../../.spec/api.js'
import type { RepositorySourceService } from '../../source/.spec/api.js'

export interface SourceLineMetrics {
  readonly physical: number
  readonly code: number
  readonly comment: number
  readonly blank: number
  readonly unclassified: number
}

export interface RepositorySourceLineInput {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly path: string
  readonly language: string
  readonly text: string
}

export interface RepositorySourceLineAnalyzer {
  readonly id: string
  readonly version: string
  supports(input: Pick<RepositorySourceLineInput, 'path' | 'language'>): boolean
  analyze(input: RepositorySourceLineInput): SourceLineMetrics
}

export interface RepositoryFileStatistics extends Omit<RepositoryFile, never> {
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

export interface RepositoryStatisticsGrouping {
  readonly id: string
  values(file: RepositoryFile): readonly { readonly key: string; readonly label?: string }[]
}

export interface RepositoryPathOwner {
  readonly root: string
  readonly key: string
  readonly label?: string
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

export interface RepositoryStatisticsRefreshOptions extends RepositoryStatisticsOptions {
  readonly previous?: RepositoryStatisticsReport
}

export interface RepositoryStatisticsRefreshWork {
  readonly reusedFiles: readonly string[]
  readonly analyzedFiles: readonly string[]
  readonly removedFiles: readonly string[]
}

export interface RepositoryStatisticsRefreshResult {
  readonly report: RepositoryStatisticsReport
  readonly work: RepositoryStatisticsRefreshWork
}

export function createTypeScriptSourceLineAnalyzer(): RepositorySourceLineAnalyzer
export function createTextSourceLineAnalyzer(): RepositorySourceLineAnalyzer
export function defaultRepositorySourceLineAnalyzers(): readonly RepositorySourceLineAnalyzer[]
export function typeScriptSourceLines(source: import('typescript').SourceFile): SourceLineMetrics
export function textSourceLines(text: string): SourceLineMetrics
export function physicalSourceLines(text: string): number
export function emptySourceLines(): SourceLineMetrics
export function analyzeSourceLines(
  input: RepositorySourceLineInput,
  analyzers?: readonly RepositorySourceLineAnalyzer[],
): { readonly metrics: SourceLineMetrics; readonly analyzer: RepositorySourceLineAnalyzer }
export function summarizeRepositoryStatistics(
  files: readonly RepositoryFileStatistics[],
): RepositoryStatisticsSummary
export function aggregateRepositoryStatistics(
  files: readonly RepositoryFileStatistics[],
  inventoryFiles: readonly RepositoryFile[],
  groupings: readonly RepositoryStatisticsGrouping[],
): readonly RepositoryStatisticsGroup[]
export function defaultRepositoryStatisticsGroupings(): readonly RepositoryStatisticsGrouping[]
export function createRepositoryPathOwnershipGrouping(
  id: string,
  owners: readonly RepositoryPathOwner[],
): RepositoryStatisticsGrouping
export function analyzeRepositoryStatistics(
  options: RepositoryStatisticsOptions,
): Promise<RepositoryStatisticsReport>
export function refreshRepositoryStatistics(
  options: RepositoryStatisticsRefreshOptions,
): Promise<RepositoryStatisticsRefreshResult>
