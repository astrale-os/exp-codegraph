import { defineLaw } from '@astrale-os/codegraph/authoring'

export const QUERY_HEADER_FIRST_HYDRATION = defineLaw({
  id: 'QUERY-HEADER-FIRST-HYDRATION',
  statement:
    'A generation-pinned header query returns the complete attributable fact envelope without payload, preserves the same indexed filters and portable identities as hydrated queries, and never reads, decompresses, decodes, or caches a semantic payload; consumers hydrate only explicitly selected fact identities.',
})

export const QUERY_EXPLICIT_TOTAL_COST = defineLaw({
  id: 'QUERY-EXPLICIT-TOTAL-COST',
  statement:
    'A generation-pinned page computes and returns the exact filtered cardinality only when PageRequest.includeTotal is true; ordinary pages and streaming exports determine continuation from at most one extra matching envelope and perform no count-only scan.',
})
