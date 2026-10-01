import type { QueryPages } from '@astrale-os/sdk/query'

import { Query, defineQuery, queryResult } from '@astrale-os/sdk/query'

import type { IssuesSchema } from '#schema'

import { issueRecord, projectRecord } from '#queries/projection'

export const listVisibleIssues = defineQuery<IssuesSchema>()((domain) => ({
  id: 'issues.issue.list-visible',
  page: { size: 256 },
  pagination: { maximumPages: 1_024 },
  build: (_input: Record<string, never>) =>
    Query.from({ edges: [domain.classes.project_contains_issue] }).select({
      kind: 'edges',
      projection: { edge: 'reference', source: 'value', target: 'value' },
    }),
  project: (pages: QueryPages) =>
    pages
      .flatMap((page) => queryResult.edgeItems(page, 'visible Issues'))
      .map((item) => {
        if (item.source.kind !== 'value' || item.target.kind !== 'value')
          throw new TypeError('Visible Issue Query must project Project and Issue values.')
        return {
          project: projectRecord(domain, item.source.value),
          issue: issueRecord(domain, item.target.value),
        }
      })
      .sort(
        (left, right) =>
          right.issue.priority - left.issue.priority ||
          right.issue.updatedAt.localeCompare(left.issue.updatedAt) ||
          left.issue.reference.localeCompare(right.issue.reference),
      ),
}))
