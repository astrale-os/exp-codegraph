import { defineLaw } from '@astrale-os/codegraph/authoring'

export const PASS_CAPABILITY_COMPLETENESS = defineLaw({
  id: 'PASS-CAPABILITY-COMPLETENESS',
  statement:
    'Every capability provided by a portable pass is attached to its declared output shards; capability completeness is their conservative merge and never depends on namespace spelling.',
})

export const PASS_SELECTIVE_INVALIDATION = defineLaw({
  id: 'PASS-SELECTIVE-INVALIDATION',
  statement:
    'An unaffected portable pass carries validated output shards without exporting inputs, executing the pass, or rewriting immutable rows; only declared input, selector, schema, force, or upstream invalidation may rerun it.',
})
