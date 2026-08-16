import type { Completeness } from '../../analysis/facts/index.ts'
import type { RepositoryFile, RepositoryInventory } from '../model.ts'
import {
  aggregateRepositoryStatistics,
  defaultRepositoryStatisticsGroupings,
  summarizeRepositoryStatistics,
} from './aggregate.ts'
import { analyzeRepositoryStatistics } from './analyze.ts'
import { defaultRepositorySourceLineAnalyzers } from './lines.ts'
import type {
  RepositoryFileStatistics,
  RepositoryStatisticsIssue,
  RepositoryStatisticsOptions,
  RepositoryStatisticsReport,
  RepositorySourceLineAnalyzer,
} from './model.ts'

/** Options for refreshing a repository statistics report from a prior report. */
export interface RepositoryStatisticsRefreshOptions extends RepositoryStatisticsOptions {
  /** The report from the preceding inventory, when one is available. */
  readonly previous?: RepositoryStatisticsReport
}

export interface RepositoryStatisticsRefreshWork {
  /** Repository-relative paths whose prior per-file metrics were reused. */
  readonly reusedFiles: readonly string[]
  /** Repository-relative paths whose per-file metrics were computed in this refresh. */
  readonly analyzedFiles: readonly string[]
  /** Repository-relative paths present in the prior report but absent from this inventory. */
  readonly removedFiles: readonly string[]
}

export interface RepositoryStatisticsRefreshResult {
  readonly report: RepositoryStatisticsReport
  readonly work: RepositoryStatisticsRefreshWork
}

/**
 * Refresh repository statistics while preserving the exact cold-analysis result.
 *
 * A prior file is reused only when its source and revision still identify the
 * current file, the current analyzer selection has the same identity/version,
 * and the prior per-file result was complete. Everything else is sent through
 * the cold file analyzer, including analyzer failures and unavailable reads.
 */
export async function refreshRepositoryStatistics(
  options: RepositoryStatisticsRefreshOptions,
): Promise<RepositoryStatisticsRefreshResult> {
  if (options.sources.inventory !== options.inventory.revision) {
    throw new Error('Repository statistics source service is not pinned to the requested inventory.')
  }

  const analyzers = options.analyzers ?? defaultRepositorySourceLineAnalyzers()
  const previousBySource = new Map(
    (options.previous?.files ?? []).map((file) => [file.source, file] as const),
  )
  const currentSources = new Set(options.inventory.files.map((file) => file.source))
  const reusedBySource = new Map<string, RepositoryFileStatistics>()
  const filesToAnalyze: RepositoryFile[] = []

  for (const file of options.inventory.files) {
    // Match analyzeRepositoryStatistics: cancellation is checked once per
    // inventory file, including files whose metrics can be reused.
    options.signal?.throwIfAborted()
    const previous = previousBySource.get(file.source)
    if (previous && canReuse(file, previous, analyzers)) {
      // Refresh the inventory-owned fields even when the line metrics are
      // reused. This keeps the per-file result equal to a cold report when
      // non-content metadata changes while source identity remains stable.
      reusedBySource.set(file.source, {
        ...file,
        lines: previous.lines,
        lineAnalyzer: previous.lineAnalyzer,
        completeness: previous.completeness,
      })
    } else {
      filesToAnalyze.push(file)
    }
  }

  const analyzedBySource = new Map<string, RepositoryFileStatistics>()
  let analyzedIssues: readonly RepositoryStatisticsIssue[] = []
  if (filesToAnalyze.length) {
    // Analyze only the files whose eligibility could not be proven. Keeping
    // the current inventory revision lets the source service enforce the same
    // pinned read contract as a cold report.
    const analysisInventory: RepositoryInventory = {
      ...options.inventory,
      files: filesToAnalyze,
    }
    const analyzed = await analyzeRepositoryStatistics({
      inventory: analysisInventory,
      sources: options.sources,
      analyzers,
      signal: options.signal,
    })
    for (const file of analyzed.files) analyzedBySource.set(file.source, file)
    analyzedIssues = analyzed.issues
  }

  const files = options.inventory.files.map((file) => {
    const statistics = reusedBySource.get(file.source) ?? analyzedBySource.get(file.source)
    if (!statistics) {
      throw new Error(`Repository statistics refresh did not produce ${file.path}.`)
    }
    return statistics
  })
  const groupings = options.groupings ?? defaultRepositoryStatisticsGroupings()
  const report: RepositoryStatisticsReport = {
    repository: options.inventory.repository,
    inventory: options.inventory.revision,
    summary: summarizeRepositoryStatistics(files),
    files,
    groups: aggregateRepositoryStatistics(files, options.inventory.files, groupings),
    // The analyzed subset has the same inventory order among its files as the
    // current inventory, therefore its issue order matches the cold analyzer.
    issues: analyzedIssues,
    completeness: reportCompleteness(options.inventory.completeness, files),
  }

  return {
    report,
    work: {
      reusedFiles: [...reusedBySource.values()].map((file) => file.path).sort(comparePaths),
      analyzedFiles: filesToAnalyze.map((file) => file.path).sort(comparePaths),
      removedFiles: (options.previous?.files ?? [])
        .filter((file) => !currentSources.has(file.source))
        .map((file) => file.path)
        .sort(comparePaths),
    },
  }
}

function canReuse(
  file: RepositoryFile,
  previous: RepositoryFileStatistics,
  analyzers: readonly RepositorySourceLineAnalyzer[],
): boolean {
  if (previous.source !== file.source || previous.revision !== file.revision) return false
  if (previous.completeness.kind !== 'complete') return false

  if (file.content === 'binary') {
    return (
      previous.lineAnalyzer.id === 'astrale.repository.lines.not-applicable' &&
      previous.lineAnalyzer.version === '1'
    )
  }

  const analyzer = applicableAnalyzer(file, analyzers)
  return Boolean(
    analyzer &&
      analyzer.id === previous.lineAnalyzer.id &&
      analyzer.version === previous.lineAnalyzer.version,
  )
}

function applicableAnalyzer(
  file: RepositoryFile,
  analyzers: readonly RepositorySourceLineAnalyzer[],
): RepositorySourceLineAnalyzer | undefined {
  try {
    return analyzers.find((candidate) =>
      candidate.supports({ path: file.path, language: file.language }),
    )
  } catch {
    // The cold analyzer reports a throwing support/analyze path as an analyzer
    // failure. Since selection cannot be proven here, force that cold path.
    return undefined
  }
}

function reportCompleteness(
  inventory: Completeness,
  files: readonly RepositoryFileStatistics[],
): Completeness {
  if (inventory.kind !== 'complete') return inventory
  const unavailable = files.filter((file) => file.completeness.kind === 'unavailable')
  if (!unavailable.length) return { kind: 'complete' }
  if (unavailable.length === files.length) {
    return {
      kind: 'unavailable',
      reasons: unavailable.flatMap((file) =>
        file.completeness.kind === 'unavailable' ? file.completeness.reasons : [],
      ),
    }
  }
  return {
    kind: 'partial',
    reasons: [
      {
        code: 'REPOSITORY_STATISTICS_INCOMPLETE',
        message: 'Some inventory-pinned sources could not be analyzed.',
        effective: { files: files.length, unavailableFiles: unavailable.length },
      },
    ],
  }
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right)
}
