import type { Completeness, SourceSpan } from '../../../facts/.spec/api.js'
import type { FactId, SourceId, SourceRevisionId, SymbolId } from '../../../identity/.spec/api.js'
import type { TypeScriptSymbolOrigin } from '../../body/.spec/api.js'

/** Static symbolic uses in the loaded project's owned, non-declaration sources. */
export type TypeScriptReferenceKind = 'import' | 'export' | 'value' | 'type' | 'declaration'
export type TypeScriptFileDependencyKind = 'import' | 'export' | 'import-type' | 'dynamic' | 'require'

export interface TypeScriptStructuralSymbol {
  readonly symbol: SymbolId
  readonly name: string
  readonly declarations: readonly SourceSpan[]
  readonly origin?: TypeScriptSymbolOrigin
  readonly generationScoped: boolean
}

/** One explicit compiler inventory per source, including sources with no edges. */
export interface TypeScriptStructureFact {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly logicalPath: string
  readonly textDigest: string
  readonly symbols: readonly TypeScriptStructuralSymbol[]
  readonly exports: readonly { readonly name: string; readonly symbol: SymbolId; readonly typeOnly: boolean }[]
  readonly references: readonly {
    readonly symbol?: SymbolId
    readonly start: number
    readonly end: number
    readonly kind: TypeScriptReferenceKind
    readonly binding?: string
  }[]
  readonly dependencies: readonly {
    readonly start: number
    readonly end: number
    readonly kind: TypeScriptFileDependencyKind
    readonly typeOnly: boolean
    readonly specifier?: string
    readonly targetPath?: string
  }[]
  readonly completeness: {
    readonly exports: Completeness
    readonly references: Completeness
    readonly dependencies: Completeness
  }
}

export interface TypeScriptStructuralScope {
  readonly paths: readonly string[]
  readonly declarationFiles: false
  readonly externalSources: false
}

export interface TypeScriptStructuralInventory {
  readonly completeness: Completeness
  readonly scope: TypeScriptStructuralScope
  /** Contributing compiler facts; coverage also describes selections with no rows. */
  readonly evidence: readonly FactId[]
}

export interface TypeScriptExport extends TypeScriptStructuralSymbol {
  readonly name: string
  readonly typeOnly: boolean
}

export interface TypeScriptExportInventory extends TypeScriptStructuralInventory {
  readonly exports: readonly TypeScriptExport[]
}

export type TypeScriptReferenceTarget =
  | { readonly path: string; readonly name: string }
  | { readonly symbol: SymbolId }
  | { readonly origin: TypeScriptSymbolOrigin }

export interface TypeScriptReferenceQuery {
  readonly target: TypeScriptReferenceTarget
  readonly paths?: readonly string[]
  readonly includeDeclarations?: boolean
  readonly signal?: AbortSignal
}

export interface TypeScriptReference {
  readonly symbol: SymbolId
  readonly kind: TypeScriptReferenceKind
  readonly binding?: string
  readonly path: string
  readonly span: SourceSpan
}

export interface TypeScriptReferenceInventory extends TypeScriptStructuralInventory {
  readonly references: readonly TypeScriptReference[]
  /** An export selector is re-resolved in this snapshot; missing differs from unused. */
  readonly target: { readonly kind: 'resolved'; readonly symbols: readonly SymbolId[] }
    | { readonly kind: 'missing' }
    | { readonly kind: 'unavailable' }
}

export interface TypeScriptFileDependency {
  readonly path: string
  readonly span: SourceSpan
  readonly kind: TypeScriptFileDependencyKind
  readonly typeOnly: boolean
  readonly specifier?: string
  readonly targetPath?: string
}

export interface TypeScriptDependencyInventory extends TypeScriptStructuralInventory {
  readonly dependencies: readonly TypeScriptFileDependency[]
}

export interface TypeScriptDependent {
  readonly path: string
  /** One deterministic shortest observed dependency route to the requested file. */
  readonly via: readonly TypeScriptFileDependency[]
}

export interface TypeScriptDependentInventory extends TypeScriptStructuralInventory {
  readonly dependents: readonly TypeScriptDependent[]
}

export interface TypeScriptStructuralReader {
  exports(options: { readonly path: string; readonly signal?: AbortSignal }): Promise<TypeScriptExportInventory>
  references(options: TypeScriptReferenceQuery): Promise<TypeScriptReferenceInventory>
  dependencies(options?: { readonly paths?: readonly string[]; readonly signal?: AbortSignal }): Promise<TypeScriptDependencyInventory>
  dependents(options: { readonly path: string; readonly transitive?: boolean; readonly signal?: AbortSignal }): Promise<TypeScriptDependentInventory>
}
