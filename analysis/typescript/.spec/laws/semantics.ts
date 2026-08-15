import { defineLaw } from '@astrale-os/codegraph/authoring'

export const TYPESCRIPT_OCCURRENCE_PRESERVATION = defineLaw({
  id: 'TYPESCRIPT-OCCURRENCE-PRESERVATION',
  statement:
    'Every in-scope semantic occurrence remains independently attributable even when a relationship projection deduplicates several occurrences to one edge; the edge has a content-derived logical identity independent of traversal order, while its canonically ordered evidence retains every contributing occurrence.',
})

export const TYPESCRIPT_CANONICAL_SYMBOLS = defineLaw({
  id: 'TYPESCRIPT-CANONICAL-SYMBOLS',
  statement:
    'Aliases and barrels retain export evidence while semantic targets resolve to the Checker canonical declaration; same-spelled unrelated declarations never match by spelling alone.',
})

export const TYPESCRIPT_CANONICAL_PUBLIC_SURFACE = defineLaw({
  id: 'TYPESCRIPT-CANONICAL-PUBLIC-SURFACE',
  statement:
    'Public type facts retain explicitly authored aliases and algebraic structure, resolve targets and instantiated substitutions through the resident Checker, represent supported TypeScript intrinsics losslessly, and identify platform symbols without compiler-bundle positions; reduced or expanded views are separate derived capabilities.',
})

export const TYPESCRIPT_STABLE_PUBLIC_IDENTITIES = defineLaw({
  id: 'TYPESCRIPT-STABLE-PUBLIC-IDENTITIES',
  statement:
    'A public declaration is identified by portable source ownership and qualified authored symbol path, never by compiler byte offsets or traversal order; inserting unrelated text before a declaration cannot rename it.',
})

export const TYPESCRIPT_PORTABLE_SEMANTIC_IDENTITIES = defineLaw({
  id: 'TYPESCRIPT-PORTABLE-SEMANTIC-IDENTITIES',
  statement:
    'Compiler symbol, body, occurrence, and derived fact identities use portable logical source ownership; source-file module names, compiler allocation details, checkout roots, and local store paths never enter their equality preimages.',
})

export const TYPESCRIPT_PUBLIC_API_CLOSURE = defineLaw({
  id: 'TYPESCRIPT-PUBLIC-API-CLOSURE',
  statement:
    'Every Checker-resolved declaration reachable from an exported declaration remains in the public closure, and every external owner reached by that closure appears as an attributable API dependency; an explicit partial type representation remains visible but cannot erase independently resolved ownership.',
})

export const TYPESCRIPT_PORTABLE_PACKAGE_OWNERSHIP = defineLaw({
  id: 'TYPESCRIPT-PORTABLE-PACKAGE-OWNERSHIP',
  statement:
    'External and workspace package ownership resolves to the nearest named package manifest; nested nameless module-format metadata cannot turn package-owned source into an unowned physical path.',
})

export const TYPESCRIPT_EXPORT_PROVENANCE = defineLaw({
  id: 'TYPESCRIPT-EXPORT-PROVENANCE',
  statement:
    'An exported symbol retains its authored path and the originating external package across local barrel forwarding while semantic identity resolves to the Checker target.',
})

export const TYPESCRIPT_DETERMINISTIC_CODE_PROVENANCE = defineLaw({
  id: 'TYPESCRIPT-DETERMINISTIC-CODE-PROVENANCE',
  statement:
    'When the same error-code literal occurs more than once, its representative source is selected in portable lexical source order and is independent of compiler source traversal order.',
})

export const TYPESCRIPT_COMPILER_RESOLUTION_AUTHORITY = defineLaw({
  id: 'TYPESCRIPT-COMPILER-RESOLUTION-AUTHORITY',
  statement:
    'The qualified TypeScript-Go resolver owns the exact declaration file selected for a module specifier; portable package ownership is normalized independently, but provider file paths are retained as evidence and are never rewritten to imitate another compiler generation.',
})

export const TYPESCRIPT_ISSUE_PROVENANCE = defineLaw({
  id: 'TYPESCRIPT-ISSUE-PROVENANCE',
  statement:
    'Observation issues retain exact code, message, native source location, stable declaration provenance when available, and the observed value; a supported lossless surface shape never emits an unsupported diagnostic solely to reproduce an older analyzer limitation.',
})

export const TYPESCRIPT_PORTABLE_BODY = defineLaw({
  id: 'TYPESCRIPT-PORTABLE-BODY',
  statement:
    'Function analysis crosses the native boundary only as versioned body occurrences, control flow, definition-use, calls, bindings, summaries, evidence, and completeness—not live compiler objects.',
})

export const TYPESCRIPT_VALUE_EPISTEMICS = defineLaw({
  id: 'TYPESCRIPT-VALUE-EPISTEMICS',
  statement:
    'Every bounded evaluation result is exactly known, unknown, ambiguous, or unsupported and carries evidence plus the effective reason or limit for every non-known result.',
})

export const TYPESCRIPT_INCREMENTAL_EQUIVALENCE = defineLaw({
  id: 'TYPESCRIPT-INCREMENTAL-EQUIVALENCE',
  statement:
    'After normalization of commit-only metadata, every incremental TypeScript generation is semantically identical to a cold build from the same source and configuration state.',
})

export const TYPESCRIPT_AFFECTED_SOURCE_CLOSURE = defineLaw({
  id: 'TYPESCRIPT-AFFECTED-SOURCE-CLOSURE',
  statement:
    'A compiler-proven private edit reprojects only its owning source shards; a declaration-shape change expands through the exact transitive reverse dependency closure, while global scope, import-graph uncertainty, root churn, configuration changes, and mutating plugins fail closed to a complete rebuild.',
})

export const TYPESCRIPT_ATOMIC_PUBLICATION = defineLaw({
  id: 'TYPESCRIPT-ATOMIC-PUBLICATION',
  statement:
    'The resident native generation remains a private compiler lineage; native facts and the requested portable pass closure stage together, then exactly one complete validated generation becomes visible to consumers or no generation is published.',
})
