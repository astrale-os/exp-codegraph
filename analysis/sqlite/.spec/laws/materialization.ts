import { defineLaw } from '@astrale-os/codegraph/authoring'

export const SQLITE_STORE_EQUIVALENCE = defineLaw({
  id: 'SQLITE-STORE-EQUIVALENCE',
  statement:
    'For the same committed transactions, SQLite and memory return the same generations, capabilities, fact order, pagination, completeness, provenance, and failures.',
})

export const SQLITE_REGENERABLE_EVIDENCE = defineLaw({
  id: 'SQLITE-REGENERABLE-EVIDENCE',
  statement:
    'The database is derived evidence: incompatible or corrupt state is quarantined or rebuilt and never repaired by guessing semantic facts.',
})

export const SQLITE_LEASE_SAFE_COLLECTION = defineLaw({
  id: 'SQLITE-LEASE-SAFE-COLLECTION',
  statement:
    'A generation with a live snapshot lease is never garbage-collected, including while a newer generation commits in another process.',
})

export const SQLITE_SERIALIZED_WRITERS = defineLaw({
  id: 'SQLITE-SERIALIZED-WRITERS',
  statement:
    'Writers in separate processes serialize through one bounded SQLite write transaction; a rejected, cancelled, failed, or interrupted write publishes no partial generation and leaves the prior current generation intact.',
})

export const SQLITE_NAMESPACE_ISOLATION = defineLaw({
  id: 'SQLITE-NAMESPACE-ISOLATION',
  statement:
    'Repository instance and worktree namespaces isolate durable generations, current pointers, leases, retention, and quarantine state without changing portable fact or generation identities.',
})

export const SQLITE_NORMALIZED_MATERIALIZATION = defineLaw({
  id: 'SQLITE-NORMALIZED-MATERIALIZATION',
  statement:
    'A generation references immutable content-addressed shards; fact envelopes, evidence, inputs, and filter dimensions are independently indexed, and no complete generation is persisted as one JSON value.',
})

export const SQLITE_COLD_EQUIVALENCE = defineLaw({
  id: 'SQLITE-COLD-EQUIVALENCE',
  statement:
    'After create, edit, delete, rename, configuration change, branch-like churn, and recurrence, normalized incremental facts equal a clean materialization of the same producer transaction.',
})
