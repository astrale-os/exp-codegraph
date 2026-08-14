import type {
  AnalysisGeneration,
  ProjectUniverseId,
  SourceId,
  SourceRevisionId,
} from '../../analysis/index.ts'
import type { Diagnostic } from '../../source/diagnostic.ts'

/** Stable fact namespaces for observations adjacent to, but never part of, authored specifications. */
export const APPLICATION_LAYOUT_FACT_NAMESPACE = 'astrale.typespec.layout-observation' as const
export const APPLICATION_TEST_FACT_NAMESPACE = 'astrale.typespec.test-evidence' as const
export const APPLICATION_SCHEMA_FACT_NAMESPACE = 'astrale.typespec.schema-catalog' as const
export const APPLICATION_CONTEXT_FACT_NAMESPACE = 'astrale.typespec.module-context' as const

export type ApplicationLayoutObservedKind = 'directory' | 'file' | 'symbolic-link' | 'other'

export interface ApplicationLayoutObservationFact {
  readonly specification: string
  readonly source: string
  readonly declared: boolean
  readonly exact: boolean
  readonly ignore: readonly { readonly pattern: string; readonly source: 'default' | 'layout' }[]
  readonly entries: readonly {
    readonly path: string
    readonly status: 'matched' | 'missing' | 'mismatch'
    readonly observedKind?: ApplicationLayoutObservedKind
  }[]
  readonly additional: readonly {
    readonly path: string
    readonly kind: ApplicationLayoutObservedKind
  }[]
  readonly revision?: string
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationResolvedTestEvidence {
  readonly reference: string
  readonly id: string
  readonly source: string
  readonly title: string
  readonly status: 'active' | 'skipped' | 'todo'
  readonly line: number
  readonly column: number
  readonly code: string
  readonly revision: string
}

export interface ApplicationTestEvidenceFact {
  readonly specification: string
  readonly laws: readonly {
    readonly id: string
    readonly source: string
    readonly evidence: readonly ApplicationResolvedTestEvidence[]
  }[]
  readonly states: readonly {
    readonly id: string
    readonly source: string
    readonly evidence: readonly ApplicationResolvedTestEvidence[]
  }[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationSchemaCatalogFact {
  readonly specification: string
  readonly sources: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationPresentationResource {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly path: string
  readonly bytes: number
  readonly mediaType: string
  readonly presentation: 'markdown' | 'text' | 'pdf' | 'image' | 'binary'
}

export interface ApplicationModulePresentationFact {
  readonly specification: string
  readonly architecture?: ApplicationPresentationResource
  readonly icon?: ApplicationPresentationResource
  readonly history: readonly ApplicationPresentationResource[]
}

export interface ApplicationObservationRefresh {
  readonly universe: ProjectUniverseId
  readonly generation: AnalysisGeneration
  /** Catalog-wide diagnostics which cannot soundly be attributed to one owned specification. */
  readonly diagnostics: readonly Diagnostic[]
}
