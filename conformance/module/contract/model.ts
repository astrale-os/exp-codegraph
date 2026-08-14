import type { Diagnostic } from '../../../source/diagnostic.ts'

export const MODULE_CONTRACT_ID = 'contract.module.v2'

export type DeclarationKind = 'value' | 'callable' | 'interface' | 'class'
export type DataType =
  | 'string'
  | 'boolean'
  | 'number'
  | 'bigint'
  | 'symbol'
  | 'object'
  | 'decimal'
  | 'bytes'
export type DependencyKind = 'api' | 'runtime' | 'type' | 'side-effect' | 'dynamic'
export type DeclarationConformance = 'exact' | 'identity'

export interface DeclarationIdentity {
  readonly key: string
  readonly source: string
  readonly pointer: string
  readonly kind: DeclarationKind
  readonly name: string
}

export type ExpectedTypeExpression =
  | { readonly kind: 'data'; readonly data: DataType }
  | {
      readonly kind: 'declaration'
      readonly declaration: DeclarationIdentity
      readonly arguments: readonly ExpectedTypeExpression[]
    }
  | { readonly kind: 'parameter'; readonly scope: string; readonly index: number }
  | { readonly kind: 'this'; readonly owner: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'null' }
  | { readonly kind: 'undefined' }
  | { readonly kind: 'void' }
  | { readonly kind: 'never' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'bigint-literal'; readonly value: string }
  | { readonly kind: 'template'; readonly texts: readonly string[]; readonly types: readonly ExpectedTypeExpression[] }
  | { readonly kind: 'array'; readonly element: ExpectedTypeExpression; readonly readonly?: boolean }
  | { readonly kind: 'record'; readonly key: ExpectedTypeExpression; readonly value: ExpectedTypeExpression }
  | { readonly kind: 'tuple'; readonly elements: readonly ExpectedTypeExpression[]; readonly readonly?: boolean }
  | { readonly kind: 'union'; readonly types: readonly ExpectedTypeExpression[] }
  | { readonly kind: 'intersection'; readonly types: readonly ExpectedTypeExpression[] }
  | {
      readonly kind: 'conditional'
      readonly check: ExpectedTypeExpression
      readonly extends: ExpectedTypeExpression
      readonly trueType: ExpectedTypeExpression
      readonly falseType: ExpectedTypeExpression
    }
  | { readonly kind: 'keyof'; readonly type: ExpectedTypeExpression }
  | { readonly kind: 'indexed-access'; readonly object: ExpectedTypeExpression; readonly index: ExpectedTypeExpression }
  | { readonly kind: 'object'; readonly members: readonly ExpectedMember[] }
  | { readonly kind: 'function'; readonly callable: ExpectedCallableType; readonly overloads?: readonly ExpectedCallableType[] }
  | { readonly kind: 'constructor'; readonly callable: ExpectedCallableType; readonly overloads?: readonly ExpectedCallableType[] }
  | {
      readonly kind: 'external'
      readonly target: string
      readonly name: string
      readonly arguments: readonly ExpectedTypeExpression[]
    }

export interface ExpectedCallableType {
  readonly pointer?: string
  readonly typeParameters?: readonly ExpectedTypeParameter[]
  readonly parameters: readonly ExpectedParameter[]
  readonly returns: ExpectedType
  readonly mode: 'sync' | 'async'
}

export interface ExpectedType {
  readonly expression: ExpectedTypeExpression
  readonly optional: boolean
  readonly pointer: string
}

export interface ExpectedParameter extends ExpectedType {
  readonly name: string
  readonly index: number
  readonly rest?: boolean
}

export interface ExpectedMember extends ExpectedType {
  readonly name: string
  readonly key: 'named' | 'unique-symbol'
  readonly readonly?: boolean
}

export interface ExpectedTypeParameter {
  readonly scope: string
  readonly index: number
  readonly name: string
  readonly variance?: 'in' | 'out' | 'in-out'
  readonly const?: boolean
  readonly constraint?: ExpectedType
  readonly default?: ExpectedType
  readonly pointer: string
}

export interface ExpectedCallableMember {
  readonly name: string
  readonly callable: DeclarationIdentity
  readonly optional?: boolean
  readonly pointer: string
}

export interface ExpectedTypeFacet {
  readonly pointer: string
  readonly conformance: DeclarationConformance
  readonly typeParameters?: readonly ExpectedTypeParameter[]
  readonly valueType?: ExpectedType
}

export interface ExpectedCallableValueFacet {
  readonly kind: 'callable'
  readonly pointer: string
  readonly conformance: DeclarationConformance
  readonly callable: DeclarationIdentity
}

export interface ExpectedObjectValueFacet {
  readonly kind: 'value'
  readonly pointer: string
  readonly conformance: DeclarationConformance
  readonly valueType: ExpectedType
}

export interface ExpectedDeclarationFacets {
  readonly type: ExpectedTypeFacet
  readonly value: ExpectedCallableValueFacet | ExpectedObjectValueFacet
}

export interface ExpectedDeclaration {
  readonly identity: DeclarationIdentity
  readonly alias?: DeclarationIdentity
  readonly pointer: string
  readonly conformance: DeclarationConformance
  readonly factory?: true
  readonly typeParameters?: readonly ExpectedTypeParameter[]
  readonly callableTypeParameters?: readonly ExpectedTypeParameter[]
  readonly valueType?: ExpectedType
  readonly fields?: readonly ExpectedMember[]
  readonly properties?: readonly ExpectedMember[]
  readonly callables?: readonly ExpectedCallableMember[]
  readonly statics?: readonly ExpectedCallableMember[]
  readonly extends?: readonly ExpectedType[]
  readonly implements?: readonly ExpectedType[]
  readonly parameters?: readonly ExpectedParameter[]
  readonly returns?: ExpectedType | null
  readonly mode?: 'sync' | 'async'
  readonly overloads?: readonly ExpectedCallableType[]
  readonly errors?: readonly string[]
  readonly facets?: ExpectedDeclarationFacets
}

export interface ExpectedExport {
  readonly path: readonly string[]
  readonly name: string
  readonly typeOnly: boolean
  readonly declaration: DeclarationIdentity
  readonly sourceModule?: string
  readonly pointer: string
}

export interface ExpectedPackage {
  readonly name: string
  readonly pointer: string
  readonly requireObserved?: boolean
}

export interface ExpectedPackagePattern {
  readonly pattern: string
  readonly pointer: string
}

export type ObligationKind =
  | 'module'
  | 'export'
  | 'declaration'
  | 'type-facet'
  | 'value-facet'
  | 'member'
  | 'parameter'
  | 'type-parameter'
  | 'value-type'
  | 'return'
  | 'mode'
  | 'overload'
  | 'error-code'
  | 'heritage'
  | 'import'
  | 'package'

export interface ProofObligation {
  readonly id: string
  readonly kind: ObligationKind
  readonly pointer: string
  readonly label: string
}

export interface ExpectedSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface ExpectedModule {
  readonly contract: typeof MODULE_CONTRACT_ID
  readonly id: string
  readonly source: string
  readonly name: string
  readonly declarations: readonly ExpectedDeclaration[]
  readonly exports: readonly ExpectedExport[]
  readonly imports: readonly DeclarationIdentity[]
  readonly packages: readonly ExpectedPackage[]
  readonly packagePatterns: readonly ExpectedPackagePattern[]
  readonly obligations: readonly ProofObligation[]
  readonly locations: Readonly<Record<string, ExpectedSourceLocation>>
}

export interface ModuleCompilation {
  readonly module?: ExpectedModule
  readonly references?: readonly ExpectedDeclaration[]
  readonly diagnostics: readonly Diagnostic[]
}

export function declarationKey(source: string, pointer: string): string {
  return `${source}#${pointer}`
}

export function expectedLocation(
  module: ExpectedModule,
  pointer: string,
): ExpectedSourceLocation & { readonly pointer?: string } {
  return module.locations[pointer] ?? { file: module.source, line: 1, column: 1, pointer }
}
