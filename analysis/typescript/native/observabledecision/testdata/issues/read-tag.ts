import type { NodeId } from '@astrale-os/sdk/graph/node'
import type { QueryResult } from '@astrale-os/sdk/query'

import { Query, defineQuery, queryResult } from '@astrale-os/sdk/query'

import type { IssuesSchema } from '#schema'

import { tagRecord } from '#queries/projection'

export const readTag = defineQuery<IssuesSchema>()((domain) => ({
  id: 'issues.tag.read',
  build: (tagId: NodeId) =>
    Query.from({ nodes: [tagId] }).select({
      kind: 'nodes',
      projection: { kind: 'value' },
    }),
  project: (result: QueryResult) => tagRecord(domain, queryResult.exactlyOneNode(result, 'Tag')),
}))
