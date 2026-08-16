import type { AnalysisGeneration, AnalysisStore } from '../../../analysis/.spec/api.js'
import type { ProjectUniverseId } from '../../../analysis/identity/.spec/api.js'
import type { RepositoryInventory } from '../../../repository/.spec/api.js'
import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'

interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

export const APPLICATION_LAYOUT_FACT_NAMESPACE: 'astrale.typespec.layout-observation'
export const APPLICATION_TEST_FACT_NAMESPACE: 'astrale.typespec.test-evidence'
export const APPLICATION_SCHEMA_FACT_NAMESPACE: 'astrale.typespec.schema-catalog'
export const APPLICATION_CONTEXT_FACT_NAMESPACE: 'astrale.typespec.module-context'

export interface ApplicationLayoutObservationFact {
  readonly specification: string
  readonly source: string
  readonly declared: boolean
  readonly exact: boolean
  readonly ignore: readonly { readonly pattern: string; readonly source: 'default' | 'layout' }[]
  readonly entries: readonly {
    readonly path: string
    readonly status: 'matched' | 'missing' | 'mismatch'
    readonly observedKind?: 'directory' | 'file' | 'symbolic-link' | 'other'
  }[]
  readonly additional: readonly {
    readonly path: string
    readonly kind: 'directory' | 'file' | 'symbolic-link' | 'other'
  }[]
  readonly revision?: string
  readonly diagnostics: readonly Diagnostic[]
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

export interface ApplicationSchemaCatalogFact {
  readonly specification: string
  readonly sources: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationPresentationResource {
  readonly source: `source:${string}`
  readonly revision: `source-revision:${string}`
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
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationSchemaDependencyResource {
  readonly source: string
  readonly revision: string
  readonly schema: unknown
  readonly resolutionBase: string
}

export function applicationSchemaDependencies(
  ordinal: number,
  schemas: readonly {
    readonly source: string
    readonly revision: string
    readonly schema: unknown
  }[],
): readonly ApplicationSchemaDependencyResource[]

export function materializeApplicationObservations(options: {
  readonly root: string
  readonly store: AnalysisStore
  readonly inventory: RepositoryInventory
  readonly specifications: readonly SpecificationSnapshot[]
  readonly refresh?: readonly string[]
  readonly schemaDependencies?: readonly ApplicationSchemaDependencyResource[]
  readonly signal?: AbortSignal
}): Promise<ApplicationObservationRefresh>
