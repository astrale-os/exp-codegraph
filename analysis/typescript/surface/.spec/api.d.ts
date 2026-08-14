export type SourceLocation = { readonly line: number; readonly column: number } & (
  | { readonly file: string; readonly external?: never }
  | { readonly file?: never; readonly external: string }
)

export interface ObservationIssue {
  readonly code: string
  readonly message: string
  readonly location?: SourceLocation
  readonly actual?: unknown
  readonly declaration?: string
}

export type ObservedType =
  | {
      readonly kind: 'primitive'
      readonly name: 'string' | 'boolean' | 'number' | 'bigint' | 'symbol' | 'object' | 'bytes'
    }
  | {
      readonly kind: 'reference'
      readonly identity: string
      readonly name: string
      readonly arguments: readonly ObservedType[]
    }
  | { readonly kind: 'parameter'; readonly scope: string; readonly index: number }
  | { readonly kind: 'this'; readonly owner: string }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'bigint-literal'; readonly value: string }
  | {
      readonly kind: 'template'
      readonly texts: readonly string[]
      readonly types: readonly ObservedType[]
    }
  | { readonly kind: 'array'; readonly element: ObservedType; readonly readonly: boolean }
  | { readonly kind: 'record'; readonly key: ObservedType; readonly value: ObservedType }
  | {
      readonly kind: 'tuple'
      readonly elements: readonly ObservedType[]
      readonly readonly: boolean
    }
  | { readonly kind: 'union'; readonly types: readonly ObservedType[] }
  | { readonly kind: 'intersection'; readonly types: readonly ObservedType[] }
  | {
      readonly kind: 'conditional'
      readonly check: ObservedType
      readonly extends: ObservedType
      readonly trueType: ObservedType
      readonly falseType: ObservedType
    }
  | { readonly kind: 'keyof'; readonly type: ObservedType }
  | { readonly kind: 'indexed-access'; readonly object: ObservedType; readonly index: ObservedType }
  | { readonly kind: 'object'; readonly members: readonly ObservedMember[] }
  | {
      readonly kind: 'function'
      readonly callable: ObservedCallable
      readonly overloads?: readonly ObservedCallable[]
    }
  | {
      readonly kind: 'constructor'
      readonly callable: ObservedCallable
      readonly overloads?: readonly ObservedCallable[]
    }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'null' | 'undefined' | 'void' | 'never' }
  | { readonly kind: 'unsupported'; readonly reason: string; readonly display: string }

export interface ObservedParameter {
  readonly name: string
  readonly index: number
  readonly optional: boolean
  readonly rest: boolean
  readonly type: ObservedType
  readonly location: SourceLocation
}

export interface ObservedCallable {
  readonly typeParameters?: readonly ObservedTypeParameter[]
  readonly parameters: readonly ObservedParameter[]
  readonly returns: ObservedType
  readonly mode: 'sync' | 'async'
  readonly location: SourceLocation
  readonly issues: readonly ObservationIssue[]
}

export interface ObservedMember {
  readonly name: string
  readonly key: 'named' | 'unique-symbol'
  readonly optional: boolean
  readonly readonly: boolean
  readonly type?: ObservedType
  readonly callable?: ObservedCallable
  readonly overloads?: readonly ObservedCallable[]
  readonly location: SourceLocation
}

export interface ObservedTypeParameter {
  readonly scope: string
  readonly index: number
  readonly name: string
  readonly variance?: 'in' | 'out' | 'in-out'
  readonly const?: boolean
  readonly constraint?: ObservedType
  readonly default?: ObservedType
  readonly location: SourceLocation
}

export interface ObservedTypeFacet {
  readonly kind: 'type-alias'
  readonly valueType: ObservedType
  readonly location: SourceLocation
}

export interface ObservedCallableValueFacet {
  readonly kind: 'callable'
  readonly callable: ObservedCallable
  readonly overloads?: readonly ObservedCallable[]
  readonly location: SourceLocation
}

export interface ObservedObjectValueFacet {
  readonly kind: 'value'
  readonly valueType: ObservedType
  readonly location: SourceLocation
}

export interface ObservedDeclarationFacets {
  readonly type: ObservedTypeFacet
  readonly value: ObservedCallableValueFacet | ObservedObjectValueFacet
}

export type ObservedDeclarationKind =
  | 'value'
  | 'callable'
  | 'factory'
  | 'interface'
  | 'class'
  | 'namespace'
  | 'unsupported'

export interface ObservedDeclaration {
  readonly identity: string
  readonly name: string
  readonly kind: ObservedDeclarationKind
  readonly location: SourceLocation
  readonly packageCoordinate?: string
  readonly exportPaths: readonly (readonly string[])[]
  readonly typeParameters?: readonly ObservedTypeParameter[]
  readonly fields?: readonly ObservedMember[]
  readonly valueType?: ObservedType
  readonly callSignatureCount?: number
  readonly constructSignatureCount?: number
  readonly indexSignatureCount?: number
  readonly properties?: readonly ObservedMember[]
  readonly callables?: readonly ObservedMember[]
  readonly statics?: readonly ObservedMember[]
  readonly callable?: ObservedCallable
  readonly overloads?: readonly ObservedCallable[]
  readonly facets?: ObservedDeclarationFacets
  readonly extends?: readonly string[]
  readonly implements?: readonly string[]
  readonly referencedDeclarations: readonly string[]
  readonly issues: readonly ObservationIssue[]
}

export interface ObservedExport {
  readonly path: readonly string[]
  readonly name: string
  readonly declaration: string
  readonly kind: ObservedDeclarationKind
  readonly typeOnly: boolean
  readonly sourceModule?: string
  readonly location: SourceLocation
}

export interface ObservedSurface {
  readonly exports: readonly ObservedExport[]
  readonly declarations: readonly ObservedDeclaration[]
  readonly issues: readonly ObservationIssue[]
}
