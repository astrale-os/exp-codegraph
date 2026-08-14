import type { ObservedSurface } from '../analysis/typescript/surface/model.ts'

export interface SourcePosition {
  readonly line: number
  readonly column: number
  readonly offset: number
}

export interface SourceRange {
  readonly file: string
  readonly start: SourcePosition
  readonly end: SourcePosition
}

export interface ApiDiagnostic {
  readonly source: 'typescript' | 'api' | 'json-schema' | 'isolation'
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly range?: SourceRange
}

export interface ApiSource {
  readonly file: string
  readonly revision: string
  readonly text: string
}

export interface ApiDeclarationMetadata {
  readonly documentation?: string
  readonly remarks?: string
  readonly conformance: 'exact' | 'identity'
  readonly errors: readonly string[]
  readonly signature?: string
  /** Authored declaration form retained independently from its semantic surface kind. */
  readonly form?:
    | 'type-alias'
    | 'variable'
    | 'function'
    | 'interface'
    | 'class'
    | 'enum'
    | 'namespace'
    | 'method'
    | 'property'
}

export interface ApiToken {
  readonly file: string
  readonly from: number
  readonly to: number
  readonly text: string
  readonly declaration?: string
  readonly target?: string
}

export interface ApiModel<Surface extends ObservedSurface = ObservedSurface> {
  readonly format: 'astrale.api'
  readonly version: 2
  readonly entrypoint: string
  readonly fingerprint: string
  readonly sourceRevision: string
  /** All declaration inputs whose content can change this compiled API model. */
  readonly dependencies: readonly ApiCompilationDependency[]
  /** Authored declaration sources owned by this API, including their source text. */
  readonly sources: readonly ApiSource[]
  readonly surface: Surface
  readonly metadata: Readonly<Record<string, ApiDeclarationMetadata>>
  readonly tokens: readonly ApiToken[]
}

export type ApiModelV2 = Omit<ApiModel<ObservedSurface>, 'version'> & { readonly version: 2 }

export interface ApiCompilation {
  readonly ok: boolean
  readonly api?: ApiModel
  readonly diagnostics: readonly ApiDiagnostic[]
  readonly dependencies?: readonly ApiCompilationDependency[]
}

export interface ApiCompilationDependency {
  readonly file: string
  readonly revision: string
}
