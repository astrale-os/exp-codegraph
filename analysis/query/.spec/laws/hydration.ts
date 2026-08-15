import { defineLaw } from '@astrale-os/codegraph/authoring'

export const QUERY_HEADER_FIRST_HYDRATION = defineLaw({
  id: 'QUERY-HEADER-FIRST-HYDRATION',
  statement:
    'A generation-pinned header query returns the complete attributable fact envelope without payload, preserves the same indexed filters and portable identities as hydrated queries, and never reads, decompresses, decodes, or caches a semantic payload; consumers hydrate only explicitly selected fact identities.',
})
