import { defineLaw } from '@astrale-os/codegraph/authoring'

export const REPOSITORY_STATISTICS_PINNED = defineLaw({
  id: 'REPOSITORY-STATISTICS-PINNED',
  statement:
    'Every file statistic is derived from source text that reproduces the inventory-pinned revision; stale or unavailable source is explicit evidence, never a silent zero.',
})

export const REPOSITORY_STATISTICS_CONSERVATIVE = defineLaw({
  id: 'REPOSITORY-STATISTICS-CONSERVATIVE',
  statement:
    'A language adapter may classify code and comments only within its declared support; otherwise non-blank content remains unclassified.',
})

export const REPOSITORY_STATISTICS_BINARY = defineLaw({
  id: 'REPOSITORY-STATISTICS-BINARY',
  statement:
    'Binary inventory entries remain visible in file and byte totals, are explicitly not applicable to line analysis, and never make an otherwise complete report partial.',
})

export const REPOSITORY_STATISTICS_PROJECTION = defineLaw({
  id: 'REPOSITORY-STATISTICS-PROJECTION',
  statement:
    'Grouping and filtering project immutable file statistics and never mutate inventory identity, compiler facts, or classification evidence.',
})

export const REPOSITORY_STATISTICS_NESTED_OWNERSHIP = defineLaw({
  id: 'REPOSITORY-STATISTICS-NESTED-OWNERSHIP',
  statement:
    'A path-ownership projection assigns each file to the deepest matching declared root, reports unmatched files explicitly, and rejects ambiguous roots.',
})
