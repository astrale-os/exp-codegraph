import type { AnalysisFailure, Completeness } from '../../analysis/facts/index.ts'
import type { RepositoryFile } from '../model.ts'
import {
  aggregateRepositoryStatistics,
  defaultRepositoryStatisticsGroupings,
  summarizeRepositoryStatistics,
} from './aggregate.ts'
import { analyzeSourceLines, defaultRepositorySourceLineAnalyzers, emptySourceLines } from './lines.ts'
import type {
  RepositoryFileStatistics,
  RepositoryStatisticsIssue,
  RepositoryStatisticsOptions,
  RepositoryStatisticsReport,
} from './model.ts'

/** Analyze one immutable inventory without creating a compiler project or retaining source text. */
export async function analyzeRepositoryStatistics(
  options: RepositoryStatisticsOptions,
): Promise<RepositoryStatisticsReport> {
  if (options.sources.inventory !== options.inventory.revision) {
    throw new Error('Repository statistics source service is not pinned to the requested inventory.')
  }
  const analyzers = options.analyzers ?? defaultRepositorySourceLineAnalyzers()
  const files: RepositoryFileStatistics[] = []
  const issues: RepositoryStatisticsIssue[] = []
  for (const file of options.inventory.files) {
    options.signal?.throwIfAborted()
    if (file.content === 'binary') {
      files.push({
        ...file,
        lines: emptySourceLines(),
        lineAnalyzer: { id: 'astrale.repository.lines.not-applicable', version: '1' },
        completeness: { kind: 'complete' },
      })
      continue
    }
    const read = await options.sources.read({
      source: file.source,
      revision: file.revision,
      signal: options.signal,
    })
    if (read.status !== 'current') {
      const issue: RepositoryStatisticsIssue = {
        code:
          read.status === 'stale'
            ? 'REPOSITORY_STATISTICS_SOURCE_STALE'
            : 'REPOSITORY_STATISTICS_SOURCE_UNAVAILABLE',
        source: file.source,
        path: file.path,
        message:
          read.status === 'stale'
            ? `Source changed after inventory ${options.inventory.revision}.`
            : read.message ?? `Source is unavailable: ${read.reason}.`,
      }
      issues.push(issue)
      files.push(unavailableFile(file, issue))
      continue
    }
    try {
      const result = analyzeSourceLines(
        {
          source: file.source,
          revision: file.revision,
          path: file.path,
          language: file.language,
          text: read.text,
        },
        analyzers,
      )
      files.push({
        ...file,
        lines: result.metrics,
        lineAnalyzer: { id: result.analyzer.id, version: result.analyzer.version },
        completeness: { kind: 'complete' },
      })
    } catch (error) {
      const issue: RepositoryStatisticsIssue = {
        code: 'REPOSITORY_STATISTICS_ANALYZER_FAILED',
        source: file.source,
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      }
      issues.push(issue)
      files.push(unavailableFile(file, issue))
    }
  }
  const groupings = options.groupings ?? defaultRepositoryStatisticsGroupings()
  return {
    repository: options.inventory.repository,
    inventory: options.inventory.revision,
    summary: summarizeRepositoryStatistics(files),
    files,
    groups: aggregateRepositoryStatistics(files, options.inventory.files, groupings),
    issues,
    completeness: reportCompleteness(options.inventory.completeness, files),
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

function unavailableFile(
  file: RepositoryFile,
  issue: RepositoryStatisticsIssue,
): RepositoryFileStatistics {
  const failure: AnalysisFailure = {
    code: issue.code,
    message: issue.message,
    retryable: issue.code !== 'REPOSITORY_STATISTICS_ANALYZER_FAILED',
  }
  const completeness: Completeness = { kind: 'unavailable', reasons: [failure] }
  return {
    ...file,
    lines: emptySourceLines(),
    lineAnalyzer: { id: 'unavailable', version: '0' },
    completeness,
  }
}
