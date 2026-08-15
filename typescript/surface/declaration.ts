import { basename, dirname } from 'node:path'
import ts from 'typescript'

import type {
  ObservationIssue,
  ObservedCallable,
  ObservedDeclaration,
  ObservedDeclarationKind,
  ObservedMember,
  ObservedParameter,
  ObservedType,
  ObservedTypeParameter,
} from '../../analysis/typescript/surface/model.ts'
import type { DeclarationSurfaceSemantics } from './semantics.ts'

import {
  canonicalTypeProviderCoordinate,
  workspacePackageCoordinate,
} from '../package-coordinate.ts'
import {
  canonicalSymbolIdentity,
  declarationKind,
  factoryFacetDeclarations,
  firstDeclaration,
  isStableDeclarationSymbol,
  locationOf,
  referencedSymbol,
  resolveAlias,
  symbolWithinCatalog,
} from './symbol.ts'

export function observeDeclaration(
  catalogRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  exportPaths: readonly (readonly string[])[],
  semantics: DeclarationSurfaceSemantics,
): { declaration: ObservedDeclaration; references: ReadonlyMap<string, ts.Symbol> } {
  const identity = canonicalSymbolIdentity(catalogRoot, symbol)
  const kind = declarationKind(checker, symbol)
  const declaration = firstDeclaration(symbol)
  const physicalPackageCoordinate = declaration
    ? workspacePackageCoordinate(catalogRoot, declaration.getSourceFile().fileName)
    : undefined
  const packageCoordinate = physicalPackageCoordinate
    ? canonicalTypeProviderCoordinate(physicalPackageCoordinate)
    : undefined
  const issues: ObservationIssue[] = []
  const references = new Map<string, ts.Symbol>()
  const parameterNodes = declarationTypeParameters(declaration)
  const normalizer = new TypeNormalizer(
    catalogRoot,
    checker,
    references,
    issues,
    parameterNodes,
    declaration ? typeParameterScope(catalogRoot, declaration) : identity,
    undefined,
    semantics,
  )
  const typeParameters = normalizer.observeTypeParameters(parameterNodes)
  const base = {
    identity,
    name: symbol.getName(),
    kind,
    location: locationOf(catalogRoot, declaration),
    ...(packageCoordinate ? { packageCoordinate } : {}),
    exportPaths,
    ...(typeParameters.length ? { typeParameters } : {}),
    referencedDeclarations: [] as string[],
    issues,
  }

  reportDeclarationMerging(symbol, kind, catalogRoot, issues)
  if (kind === 'factory') {
    for (let index = 0; index < issues.length; index++) {
      issues[index] = { ...issues[index]!, declaration: `${identity}#factory` }
    }
  }
  let result: ObservedDeclaration
  if (kind === 'factory') {
    const facets = factoryFacetDeclarations(checker, symbol)
    if (!facets) throw new Error('Factory declaration classification lost its facets.')

    const typeIssues: ObservationIssue[] = []
    const typeReferences = new Map<string, ts.Symbol>()
    const typeNormalizer = new TypeNormalizer(
      catalogRoot,
      checker,
      typeReferences,
      typeIssues,
      [...(facets.type.typeParameters ?? [])],
      typeParameterScope(catalogRoot, facets.type),
      undefined,
      semantics,
    )
    const type = checker.getTypeAtLocation(facets.type.type)
    const typeFacetValue = typeNormalizer.normalize(type, facets.type.type)
    const authoredTypeIssues: ObservationIssue[] = []
    const authoredTypeReferences = new Map<string, ts.Symbol>()
    const authoredTypeNormalizer = new TypeNormalizer(
      catalogRoot,
      checker,
      authoredTypeReferences,
      authoredTypeIssues,
      [...(facets.type.typeParameters ?? [])],
      typeParameterScope(catalogRoot, facets.type),
      symbol,
      semantics,
    )
    const authoredTypeValue = authoredTypeNormalizer.normalize(type, facets.type.type)
    for (const [referenceIdentity, reference] of typeReferences) {
      references.set(referenceIdentity, reference)
    }
    for (const [referenceIdentity, reference] of authoredTypeReferences) {
      references.set(referenceIdentity, reference)
    }
    issues.push(...typeIssues.map((issue) => ({ ...issue, declaration: identity })))

    const valueIssues: ObservationIssue[] = []
    const valueNormalizer = new TypeNormalizer(
      catalogRoot,
      checker,
      references,
      valueIssues,
      [],
      'unbound',
      undefined,
      semantics,
    )
    const valueType = checker.getTypeOfSymbolAtLocation(symbol, facets.value)
    const signatures = callablesOfType(
      catalogRoot,
      checker,
      valueType,
      facets.value,
      valueNormalizer,
      valueIssues,
    )
    const callable = signatures?.[0]
    issues.push(...valueIssues.map((issue) => ({ ...issue, declaration: `${identity}#value` })))
    result = {
      ...base,
      facets: {
        type: {
          kind: 'type-alias',
          valueType: typeFacetValue,
          authoredValueType: authoredTypeValue,
          location: locationOf(catalogRoot, facets.type),
        },
        value: callable
          ? {
              kind: 'callable',
              callable,
              ...(signatures.length > 1 ? { overloads: signatures } : {}),
              location: locationOf(catalogRoot, facets.value),
            }
          : {
              kind: 'value',
              valueType: valueNormalizer.normalize(valueType, facets.value),
              location: locationOf(catalogRoot, facets.value),
            },
      },
    }
  } else if (kind === 'callable') {
    const signatures = callablesOfSymbol(catalogRoot, checker, symbol, normalizer, issues)
    const type = declaredValueType(checker, symbol, declaration)
    result = {
      ...base,
      callable: signatures?.[0],
      ...(signatures && signatures.length > 1 ? { overloads: signatures } : {}),
      ...(type && declaration ? { valueType: normalizer.normalize(type, declaration) } : {}),
    }
  } else if (kind === 'interface' || kind === 'class') {
    const instanceType = checker.getDeclaredTypeOfSymbol(symbol)
    reportUnsupportedDeclaredShape(catalogRoot, checker, instanceType, declaration, issues)
    const signatures =
      declaration && hasOwnCallSignature(declaration)
        ? callablesOfType(catalogRoot, checker, instanceType, declaration, normalizer, issues)
        : undefined
    const callable = signatures?.[0]
    const ownMembers = membersOfType(
      catalogRoot,
      checker,
      instanceType,
      declaration,
      normalizer,
      issues,
    )
    const properties = ownMembers.filter((member) => member.type !== undefined)
    const callables = ownMembers.filter((member) => member.callable !== undefined)
    const statics =
      kind === 'class'
        ? staticMembersOfClass(catalogRoot, checker, symbol, declaration, normalizer, issues)
        : undefined
    const heritage = heritageOf(catalogRoot, checker, declaration, references, issues)
    result = {
      ...base,
      properties,
      callables,
      ...(callable ? { callable } : {}),
      ...(signatures && signatures.length > 1 ? { overloads: signatures } : {}),
      statics,
      extends: heritage.extends,
      implements: heritage.implements,
    }
  } else if (kind === 'value') {
    const type = declaredValueType(checker, symbol, declaration)
    const valueType = type && declaration ? normalizer.normalize(type, declaration) : undefined
    const structural = type && valueType?.kind === 'object'
    const members = structural
      ? membersOfType(catalogRoot, checker, type, declaration, normalizer, issues)
      : undefined
    const fields = members?.filter((member) => member.type !== undefined)
    const callables = members?.filter((member) => member.callable !== undefined)
    result = {
      ...base,
      fields,
      callables,
      valueType,
      callSignatureCount: type
        ? checker.getSignaturesOfType(type, ts.SignatureKind.Call).length
        : 0,
      constructSignatureCount: type
        ? checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length
        : 0,
      indexSignatureCount: structural ? checker.getIndexInfosOfType(type).length : 0,
    }
  } else {
    issues.push({
      code: 'TYPESCRIPT_DECLARATION_KIND_UNSUPPORTED',
      message: `Unsupported exported declaration kind for ${symbol.getName()}.`,
      location: locationOf(catalogRoot, declaration),
    })
    result = base
  }
  return {
    declaration: {
      ...result,
      referencedDeclarations: [...references.keys()].sort(compare),
      issues: deduplicateIssues(issues),
    },
    references,
  }
}

class TypeNormalizer {
  readonly #active = new Set<ts.Type>()
  readonly #typeParameterBindings = new Map<
    ts.Symbol,
    { readonly scope: string; readonly index: number }
  >()
  readonly catalogRoot: string
  readonly checker: ts.TypeChecker
  readonly references: Map<string, ts.Symbol>
  readonly issues: ObservationIssue[]
  readonly declaringAlias?: ts.Symbol
  readonly semantics: DeclarationSurfaceSemantics

  constructor(
    catalogRoot: string,
    checker: ts.TypeChecker,
    references: Map<string, ts.Symbol>,
    issues: ObservationIssue[],
    typeParameters: readonly ts.TypeParameterDeclaration[] = [],
    typeParameterScope = 'unbound',
    declaringAlias?: ts.Symbol,
    semantics: DeclarationSurfaceSemantics = 'specification-v2',
  ) {
    this.catalogRoot = catalogRoot
    this.checker = checker
    this.references = references
    this.issues = issues
    this.declaringAlias = declaringAlias
    this.semantics = semantics
    for (const [index, parameter] of typeParameters.entries()) {
      const symbol = this.checker.getSymbolAtLocation(parameter.name)
      if (symbol) this.#typeParameterBindings.set(symbol, { scope: typeParameterScope, index })
    }
  }

  observeTypeParameters(
    parameters: readonly ts.TypeParameterDeclaration[],
  ): ObservedTypeParameter[] {
    return parameters.map((parameter, index) => ({
      scope:
        this.#typeParameterBindings.get(this.checker.getSymbolAtLocation(parameter.name)!)?.scope ??
        'unbound',
      index,
      name: parameter.name.text,
      ...typeParameterModifiers(parameter),
      ...(parameter.constraint
        ? {
            constraint: this.normalize(
              this.checker.getTypeFromTypeNode(parameter.constraint),
              parameter.constraint,
            ),
          }
        : {}),
      ...(parameter.default
        ? {
            default: this.normalize(
              this.checker.getTypeFromTypeNode(parameter.default),
              parameter.default,
            ),
          }
        : {}),
      location: locationOf(this.catalogRoot, parameter),
    }))
  }

  bindTypeParameters(
    parameters: readonly ts.TypeParameterDeclaration[],
    scope: string,
  ): () => void {
    const previous: Array<
      readonly [ts.Symbol, { readonly scope: string; readonly index: number } | undefined]
    > = []
    for (const [index, parameter] of parameters.entries()) {
      const symbol = this.checker.getSymbolAtLocation(parameter.name)
      if (!symbol) continue
      previous.push([symbol, this.#typeParameterBindings.get(symbol)])
      this.#typeParameterBindings.set(symbol, { scope, index })
    }
    return () => {
      for (const [symbol, index] of previous) {
        if (index === undefined) this.#typeParameterBindings.delete(symbol)
        else this.#typeParameterBindings.set(symbol, index)
      }
    }
  }

  normalize(type: ts.Type, location: ts.Node): ObservedType {
    const authoredAlgebra =
      this.semantics === 'specification-v2'
        ? authoredAlgebraicType(this.checker, type, location)
        : externalAuthoredIntersection(this.catalogRoot, this.checker, location)
    if (authoredAlgebra) {
      return {
        kind: authoredAlgebra.kind,
        types: canonicalTypes(
          authoredAlgebra.types.map((item) =>
            this.normalize(this.checker.getTypeFromTypeNode(item), item),
          ),
        ),
      }
    }
    if (this.#active.has(type)) {
      const opaqueUnion = authoredOpaqueUnknownUnion(this.checker, type, location)
      if (opaqueUnion) {
        return {
          kind: 'union',
          types: canonicalTypes(
            opaqueUnion.map((item) => this.normalize(this.checker.getTypeFromTypeNode(item), item)),
          ),
        }
      }
      const intrinsic = recursiveIntrinsicType(this.checker, type, this.semantics)
      if (intrinsic) return intrinsic
      const explicit = selectedValueMemberTypeQuery(this.checker, location)
        ? undefined
        : (explicitReferenceSymbol(this.checker, location) ??
          (type.aliasSymbol && isStableDeclarationSymbol(type.aliasSymbol)
            ? type.aliasSymbol
            : undefined) ??
          (() => {
            const named = referencedSymbol(type)
            return named && isStableDeclarationSymbol(named) ? named : undefined
          })())
      if (explicit) {
        const identity = canonicalSymbolIdentity(this.catalogRoot, explicit)
        this.references.set(identity, explicit)
        return {
          kind: 'reference',
          identity,
          name: explicit.getName(),
          arguments: this.referenceArguments(type, location),
        }
      }
      const display = '<recursive TypeScript type>'
      this.issues.push({
        code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
        message: 'Cannot establish conformance for an anonymous recursive type.',
        location: locationOf(this.catalogRoot, location),
        actual: display,
      })
      return { kind: 'unsupported', reason: 'anonymous recursive type', display }
    }
    this.#active.add(type)
    try {
      return this.normalizeActive(type, location)
    } finally {
      this.#active.delete(type)
    }
  }

  private normalizeActive(type: ts.Type, location: ts.Node): ObservedType {
    const sourceType = unwrappedTypeNodeAt(location)
    if (this.semantics === 'specification-v2') {
      const authored = this.normalizeAuthoredType(type, sourceType)
      if (authored) return authored
    }
    const record = recordTypeNodes(location)
    if (record) {
      return {
        kind: 'record',
        key: this.normalize(this.checker.getTypeFromTypeNode(record.key), record.key),
        value: this.normalize(this.checker.getTypeFromTypeNode(record.value), record.value),
      }
    }
    const builtIn = builtInReferenceType(this.checker, type, location)
    if (builtIn) {
      if (builtIn === 'Uint8Array' || builtIn === 'ArrayBuffer') {
        return { kind: 'primitive', name: 'bytes' }
      }
      return {
        kind: 'reference',
        identity: `platform:typescript#${builtIn}`,
        name: builtIn,
        arguments: this.referenceArguments(type, location),
      }
    }
    const alias = type.aliasSymbol
    const selectedValueMember = selectedValueMemberTypeQuery(this.checker, location)
    const locationAlias = ts.isTypeAliasDeclaration(location)
      ? this.checker.getSymbolAtLocation(location.name)
      : undefined
    const declaringAlias =
      Boolean(alias && this.declaringAlias && resolveAlias(this.checker, this.declaringAlias) === alias) ||
      (Boolean(alias && locationAlias) && resolveAlias(this.checker, locationAlias!) === alias)
    const authoredReference = selectedValueMember
      ? undefined
      : explicitReferenceSymbol(this.checker, location)
    const explicit = declaringAlias && authoredReference === alias ? undefined : authoredReference
    if (explicit) {
      const name = explicit.getName()
      if (name === 'Uint8Array' || name === 'ArrayBuffer')
        return { kind: 'primitive', name: 'bytes' }
      const identity = canonicalSymbolIdentity(this.catalogRoot, explicit)
      this.references.set(identity, explicit)
      return {
        kind: 'reference',
        identity,
        name,
        arguments: this.referenceArguments(type, location),
      }
    }
    if (sourceType && ts.isConditionalTypeNode(sourceType)) {
      return {
        kind: 'conditional',
        check: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.checkType),
          sourceType.checkType,
        ),
        extends: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.extendsType),
          sourceType.extendsType,
        ),
        trueType: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.trueType),
          sourceType.trueType,
        ),
        falseType: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.falseType),
          sourceType.falseType,
        ),
      }
    }
    if (
      sourceType &&
      ts.isTypeOperatorNode(sourceType) &&
      sourceType.operator === ts.SyntaxKind.KeyOfKeyword
    ) {
      return {
        kind: 'keyof',
        type: this.normalize(this.checker.getTypeFromTypeNode(sourceType.type), sourceType.type),
      }
    }
    if (sourceType && ts.isIndexedAccessTypeNode(sourceType)) {
      return {
        kind: 'indexed-access',
        object: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.objectType),
          sourceType.objectType,
        ),
        index: this.normalize(
          this.checker.getTypeFromTypeNode(sourceType.indexType),
          sourceType.indexType,
        ),
      }
    }
    const opaqueUnion = authoredOpaqueUnknownUnion(this.checker, type, location)
    if (opaqueUnion) {
      return {
        kind: 'union',
        types: canonicalTypes(
          opaqueUnion.map((item) => this.normalize(this.checker.getTypeFromTypeNode(item), item)),
        ),
      }
    }
    if (type.flags & ts.TypeFlags.Any) return this.unsupported('any', type, location)
    if (type.flags & ts.TypeFlags.Unknown) return { kind: 'unknown' }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const symbol = type.symbol
      const binding = symbol ? this.#typeParameterBindings.get(symbol) : undefined
      if (binding) return { kind: 'parameter', ...binding }
      return this.unsupported('unbound type parameter', type, location)
    }
    if (type.flags & ts.TypeFlags.TemplateLiteral) {
      const template = type as ts.TemplateLiteralType
      const sourceType = unwrappedTypeNodeAt(location)
      const nodes =
        sourceType && ts.isTemplateLiteralTypeNode(sourceType)
          ? sourceType.templateSpans.map((span) => span.type)
          : undefined
      return {
        kind: 'template',
        texts: [...template.texts],
        types: template.types.map((item, index) =>
          this.normalize(item, nodes?.[index] ?? location),
        ),
      }
    }
    if (type.flags & ts.TypeFlags.String) return { kind: 'primitive', name: 'string' }
    if (type.flags & ts.TypeFlags.Boolean) return { kind: 'primitive', name: 'boolean' }
    if (type.flags & ts.TypeFlags.Number) return { kind: 'primitive', name: 'number' }
    if (type.flags & ts.TypeFlags.BigInt)
      return {
        kind: 'primitive',
        name: this.semantics === 'specification-v2' ? 'bigint' : 'number',
      }
    if (this.semantics === 'specification-v2' && type.flags & ts.TypeFlags.ESSymbol) {
      return { kind: 'primitive', name: 'symbol' }
    }
    if (this.semantics === 'specification-v2' && type.flags & ts.TypeFlags.NonPrimitive) {
      return { kind: 'primitive', name: 'object' }
    }
    if (type.flags & ts.TypeFlags.Undefined) return { kind: 'undefined' }
    if (type.flags & ts.TypeFlags.Null) return { kind: 'null' }
    if (type.flags & ts.TypeFlags.Void) return { kind: 'void' }
    if (type.flags & ts.TypeFlags.Never) return { kind: 'never' }
    if (type.isStringLiteral()) return { kind: 'literal', value: type.value }
    if (type.isNumberLiteral()) return { kind: 'literal', value: type.value }
    if (this.semantics === 'specification-v2' && type.flags & ts.TypeFlags.BigIntLiteral) {
      return bigintLiteral(type, location)
    }
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
      return { kind: 'literal', value: type === this.checker.getTrueType() }
    }
    if (alias && !declaringAlias && isStableDeclarationSymbol(alias)) {
      const identity = canonicalSymbolIdentity(this.catalogRoot, alias)
      this.references.set(identity, alias)
      return {
        kind: 'reference',
        identity,
        name: alias.getName(),
        arguments: this.referenceArguments(type, location),
      }
    }
    if (type.isUnion()) {
      const sourceType = unwrappedTypeNodeAt(location)
      if (
        sourceType &&
        ts.isUnionTypeNode(sourceType) &&
        hasExplicitExternalConstituent(this.catalogRoot, this.checker, sourceType.types)
      ) {
        return {
          kind: 'union',
          types: canonicalTypes(
            sourceType.types.map((item) =>
              this.normalize(this.checker.getTypeFromTypeNode(item), item),
            ),
          ),
        }
      }
      const nodes =
        sourceType && ts.isUnionTypeNode(sourceType)
          ? constituentTypeNodes(this.checker, type.types, sourceType.types)
          : undefined
      return {
        kind: 'union',
        types: canonicalTypes(
          type.types.map((item, index) => this.normalize(item, nodes?.[index] ?? location)),
        ),
      }
    }
    if (type.isIntersection()) {
      const sourceType = unwrappedTypeNodeAt(location)
      if (
        sourceType &&
        ts.isIntersectionTypeNode(sourceType) &&
        hasExplicitExternalConstituent(this.catalogRoot, this.checker, sourceType.types)
      ) {
        return {
          kind: 'intersection',
          types: canonicalTypes(
            sourceType.types.map((item) =>
              this.normalize(this.checker.getTypeFromTypeNode(item), item),
            ),
          ),
        }
      }
      const nodes =
        sourceType && ts.isIntersectionTypeNode(sourceType)
          ? constituentTypeNodes(this.checker, type.types, sourceType.types)
          : undefined
      return {
        kind: 'intersection',
        types: canonicalTypes(
          type.types.map((item, index) => this.normalize(item, nodes?.[index] ?? location)),
        ),
      }
    }
    if (this.checker.isTupleType(type)) {
      const reference = type as ts.TypeReference
      const sourceType = unwrappedTypeNodeAt(location)
      const elementNodes =
        sourceType && ts.isTupleTypeNode(sourceType) ? sourceType.elements : undefined
      return {
        kind: 'tuple',
        elements: this.checker
          .getTypeArguments(reference)
          .map((item, index) =>
            this.normalize(
              item,
              tupleElementLocation(this.checker, item, elementNodes?.[index]) ?? location,
            ),
          ),
        readonly: isReadonlyTuple(reference),
      }
    }
    if (this.checker.isArrayType(type)) {
      const reference = type as ts.TypeReference
      const element = this.checker.getTypeArguments(reference)[0]
      const sourceType = unwrappedTypeNodeAt(location)
      const elementNode = sourceType
        ? ts.isArrayTypeNode(sourceType)
          ? sourceType.elementType
          : ts.isTypeReferenceNode(sourceType)
            ? sourceType.typeArguments?.[0]
            : undefined
        : undefined
      return {
        kind: 'array',
        element: element
          ? this.normalize(element, elementNode ?? location)
          : this.unsupported('array element', type, location),
        readonly: type.symbol?.getName() === 'ReadonlyArray',
      }
    }

    const named = referencedSymbol(type)
    if (
      !selectedValueMember &&
      named &&
      !(declaringAlias && named === alias) &&
      isStableDeclarationSymbol(named)
    ) {
      const name = named.getName()
      if (name === 'Uint8Array' || name === 'ArrayBuffer')
        return { kind: 'primitive', name: 'bytes' }
      const identity = canonicalSymbolIdentity(this.catalogRoot, named)
      this.references.set(identity, named)
      return {
        kind: 'reference',
        identity,
        name,
        arguments: this.referenceArguments(type, location),
      }
    }

    if (type.flags & ts.TypeFlags.Object) {
      const callSignatureCount = this.checker.getSignaturesOfType(
        type,
        ts.SignatureKind.Call,
      ).length
      if (callSignatureCount > 0) {
        const signatures = callablesOfType(
          this.catalogRoot,
          this.checker,
          type,
          location,
          this,
          this.issues,
        )
        const callable = signatures?.[0]
        if (callable) {
          return {
            kind: 'function',
            callable,
            ...(signatures.length > 1 ? { overloads: signatures } : {}),
          }
        }
      }
      const constructSignatures = this.checker.getSignaturesOfType(
        type,
        ts.SignatureKind.Construct,
      )
      if (this.semantics === 'specification-v2' && constructSignatures.length > 0) {
        const signatures = callablesOfType(
          this.catalogRoot,
          this.checker,
          type,
          location,
          this,
          this.issues,
          ts.SignatureKind.Construct,
        )
        const callable = signatures?.[0]
        if (callable) {
          return {
            kind: 'constructor',
            callable,
            ...(signatures.length > 1 ? { overloads: signatures } : {}),
          }
        }
      }
      const indexes = this.checker.getIndexInfosOfType(type)
      const properties = this.checker.getPropertiesOfType(type)
      if (indexes.length === 1 && properties.length === 0) {
        const index = indexes[0]!
        const declaration = index.declaration
        return {
          kind: 'record',
          key: this.normalize(index.keyType, declaration?.parameters[0]?.type ?? location),
          value: this.normalize(index.type, declaration?.type ?? location),
        }
      }
      if (indexes.length > 0)
        return this.unsupported('mixed object index signature', type, location)
      const members = membersOfType(
        this.catalogRoot,
        this.checker,
        type,
        undefined,
        this,
        this.issues,
      )
      return { kind: 'object', members }
    }
    return this.unsupported('type', type, location)
  }

  private normalizeAuthoredType(
    type: ts.Type,
    node: ts.TypeNode | undefined,
  ): ObservedType | undefined {
    if (!node) return
    // The checker may materialize a fresh polymorphic-this wrapper for each query;
    // the authored node and its lexical owner remain the exact public evidence.
    if (ts.isThisTypeNode(node)) {
      const owner = containingTypeSymbol(this.checker, node)
      if (owner) {
        return { kind: 'this', owner: canonicalSymbolIdentity(this.catalogRoot, owner) }
      }
      return this.unsupported('unresolved this-type owner', type, node)
    }
    if (this.checker.getTypeFromTypeNode(node) !== type) return
    if (ts.isConditionalTypeNode(node)) {
      return {
        kind: 'conditional',
        check: this.normalize(this.checker.getTypeFromTypeNode(node.checkType), node.checkType),
        extends: this.normalize(
          this.checker.getTypeFromTypeNode(node.extendsType),
          node.extendsType,
        ),
        trueType: this.normalize(
          this.checker.getTypeFromTypeNode(node.trueType),
          node.trueType,
        ),
        falseType: this.normalize(
          this.checker.getTypeFromTypeNode(node.falseType),
          node.falseType,
        ),
      }
    }
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
      return {
        kind: 'keyof',
        type: this.normalize(this.checker.getTypeFromTypeNode(node.type), node.type),
      }
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      return {
        kind: 'indexed-access',
        object: this.normalize(
          this.checker.getTypeFromTypeNode(node.objectType),
          node.objectType,
        ),
        index: this.normalize(this.checker.getTypeFromTypeNode(node.indexType), node.indexType),
      }
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      return {
        kind: 'template',
        texts: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)],
        types: node.templateSpans.map((span) =>
          this.normalize(this.checker.getTypeFromTypeNode(span.type), span.type),
        ),
      }
    }
    if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
      const signatureKind = ts.isConstructorTypeNode(node)
        ? ts.SignatureKind.Construct
        : ts.SignatureKind.Call
      const signatures = callablesOfType(
        this.catalogRoot,
        this.checker,
        type,
        node,
        this,
        this.issues,
        signatureKind,
      )
      const callable = signatures?.[0]
      if (!callable) return this.unsupported('callable type', type, node)
      return {
        kind: ts.isConstructorTypeNode(node) ? 'constructor' : 'function',
        callable,
        ...(signatures.length > 1 ? { overloads: signatures } : {}),
      }
    }
    if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: 'primitive', name: 'string' }
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'primitive', name: 'boolean' }
    if (node.kind === ts.SyntaxKind.NumberKeyword) return { kind: 'primitive', name: 'number' }
    if (node.kind === ts.SyntaxKind.BigIntKeyword) return { kind: 'primitive', name: 'bigint' }
    if (node.kind === ts.SyntaxKind.SymbolKeyword) return { kind: 'primitive', name: 'symbol' }
    if (node.kind === ts.SyntaxKind.ObjectKeyword) return { kind: 'primitive', name: 'object' }
    if (ts.isLiteralTypeNode(node)) return literalType(node, type)
    return
  }

  private unsupported(reason: string, type: ts.Type, node: ts.Node): ObservedType {
    let display: string
    try {
      display = this.checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation)
    } catch {
      display = '<unprintable TypeScript type>'
    }
    this.issues.push({
      code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
      message: `Cannot establish conformance for ${reason}: ${display}`,
      location: locationOf(this.catalogRoot, node),
      actual: display,
    })
    return { kind: 'unsupported', reason, display }
  }

  private referenceArguments(type: ts.Type, location: ts.Node): ObservedType[] {
    const node = typeNodeAt(location)
    if (node && ts.isTypeQueryNode(node)) return []
    if (node && (ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node))) {
      return (node.typeArguments ?? []).map((argument) =>
        this.normalize(this.checker.getTypeFromTypeNode(argument), argument),
      )
    }
    const argumentsFromAlias = type.aliasTypeArguments
    if (argumentsFromAlias?.length) {
      return argumentsFromAlias.map((argument) => this.normalize(argument, location))
    }
    if (type.flags & ts.TypeFlags.Object) {
      return this.checker
        .getTypeArguments(type as ts.TypeReference)
        .map((argument) => this.normalize(argument, location))
    }
    return []
  }
}

function callablesOfSymbol(
  catalogRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  normalizer: TypeNormalizer,
  issues: ObservationIssue[],
): readonly ObservedCallable[] | undefined {
  const declaration = firstDeclaration(symbol)
  if (!declaration) return undefined
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  return callablesOfType(catalogRoot, checker, type, declaration, normalizer, issues)
}

function callablesOfType(
  catalogRoot: string,
  checker: ts.TypeChecker,
  type: ts.Type,
  declaration: ts.Node,
  normalizer: TypeNormalizer,
  issues: ObservationIssue[],
  signatureKind: ts.SignatureKind = ts.SignatureKind.Call,
): readonly ObservedCallable[] | undefined {
  const signatures = checker.getSignaturesOfType(type, signatureKind)
  if (!signatures.length) return undefined
  return signatures.map((signature) =>
    callableOfSignature(catalogRoot, checker, signature, declaration, normalizer, issues),
  )
}

function callableOfSignature(
  catalogRoot: string,
  checker: ts.TypeChecker,
  signature: ts.Signature,
  declaration: ts.Node,
  normalizer: TypeNormalizer,
  issues: ObservationIssue[],
): ObservedCallable {
  const signatureDeclaration = signature.getDeclaration()
  const typeParameterNodes = signatureDeclaration?.typeParameters
    ? [...signatureDeclaration.typeParameters]
    : []
  const restoreTypeParameters = normalizer.bindTypeParameters(
    typeParameterNodes,
    typeParameterScope(catalogRoot, signatureDeclaration ?? declaration),
  )
  const typeParameters = normalizer.observeTypeParameters(typeParameterNodes)
  if (signature.thisParameter) {
    issues.push({
      code: 'TYPESCRIPT_THIS_PARAMETER_UNSUPPORTED',
      message: 'Explicit public this parameters cannot be proven by the authored declaration contract.',
      location: locationOf(
        catalogRoot,
        signature.thisParameter.valueDeclaration ??
          firstDeclaration(signature.thisParameter) ??
          declaration,
      ),
    })
  }
  try {
    const parameters: ObservedParameter[] = signature.getParameters().map((parameter, index) => {
      const parameterDeclaration =
        parameter.valueDeclaration ?? firstDeclaration(parameter) ?? declaration
      const type = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration)
      const rest =
        ts.isParameter(parameterDeclaration) && Boolean(parameterDeclaration.dotDotDotToken)
      const optional =
        Boolean(parameter.flags & ts.SymbolFlags.Optional) ||
        (ts.isParameter(parameterDeclaration) &&
          Boolean(parameterDeclaration.questionToken || parameterDeclaration.initializer))
      const authoredOptionalType =
        normalizer.semantics === 'specification-v2' &&
        optional &&
        ts.isParameter(parameterDeclaration) &&
        parameterDeclaration.type &&
        !typeNodeContainsTypeParameter(checker, parameterDeclaration.type)
          ? parameterDeclaration.type
          : undefined
      const normalized = authoredOptionalType
        ? normalizer.normalize(checker.getTypeFromTypeNode(authoredOptionalType), authoredOptionalType)
        : normalizer.normalize(type, parameterDeclaration)
      return {
        name: parameter.getName(),
        index,
        optional,
        rest,
        type: optional ? withoutUndefined(normalized) : normalized,
        location: locationOf(catalogRoot, parameterDeclaration),
      }
    })
    const rawReturn = checker.getReturnTypeOfSignature(signature)
    const promised = promiseArgument(checker, rawReturn)
    const returnNode = signatureDeclaration && callableReturnTypeNode(signatureDeclaration)
    const assertedReturnNode =
      normalizer.semantics === 'specification-v2' && !returnNode
        ? callableReturnAssertionTypeNode(signatureDeclaration ?? declaration)
        : undefined
    const returnEvidenceNode = returnNode ?? assertedReturnNode
    const normalizedReturnNode =
      promised && returnEvidenceNode && ts.isTypeReferenceNode(returnEvidenceNode)
        ? (returnEvidenceNode.typeArguments?.[0] ?? returnEvidenceNode)
        : (returnEvidenceNode ??
          (normalizer.semantics === 'specification-v2'
            ? callableInferenceLocation(signatureDeclaration ?? declaration)
            : declaration))
    return {
      ...(typeParameters.length ? { typeParameters } : {}),
      parameters,
      returns: normalizer.normalize(promised ?? rawReturn, normalizedReturnNode),
      mode: promised ? 'async' : 'sync',
      location: locationOf(catalogRoot, signatureDeclaration ?? declaration),
      issues: [],
    }
  } finally {
    restoreTypeParameters()
  }
}

function typeParameterScope(catalogRoot: string, node: ts.Node): string {
  const location = locationOf(catalogRoot, node)
  return `${location.file ?? location.external}:${location.line}:${location.column}`
}

function recursiveIntrinsicType(
  checker: ts.TypeChecker,
  type: ts.Type,
  semantics: DeclarationSurfaceSemantics,
): ObservedType | undefined {
  if (type.flags & ts.TypeFlags.String) return { kind: 'primitive', name: 'string' }
  if (type.flags & ts.TypeFlags.Boolean) return { kind: 'primitive', name: 'boolean' }
  if (type.flags & ts.TypeFlags.Number) return { kind: 'primitive', name: 'number' }
  if (type.flags & ts.TypeFlags.BigInt)
    return { kind: 'primitive', name: semantics === 'specification-v2' ? 'bigint' : 'number' }
  if (semantics === 'specification-v2' && type.flags & ts.TypeFlags.ESSymbol)
    return { kind: 'primitive', name: 'symbol' }
  if (semantics === 'specification-v2' && type.flags & ts.TypeFlags.NonPrimitive)
    return { kind: 'primitive', name: 'object' }
  if (type.flags & ts.TypeFlags.Undefined) return { kind: 'undefined' }
  if (type.flags & ts.TypeFlags.Null) return { kind: 'null' }
  if (type.flags & ts.TypeFlags.Void) return { kind: 'void' }
  if (type.flags & ts.TypeFlags.Never) return { kind: 'never' }
  if (type.isStringLiteral()) return { kind: 'literal', value: type.value }
  if (type.isNumberLiteral()) return { kind: 'literal', value: type.value }
  if (semantics === 'specification-v2' && type.flags & ts.TypeFlags.BigIntLiteral) {
    return bigintLiteral(type)
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: 'literal', value: type === checker.getTrueType() }
  }
  return undefined
}

function bigintLiteral(type: ts.Type, location?: ts.Node): ObservedType {
  const value = (type as ts.LiteralType).value as unknown
  if (typeof value === 'object' && value && 'base10Value' in value) {
    const literal = value as { readonly base10Value: string; readonly negative?: boolean }
    return {
      kind: 'bigint-literal',
      value: `${literal.negative ? '-' : ''}${literal.base10Value}`,
    }
  }
  const rendered = location?.getText().replace(/n$/u, '') ?? String(value).replace(/n$/u, '')
  return { kind: 'bigint-literal', value: rendered }
}

function literalType(node: ts.LiteralTypeNode, type: ts.Type): ObservedType {
  if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' }
  if (ts.isStringLiteral(node.literal)) return { kind: 'literal', value: node.literal.text }
  if (ts.isNumericLiteral(node.literal)) return { kind: 'literal', value: Number(node.literal.text) }
  if (ts.isBigIntLiteral(node.literal)) {
    return { kind: 'bigint-literal', value: node.literal.text.replace(/n$/u, '') }
  }
  if (ts.isPrefixUnaryExpression(node.literal)) {
    const sign = node.literal.operator === ts.SyntaxKind.MinusToken ? '-' : ''
    if (ts.isBigIntLiteral(node.literal.operand)) {
      return {
        kind: 'bigint-literal',
        value: `${sign}${node.literal.operand.text.replace(/n$/u, '')}`,
      }
    }
    if (ts.isNumericLiteral(node.literal.operand)) {
      return { kind: 'literal', value: Number(`${sign}${node.literal.operand.text}`) }
    }
  }
  if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
  if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  if (type.flags & ts.TypeFlags.Null) return { kind: 'null' }
  return { kind: 'unsupported', reason: 'literal', display: node.getText() }
}

function containingTypeSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isClassDeclaration(parent) && !ts.isInterfaceDeclaration(parent)) continue
    const symbol = parent.name ? checker.getSymbolAtLocation(parent.name) : undefined
    return symbol ? resolveAlias(checker, symbol) : undefined
  }
  return
}

function membersOfType(
  catalogRoot: string,
  checker: ts.TypeChecker,
  type: ts.Type,
  ownerDeclaration: ts.Declaration | undefined,
  normalizer: TypeNormalizer,
  issues: ObservationIssue[],
): ObservedMember[] {
  const members: ObservedMember[] = []
  for (const symbol of checker.getPropertiesOfType(type)) {
    const declaration = firstPublicMemberDeclaration(symbol, ownerDeclaration)
    if (!declaration) continue
    const memberIdentity = publicMemberIdentity(catalogRoot, checker, symbol, declaration, issues)
    if (!memberIdentity) continue
    const memberType = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional)
    const signatures = isMethodDeclaration(declaration)
      ? callablesOfType(
          catalogRoot,
          checker,
          optional ? checker.getNonNullableType(memberType) : memberType,
          declaration,
          normalizer,
          issues,
        )
      : undefined
    const callable = signatures?.[0]
    const normalized = callable ? undefined : normalizer.normalize(memberType, declaration)
    members.push({
      ...memberIdentity,
      optional,
      readonly: hasReadonlyModifier(declaration),
      ...(callable
        ? {
            callable,
            ...(signatures && signatures.length > 1 ? { overloads: signatures } : {}),
          }
        : { type: optional ? withoutUndefined(normalized!) : normalized! }),
      location: locationOf(catalogRoot, declaration),
    })
  }
  return members.sort((left, right) => compare(left.name, right.name))
}

function withoutUndefined(type: ObservedType): ObservedType {
  if (type.kind !== 'union') return type
  const types = type.types.filter((item) => item.kind !== 'undefined')
  if (types.length === 1) return types[0]!
  return { kind: 'union', types }
}

function staticMembersOfClass(
  catalogRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.Declaration | undefined,
  normalizer: TypeNormalizer,
  issues: ObservationIssue[],
): ObservedMember[] | undefined {
  if (!declaration) return undefined
  const computedStatics = new Set<ts.Declaration>()
  if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
    for (const member of declaration.members) {
      const name = member.name
      if (
        !hasStaticModifier(member) ||
        !name ||
        !ts.isComputedPropertyName(name) ||
        hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
        hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
      ) {
        continue
      }
      computedStatics.add(member)
      issues.push({
        code: 'TYPESCRIPT_COMPUTED_MEMBER_UNSUPPORTED',
        message: `Computed public member cannot be represented by the authored declaration contract: ${name.getText()}`,
        location: locationOf(catalogRoot, member),
      })
    }
  }
  const constructorType = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const members = checker.getPropertiesOfType(constructorType).flatMap((member) => {
    const memberDeclaration = (member.declarations ?? []).find(
      (candidate) => candidate.parent === declaration && hasStaticModifier(candidate),
    )
    if (!memberDeclaration || member.getName() === 'prototype') return []
    const memberName = (memberDeclaration as ts.NamedDeclaration).name
    if (
      (memberName && ts.isPrivateIdentifier(memberName)) ||
      hasModifier(memberDeclaration, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(memberDeclaration, ts.SyntaxKind.ProtectedKeyword)
    ) {
      return []
    }
    if (memberName && ts.isComputedPropertyName(memberName)) {
      if (!computedStatics.has(memberDeclaration)) {
        issues.push({
          code: 'TYPESCRIPT_COMPUTED_MEMBER_UNSUPPORTED',
          message: `Computed public member cannot be represented by the authored declaration contract: ${member.getName()}`,
          location: locationOf(catalogRoot, memberDeclaration),
        })
      }
      return []
    }
    const type = checker.getTypeOfSymbolAtLocation(member, memberDeclaration)
    const optional = Boolean(member.flags & ts.SymbolFlags.Optional)
    const signatures = callablesOfType(
      catalogRoot,
      checker,
      optional ? checker.getNonNullableType(type) : type,
      memberDeclaration,
      normalizer,
      issues,
    )
    const callable = signatures?.[0]
    return [
      {
        name: member.getName(),
        key: 'named' as const,
        optional,
        readonly: hasReadonlyModifier(memberDeclaration),
        ...(callable
          ? {
              callable,
              ...(signatures && signatures.length > 1 ? { overloads: signatures } : {}),
            }
          : { type: normalizer.normalize(type, memberDeclaration) }),
        location: locationOf(catalogRoot, memberDeclaration),
      } satisfies ObservedMember,
    ]
  })
  return members.sort((left, right) => compare(left.name, right.name))
}

function publicMemberIdentity(
  catalogRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  issues: ObservationIssue[],
): Pick<ObservedMember, 'name' | 'key'> | undefined {
  const declarationName = (declaration as ts.NamedDeclaration).name
  if (!declarationName || !ts.isComputedPropertyName(declarationName)) {
    return { name: symbol.getName(), key: 'named' }
  }
  const expression = declarationName.expression
  const expressionType = checker.getTypeAtLocation(expression)
  if (expressionType.flags & ts.TypeFlags.UniqueESSymbol) {
    return { name: expression.getText(), key: 'unique-symbol' }
  }
  issues.push({
    code: 'TYPESCRIPT_COMPUTED_MEMBER_UNSUPPORTED',
    message: `Only unique-symbol computed public members are supported: ${declarationName.getText()}`,
    location: locationOf(catalogRoot, declaration),
  })
  return undefined
}

function heritageOf(
  catalogRoot: string,
  checker: ts.TypeChecker,
  declaration: ts.Declaration | undefined,
  references: Map<string, ts.Symbol>,
  issues: ObservationIssue[],
): { extends?: string[]; implements?: string[] } {
  if (
    !declaration ||
    (!ts.isClassDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration))
  ) {
    return {}
  }
  const extended: string[] = []
  const implemented: string[] = []
  for (const clause of declaration.heritageClauses ?? []) {
    for (const typeNode of clause.types) {
      const type = checker.getTypeAtLocation(typeNode)
      const syntaxSymbol = checker.getSymbolAtLocation(typeNode.expression)
      const symbol =
        referencedSymbol(type) ?? (syntaxSymbol ? resolveAlias(checker, syntaxSymbol) : undefined)
      if (!symbol || !isStableDeclarationSymbol(symbol)) {
        issues.push({
          code: 'TYPESCRIPT_HERITAGE_UNRESOLVED',
          message: `Cannot resolve heritage target: ${typeNode.getText()}`,
          location: locationOf(catalogRoot, typeNode),
        })
        continue
      }
      const identity = canonicalSymbolIdentity(catalogRoot, symbol)
      references.set(identity, symbol)
      if (clause.token === ts.SyntaxKind.ImplementsKeyword) implemented.push(identity)
      else extended.push(identity)
    }
  }
  return { extends: extended.sort(compare), implements: implemented.sort(compare) }
}

function recordTypeNodes(
  location: ts.Node,
): { readonly key: ts.TypeNode; readonly value: ts.TypeNode } | undefined {
  const node = typeNodeAt(location)
  if (!node || !ts.isTypeReferenceNode(node)) return
  const name = node.typeName.getText()
  if (name === 'Record' && node.typeArguments?.length === 2) {
    return { key: node.typeArguments[0]!, value: node.typeArguments[1]! }
  }
  if (name !== 'Readonly' || node.typeArguments?.length !== 1) return
  const inner = node.typeArguments[0]!
  if (!ts.isTypeReferenceNode(inner) || inner.typeName.getText() !== 'Record') return
  if (inner.typeArguments?.length !== 2) return
  return { key: inner.typeArguments[0]!, value: inner.typeArguments[1]! }
}

const BUILT_IN_REFERENCE_TYPES = new Set([
  'Map',
  'ReadonlyMap',
  'Set',
  'ReadonlySet',
  'WeakMap',
  'WeakSet',
  'Iterable',
  'IterableIterator',
  'Iterator',
  'AsyncIterable',
  'AsyncIterableIterator',
  'PromiseLike',
  'Pick',
  'Omit',
  'Partial',
  'Required',
  'Exclude',
  'Extract',
  'NonNullable',
  'Parameters',
  'ReturnType',
  'InstanceType',
  'Awaited',
  'Uint8Array',
  'ArrayBuffer',
  'AbortSignal',
  'URL',
])

function builtInReferenceType(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): string | undefined {
  const node = typeNodeAt(location)
  const syntaxReference = node && ts.isTypeReferenceNode(node) ? node.typeName : undefined
  const syntaxSymbol = syntaxReference ? checker.getSymbolAtLocation(syntaxReference) : undefined
  const target = syntaxSymbol ? resolveAlias(checker, syntaxSymbol) : referencedSymbol(type)
  if (!target) return
  const name = target.getName()
  if (!BUILT_IN_REFERENCE_TYPES.has(name)) return
  if (
    target.declarations?.some(
      (declaration) =>
        declaration.getSourceFile().hasNoDefaultLib ||
        locationOf('/', declaration).external?.startsWith('platform:typescript/'),
    )
  ) {
    return name
  }
  // Built-ins can be shadowed, while platform globals such as AbortSignal can also be augmented by
  // the host environment. Trust the platform identity only when the resolved symbol retains at
  // least one compiler-library declaration.
  return
}

function declaredValueType(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.Declaration | undefined,
): ts.Type | undefined {
  if (!declaration) return undefined
  return symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : checker.getTypeOfSymbolAtLocation(symbol, declaration)
}

function declarationTypeParameters(
  declaration: ts.Declaration | undefined,
): readonly ts.TypeParameterDeclaration[] {
  return declaration &&
    (ts.isClassDeclaration(declaration) ||
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isFunctionDeclaration(declaration))
    ? [...(declaration.typeParameters ?? [])]
    : []
}

function firstPublicMemberDeclaration(
  symbol: ts.Symbol,
  owner: ts.Declaration | undefined,
): ts.Declaration | undefined {
  return (symbol.declarations ?? []).find((declaration) => {
    if (owner && !belongsTo(declaration, owner)) return false
    const name = (declaration as ts.NamedDeclaration).name
    if (name && ts.isPrivateIdentifier(name)) return false
    return (
      !hasModifier(declaration, ts.SyntaxKind.PrivateKeyword) &&
      !hasModifier(declaration, ts.SyntaxKind.ProtectedKeyword)
    )
  })
}

function belongsTo(declaration: ts.Declaration, owner: ts.Declaration): boolean {
  let current: ts.Node | undefined = declaration.parent
  while (current) {
    if (current === owner) return true
    current = current.parent
  }
  return false
}

function reportDeclarationMerging(
  symbol: ts.Symbol,
  kind: ObservedDeclarationKind,
  catalogRoot: string,
  issues: ObservationIssue[],
): void {
  if (kind === 'factory') return
  const declarations = symbol.declarations ?? []
  const kinds = new Set(declarations.map((declaration) => declaration.kind))
  const overloadOnly =
    kind === 'callable' &&
    [...kinds].every(
      (value) =>
        value === ts.SyntaxKind.FunctionDeclaration || value === ts.SyntaxKind.MethodSignature,
    )
  const classNamespace =
    kind === 'class' &&
    declarations.filter(ts.isClassDeclaration).length === 1 &&
    declarations.every(
      (declaration) => ts.isClassDeclaration(declaration) || ts.isModuleDeclaration(declaration),
    )
  if (declarations.length > 1 && !overloadOnly && !classNamespace) {
    issues.push({
      code: 'TYPESCRIPT_DECLARATION_MERGING_UNSUPPORTED',
      message: `Merged declaration cannot be represented unambiguously: ${symbol.getName()}`,
      location: locationOf(catalogRoot, firstDeclaration(symbol)),
      actual: declarations.length,
    })
  }
}

function reportUnsupportedDeclaredShape(
  catalogRoot: string,
  checker: ts.TypeChecker,
  type: ts.Type,
  declaration: ts.Declaration | undefined,
  issues: ObservationIssue[],
): void {
  if (!declaration) return
  const ownIndexSignatures =
    ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)
      ? declaration.members.filter(ts.isIndexSignatureDeclaration).length
      : 0
  for (const [label, count] of [
    ['construct', checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length],
    // Inherited index semantics are already represented by the explicit heritage identity. Only
    // an index signature authored on this declaration would otherwise disappear from the model.
    ['index', ownIndexSignatures],
  ] as const) {
    if (count === 0) continue
    issues.push({
      code: `TYPESCRIPT_${label.toUpperCase()}_SIGNATURE_UNSUPPORTED`,
      message: `Public ${label} signatures cannot be proven by the authored declaration contract.`,
      location: locationOf(catalogRoot, declaration),
      actual: count,
    })
  }
}

function hasOwnCallSignature(declaration: ts.Declaration): boolean {
  return (
    ts.isInterfaceDeclaration(declaration) &&
    declaration.members.some(ts.isCallSignatureDeclaration)
  )
}

function promiseArgument(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined
  const reference = type as ts.TypeReference
  const symbol = referencedSymbol(type)
  if (symbol?.getName() !== 'Promise') return undefined
  return checker.getTypeArguments(reference)[0]
}

function explicitReferenceSymbol(
  checker: ts.TypeChecker,
  location: ts.Node,
): ts.Symbol | undefined {
  const node = unwrappedTypeNodeAt(location)
  if (!node) return undefined
  if (
    ts.isTypeQueryNode(node) &&
    ts.isQualifiedName(node.exprName) &&
    !isModuleMemberReference(checker, node.exprName)
  ) {
    // `typeof ExportedObject.member` names a member shape, not an independently importable
    // declaration. Let the ordinary callable/object normalizer prove that shape structurally.
    // A direct module or namespace member (`typeof z.string`) remains identity-bearing.
    return undefined
  }
  const reference = ts.isTypeReferenceNode(node)
    ? node.typeName
    : ts.isImportTypeNode(node)
      ? node.qualifier
      : ts.isTypeQueryNode(node) && !ts.isImportTypeNode(node.exprName)
        ? node.exprName
        : undefined
  if (!reference) return undefined
  const symbol = checker.getSymbolAtLocation(reference)
  if (!symbol) return undefined
  const resolved = resolveAlias(checker, symbol)
  if (['Array', 'ReadonlyArray', 'Promise'].includes(resolved.getName())) return undefined
  return isStableDeclarationSymbol(resolved) ? resolved : undefined
}

function isModuleMemberReference(checker: ts.TypeChecker, name: ts.QualifiedName): boolean {
  const owner = checker.getSymbolAtLocation(name.left)
  if (!owner) return false
  return Boolean(resolveAlias(checker, owner).flags & ts.SymbolFlags.Module)
}

function selectedValueMemberTypeQuery(checker: ts.TypeChecker, location: ts.Node): boolean {
  const node = unwrappedTypeNodeAt(location)
  return Boolean(
    node &&
    ts.isTypeQueryNode(node) &&
    ts.isQualifiedName(node.exprName) &&
    !isModuleMemberReference(checker, node.exprName),
  )
}

function unwrappedTypeNodeAt(node: ts.Node): ts.TypeNode | undefined {
  let current = typeNodeAt(node)
  while (
    current &&
    (ts.isParenthesizedTypeNode(current) ||
      (ts.isTypeOperatorNode(current) && current.operator === ts.SyntaxKind.ReadonlyKeyword) ||
      ts.isRestTypeNode(current) ||
      ts.isOptionalTypeNode(current) ||
      ts.isNamedTupleMember(current))
  ) {
    current = current.type
  }
  return current
}

/** Match a checker tuple argument to the authored element beneath optional, named, and rest syntax. */
function tupleElementLocation(
  checker: ts.TypeChecker,
  type: ts.Type,
  node: ts.TypeNode | undefined,
): ts.TypeNode | undefined {
  if (!node) return undefined
  const rest = ts.isRestTypeNode(node)
    ? node.type
    : ts.isNamedTupleMember(node) && node.dotDotDotToken
      ? node.type
      : undefined
  if (rest) {
    if (checker.isArrayType(type)) return rest
    const unwrapped = unwrappedTypeNodeAt(rest)
    if (unwrapped && ts.isArrayTypeNode(unwrapped)) return unwrapped.elementType
    if (
      unwrapped &&
      ts.isTypeReferenceNode(unwrapped) &&
      ['Array', 'ReadonlyArray'].includes(unwrapped.typeName.getText())
    ) {
      return unwrapped.typeArguments?.[0] ?? unwrapped
    }
    return rest
  }
  if (ts.isNamedTupleMember(node) || ts.isOptionalTypeNode(node)) return node.type
  return node
}

function typeNodeAt(node: ts.Node): ts.TypeNode | undefined {
  if (ts.isTypeNode(node)) return node
  if ('type' in node) {
    const type = (node as { readonly type?: unknown }).type
    if (type && typeof type === 'object' && 'kind' in type && ts.isTypeNode(type as ts.Node)) {
      return type as ts.TypeNode
    }
  }
  if (ts.isVariableDeclaration(node) && node.initializer) {
    return assertionTypeNode(node.initializer)
  }
  return undefined
}

/** Preserve authored generic arguments instead of materializing opaque dependency defaults. */
function assertionTypeNode(expression: ts.Expression): ts.TypeNode | undefined {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    ? current.type
    : undefined
}

function callableReturnTypeNode(declaration: ts.Node): ts.TypeNode | undefined {
  return ts.isFunctionLike(declaration) || ts.isCallSignatureDeclaration(declaration)
    ? declaration.type
    : undefined
}

/**
 * A concise arrow's terminal assertion is explicit public type evidence even
 * when the callable itself has no return annotation. Block bodies are not
 * reduced here: choosing among control-flow returns belongs to body analysis.
 */
function callableReturnAssertionTypeNode(declaration: ts.Node): ts.TypeNode | undefined {
  let expression: ts.Expression | undefined
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) {
    expression = declaration.body
  } else if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    let initializer = declaration.initializer
    while (ts.isParenthesizedExpression(initializer)) initializer = initializer.expression
    if (ts.isArrowFunction(initializer) && !ts.isBlock(initializer.body)) expression = initializer.body
  }
  return expression ? assertionTypeNode(expression) : undefined
}

/** Avoid treating a variable's whole callable annotation as its return type. */
function callableInferenceLocation(declaration: ts.Node): ts.Node {
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) return declaration.body
  if ('name' in declaration) {
    const name = (declaration as ts.NamedDeclaration).name
    if (name) return name
  }
  return declaration
}

/** Authored optional types are safe to retain unless generic substitution is active. */
function typeNodeContainsTypeParameter(checker: ts.TypeChecker, node: ts.TypeNode): boolean {
  let found = false
  const visit = (current: ts.Node): void => {
    if (found) return
    if (ts.isTypeReferenceNode(current)) {
      const symbol = checker.getSymbolAtLocation(current.typeName)
      if (symbol && resolveAlias(checker, symbol).flags & ts.SymbolFlags.TypeParameter) {
        found = true
        return
      }
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isMethodDeclaration(declaration: ts.Declaration): boolean {
  return (
    ts.isMethodDeclaration(declaration) ||
    ts.isMethodSignature(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isSetAccessorDeclaration(declaration)
  )
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind),
  )
}

function hasReadonlyModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)
}

function typeParameterModifiers(
  parameter: ts.TypeParameterDeclaration,
): Pick<ObservedTypeParameter, 'variance' | 'const'> {
  const input = hasModifier(parameter, ts.SyntaxKind.InKeyword)
  const output = hasModifier(parameter, ts.SyntaxKind.OutKeyword)
  return {
    ...(input || output
      ? {
          variance:
            input && output ? ('in-out' as const) : input ? ('in' as const) : ('out' as const),
        }
      : {}),
    ...(hasModifier(parameter, ts.SyntaxKind.ConstKeyword) ? { const: true } : {}),
  }
}

function hasStaticModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.StaticKeyword)
}

function isReadonlyTuple(type: ts.TypeReference): boolean {
  return Boolean((type.target as ts.TupleType | undefined)?.readonly)
}

function canonicalTypes(types: readonly ObservedType[]): ObservedType[] {
  const unique = new Map(types.map((type) => [JSON.stringify(type), type]))
  return [...unique.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, type]) => type)
}

/**
 * TypeScript canonicalizes union and intersection constituents independently of
 * their source order. Pairing checker types with syntax nodes by array index can
 * therefore assign an explicit reference node to the wrong constituent (for
 * example `DomainSchema | undefined` is commonly ordered as
 * `undefined | DomainSchema` by the checker). Match the exact checker type
 * instead and fall back to the enclosing node when no source constituent
 * survives canonicalization unchanged.
 */
function constituentTypeNodes(
  checker: ts.TypeChecker,
  types: readonly ts.Type[],
  nodes: ts.NodeArray<ts.TypeNode>,
): readonly (ts.TypeNode | undefined)[] {
  const candidates = nodes.map((node) => ({ node, type: checker.getTypeFromTypeNode(node) }))
  const claimed = new Set<number>()
  return types.map((type) => {
    const index = candidates.findIndex(
      (candidate, candidateIndex) => !claimed.has(candidateIndex) && candidate.type === type,
    )
    if (index < 0) return undefined
    claimed.add(index)
    return candidates[index]!.node
  })
}

/** Preserve authored dependency identities when TypeScript flattens an alias into a type set. */
function hasExplicitExternalConstituent(
  catalogRoot: string,
  checker: ts.TypeChecker,
  nodes: ts.NodeArray<ts.TypeNode>,
): boolean {
  return nodes.some((node) => {
    const symbol = explicitReferenceSymbol(checker, node)
    return symbol !== undefined && externalTypeSymbol(catalogRoot, symbol)
  })
}

function externalTypeSymbol(catalogRoot: string, symbol: ts.Symbol): boolean {
  return (
    !symbolWithinCatalog(catalogRoot, symbol) ||
    Boolean(
      symbol.declarations?.some(
        (declaration) =>
          basename(dirname(declaration.getSourceFile().fileName)) === '.astrale-spec-externals',
      ),
    )
  )
}

/** Preserve an authored external intersection even when opaque stubs collapse its checker type. */
function authoredExternalIntersection(
  catalogRoot: string,
  checker: ts.TypeChecker,
  location: ts.Node,
): ts.NodeArray<ts.TypeNode> | undefined {
  const source = unwrappedTypeNodeAt(location)
  return source &&
    ts.isIntersectionTypeNode(source) &&
    hasExplicitExternalConstituent(catalogRoot, checker, source.types)
    ? source.types
    : undefined
}

interface AuthoredAlgebraicType {
  readonly kind: 'union' | 'intersection'
  readonly types: ts.NodeArray<ts.TypeNode>
}

function externalAuthoredIntersection(
  catalogRoot: string,
  checker: ts.TypeChecker,
  location: ts.Node,
): AuthoredAlgebraicType | undefined {
  const types = authoredExternalIntersection(catalogRoot, checker, location)
  return types ? { kind: 'intersection', types } : undefined
}

/** Preserve authored public algebra only when the syntax denotes this exact checker type. */
function authoredAlgebraicType(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): AuthoredAlgebraicType | undefined {
  const source = unwrappedTypeNodeAt(location)
  if (!source || checker.getTypeFromTypeNode(source) !== type) return
  if (ts.isUnionTypeNode(source)) return { kind: 'union', types: source.types }
  if (ts.isIntersectionTypeNode(source)) return { kind: 'intersection', types: source.types }
  return
}

/** Recover authored unions collapsed to TypeScript's shared `unknown` sentinel by opaque imports. */
function authoredOpaqueUnknownUnion(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
): ts.NodeArray<ts.TypeNode> | undefined {
  if (!(type.flags & ts.TypeFlags.Unknown)) return
  const source = unwrappedTypeNodeAt(location)
  if (!source || !ts.isUnionTypeNode(source)) return
  if (source.types.some((item) => item.kind === ts.SyntaxKind.UnknownKeyword)) return
  return source.types.some((item) => {
    const reference = explicitReferenceSymbol(checker, item)
    return (
      reference !== undefined &&
      Boolean(checker.getTypeFromTypeNode(item).flags & ts.TypeFlags.Unknown)
    )
  })
    ? source.types
    : undefined
}

function deduplicateIssues(issues: readonly ObservationIssue[]): ObservationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.message}\0${issue.location?.file ?? ''}\0${issue.location?.line ?? 0}\0${issue.location?.column ?? 0}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
