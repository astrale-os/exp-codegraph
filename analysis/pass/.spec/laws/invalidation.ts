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

export const PASS_DECLARED_INPUT_HYDRATION = defineLaw({
  id: 'PASS-DECLARED-INPUT-HYDRATION',
  statement:
    'A portable pass receives a generation-pinned overlay query that hydrates only its declared compatible input namespaces and currently staged outputs; the runner never exports the complete upstream generation merely to construct pass context, and undeclared namespace reads fail explicitly.',
})
