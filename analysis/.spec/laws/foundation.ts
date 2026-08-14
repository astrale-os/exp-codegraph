import { defineLaw } from '@astrale-os/codegraph/authoring'

export const ANALYSIS_PORTABLE_IDENTITY = defineLaw({
  id: 'ANALYSIS-PORTABLE-IDENTITY',
  statement:
    'Semantic equality uses normalized logical coordinates and digests; absolute checkout paths and local store locations never participate in portable identities.',
})

export const ANALYSIS_COMPILER_DERIVED_UNIVERSE = defineLaw({
  id: 'ANALYSIS-COMPILER-DERIVED-UNIVERSE',
  statement:
    'A compiler project universe is derived only after loading its complete configuration chain, root membership, module boundaries, capabilities, toolchain, protocol, and platform; callers cannot seed or override it, and a changed universe begins a complete lineage.',
})

export const ANALYSIS_EXPLICIT_COMPLETENESS = defineLaw({
  id: 'ANALYSIS-EXPLICIT-COMPLETENESS',
  statement:
    'Absence is meaningful only under complete evidence; partial and unavailable facts retain their exact limits or failures and never become negative matches.',
})

export const ANALYSIS_ATOMIC_GENERATION = defineLaw({
  id: 'ANALYSIS-ATOMIC-GENERATION',
  statement:
    'A validated complete next-generation manifest becomes visible atomically or not at all, and a stale transaction base never overwrites a newer generation.',
})

export const ANALYSIS_PINNED_QUERY = defineLaw({
  id: 'ANALYSIS-PINNED-QUERY',
  statement:
    'Every query observes exactly one immutable generation until its lease is disposed, even while a writer commits later generations.',
})

export const ANALYSIS_PASS_DAG = defineLaw({
  id: 'ANALYSIS-PASS-DAG',
  statement:
    'A pass reads only declared compatible upstream namespaces from the same generation; cycles and missing mandatory inputs fail planning before execution.',
})

export const ANALYSIS_HEADLESS = defineLaw({
  id: 'ANALYSIS-HEADLESS',
  statement:
    'Headless analysis imports no TypeSpec, conformance, catalog, CLI, server, viewer, or framework module and owns no process exit, output, signal, current-directory, or implicit-cache side effect.',
})

export const ANALYSIS_PERSISTENCE_REQUIREMENT = defineLaw({
  id: 'ANALYSIS-PERSISTENCE-REQUIREMENT',
  statement:
    'The application supplies any durable store explicitly: required durability fails with its attributable cause when unavailable, while advisory durability may fall back to memory only with an explicit fallback result retaining that cause.',
})
