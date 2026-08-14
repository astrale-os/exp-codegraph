import type {
  DeclarationIdentity,
  ExpectedCallableType,
  ExpectedMember,
  ExpectedModule,
  ExpectedType,
  ExpectedTypeExpression,
} from '../../contract/model.ts'

import type {
  EvaluationDiagnostic as VerificationDiagnostic,
  EvaluationRule as VerificationRule,
  EvaluationStatus as VerificationStatus,
  ImplementationLocation,
  NormalizedModule as ObservedModule,
  ObservedCallable,
  ObservedDeclaration,
  ObservedMember,
  ObservedType,
} from '../model.ts'
import type { ComparisonContext } from '../context.ts'

import { expectedLocation } from '../../contract/model.ts'

import {
  canonicalExpected,
} from '../context.ts'

import {
  unevaluatedRule,
  sameStrings,
  matchesExternalType,
  matchesExternalIdentity,
  withoutUndefined,
  memberType,
  expectedReadonlyShape,
  expectedBooleanUnion,
  flattenExpectedTypeSet,
  expectedContainsBooleanLiterals,
  removeSubsumedObservedLiterals,
  collapseObservedUnion,
  substituteTypeParameters,
  sameObservedType,
  intrinsicTypeCompatible,
  dataTypeCompatible,
  typeSetAssignments,
  mergeRule,
} from '../semantics.ts'

export abstract class TypeEvaluator {
  readonly context: ComparisonContext
  readonly expected: ExpectedModule
  readonly observed: ObservedModule
  readonly rules: VerificationRule[] = []
  protected readonly rulesById = new Map<string, VerificationRule>()
  protected readonly evaluated = new Set<string>()
  protected readonly bindings = new Map<string, string>()
  protected readonly usedExpected = new Set<string>()
  protected readonly boundObserved = new Set<string>()
  protected readonly identityCovered = new Set<string>()
  protected readonly pairs = new Set<string>()
  protected readonly observedExports = new Map<string, ObservedModule['exports'][number]>()
  protected readonly activeTypeAliases = new Set<string>()
  protected readonly activeShapeAliases = new Set<string>()
  protected readonly blockedDependencies = new Set<string>()
  protected readonly typeParameterScopes = new Map<string, string>()
  protected readonly opaqueExternalExportPaths = new Set<string>()

  constructor(context: ComparisonContext, expected: ExpectedModule, observed: ObservedModule) {
    this.context = context
    this.expected = expected
    this.observed = observed
    for (const obligation of expected.obligations) {
      const rule = unevaluatedRule(obligation, expected)
      this.rules.push(rule)
      this.rulesById.set(rule.id, rule)
    }
    for (const item of observed.exports) this.observedExports.set(item.path.join('.'), item)
    for (const [expectedIdentity, observedIdentity] of context.seeds) {
      this.bindings.set(expectedIdentity, observedIdentity)
    }
  }

  protected abstract bindDeclaration(
    expectedIdentity: DeclarationIdentity,
    observed: ObservedDeclaration,
    ruleId: string,
    projection?: 'full' | 'type' | 'identity',
  ): void
  protected abstract compareCallableType(
    expected: ExpectedCallableType,
    observed: ObservedCallable,
    ruleId: string,
    pointer: string,
  ): boolean
  protected abstract coverIdentityClosure(identity: string): void
  protected abstract observedIdentitiesEquivalent(left: string, right: string): boolean
  protected abstract thisOwnerCompatible(expectedOwner: string, observedOwner: string): boolean
  protected abstract expectedDeclarationShape(
    reference: Extract<ExpectedTypeExpression, { readonly kind: 'declaration' }>,
  ): ExpectedTypeExpression | undefined
  protected abstract bindExpandedDeclarationReference(
    reference: Extract<ExpectedTypeExpression, { readonly kind: 'declaration' }>,
    observed: ObservedType,
    ruleId: string,
    location: ImplementationLocation,
    pointer: string,
  ): boolean
  protected abstract transparentObservedType(observed: ObservedType): ObservedType | undefined
  protected abstract resolveObservedIndexedAccess(
    indexed: Extract<ObservedType, { kind: 'indexed-access' }>,
  ): ObservedType | undefined
  protected abstract isLocalAliasReference(observed: ObservedType): boolean

  get identityCoveredDeclarations(): ReadonlySet<string> {
    return this.identityCovered
  }

  protected compareType(
    expected: ExpectedType,
    observed: ObservedType,
    ruleId: string,
    location: ImplementationLocation,
  ): boolean {
    return this.compareTypeExpression(
      expected.expression,
      observed,
      ruleId,
      location,
      expected.pointer,
    )
  }

  protected compareTypeExpression(
    expected: ExpectedTypeExpression,
    observed: ObservedType,
    ruleId: string,
    location: ImplementationLocation,
    pointer: string,
  ): boolean {
    if (observed.kind === 'unsupported') {
      this.error(
        ruleId,
        'MODULE_TYPE_EVIDENCE_UNSUPPORTED',
        `Type evidence is unsupported: ${observed.reason}`,
        pointer,
        location,
        expected,
        observed,
      )
      return false
    }
    if (
      expected.kind !== 'declaration' &&
      (expected.kind !== 'external' || this.isLocalAliasReference(observed))
    ) {
      const expanded = this.transparentObservedType(observed)
      if (
        expanded &&
        observed.kind === 'reference' &&
        !this.activeTypeAliases.has(observed.identity)
      ) {
        this.activeTypeAliases.add(observed.identity)
        this.coverIdentityClosure(observed.identity)
        try {
          return this.compareTypeExpression(expected, expanded, ruleId, location, pointer)
        } finally {
          this.activeTypeAliases.delete(observed.identity)
        }
      }
    }
    if (expected.kind !== 'union' && observed.kind === 'union') {
      const normalized = this.normalizeObservedTypeSet('union', [expected], observed.types)
      const collapsed = collapseObservedUnion(expected, normalized)
      if (collapsed) {
        return this.compareTypeExpression(expected, collapsed, ruleId, location, pointer)
      }
    }
    if (expected.kind !== 'indexed-access' && observed.kind === 'indexed-access') {
      const resolved = this.resolveObservedIndexedAccess(observed)
      if (resolved) {
        return this.compareTypeExpression(expected, resolved, ruleId, location, pointer)
      }
    }
    if (expected.kind === 'data') {
      if (dataTypeCompatible(expected.data, observed)) return true
      return this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'unknown') {
      return observed.kind === 'unknown'
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'parameter') {
      return observed.kind === 'parameter' &&
        observed.index === expected.index &&
        this.typeParameterScopeCompatible(expected.scope, observed.scope)
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (
      expected.kind === 'null' ||
      expected.kind === 'undefined' ||
      expected.kind === 'void' ||
      expected.kind === 'never'
    ) {
      return intrinsicTypeCompatible(expected.kind, observed.kind)
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'literal') {
      return observed.kind === 'literal' && observed.value === expected.value
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'bigint-literal') {
      return observed.kind === 'bigint-literal' && observed.value === expected.value
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (
      expectedBooleanUnion(expected) &&
      observed.kind === 'primitive' &&
      observed.name === 'boolean'
    ) {
      return true
    }
    if (expected.kind === 'this') {
      return observed.kind === 'this' && this.thisOwnerCompatible(expected.owner, observed.owner)
        ? true
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'template') {
      if (
        observed.kind !== 'template' ||
        !sameStrings(expected.texts, observed.texts) ||
        expected.types.length !== observed.types.length
      ) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return expected.types.every((item, index) =>
        this.compareTypeExpression(item, observed.types[index]!, ruleId, location, pointer),
      )
    }
    if (expected.kind === 'array') {
      if (
        observed.kind !== 'array' ||
        (expected.readonly !== undefined && observed.readonly !== expected.readonly)
      ) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return this.compareTypeExpression(
        expected.element,
        observed.element,
        ruleId,
        location,
        pointer,
      )
    }
    if (expected.kind === 'record') {
      if (observed.kind !== 'record') {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return (
        this.compareTypeExpression(expected.key, observed.key, ruleId, location, pointer) &&
        this.compareTypeExpression(expected.value, observed.value, ruleId, location, pointer)
      )
    }
    if (expected.kind === 'tuple') {
      if (
        observed.kind !== 'tuple' ||
        (expected.readonly !== undefined && observed.readonly !== expected.readonly) ||
        observed.elements.length !== expected.elements.length
      ) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return expected.elements.every((item, index) =>
        this.compareTypeExpression(item, observed.elements[index]!, ruleId, location, pointer),
      )
    }
    if (expected.kind === 'union' || expected.kind === 'intersection') {
      if (observed.kind !== expected.kind) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return this.compareTypeSet(
        expected.kind,
        expected.types,
        observed.types,
        ruleId,
        location,
        pointer,
      )
    }
    if (expected.kind === 'conditional') {
      if (observed.kind !== 'conditional') {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return (
        this.compareTypeExpression(expected.check, observed.check, ruleId, location, pointer) &&
        this.compareTypeExpression(expected.extends, observed.extends, ruleId, location, pointer) &&
        this.compareTypeExpression(
          expected.trueType,
          observed.trueType,
          ruleId,
          location,
          pointer,
        ) &&
        this.compareTypeExpression(
          expected.falseType,
          observed.falseType,
          ruleId,
          location,
          pointer,
        )
      )
    }
    if (expected.kind === 'keyof') {
      return observed.kind === 'keyof'
        ? this.compareTypeExpression(expected.type, observed.type, ruleId, location, pointer)
        : this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    if (expected.kind === 'indexed-access') {
      if (observed.kind !== 'indexed-access') {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      return (
        this.compareTypeExpression(expected.object, observed.object, ruleId, location, pointer) &&
        this.compareTypeExpression(expected.index, observed.index, ruleId, location, pointer)
      )
    }
    if (expected.kind === 'object') {
      if (observed.kind !== 'object') {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      const matches = this.matchObjectTypeMembers(expected.members, observed.members)
      if (!matches) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      for (const [member, actual] of matches) {
        const observedType = memberType(actual)
        if (!observedType || !this.objectMemberSkeletonCompatible(member, actual)) {
          return this.typeMismatch(ruleId, pointer, location, expected, observed)
        }
        const actualType = actual.optional ? withoutUndefined(observedType) : observedType
        if (
          !this.compareTypeExpression(
            member.expression,
            actualType,
            ruleId,
            location,
            member.pointer,
          )
        ) {
          return false
        }
      }
      return true
    }
    if (expected.kind === 'function' || expected.kind === 'constructor') {
      if (observed.kind !== expected.kind) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      const expectedSignatures = expected.overloads?.length
        ? expected.overloads
        : [expected.callable]
      const observedSignatures = observed.overloads?.length
        ? observed.overloads
        : [observed.callable]
      if (expectedSignatures.length !== observedSignatures.length) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      let matches = true
      for (const [index, signature] of expectedSignatures.entries()) {
        if (
          !this.compareCallableType(
            signature,
            observedSignatures[index]!,
            ruleId,
            signature.pointer ?? pointer,
          )
        ) {
          matches = false
        }
      }
      return matches
    }
    if (expected.kind === 'external') {
      if (expectedReadonlyShape(expected) && observed.kind !== 'reference') {
        return this.compareTypeExpression(
          expected.arguments[0]!,
          observed,
          ruleId,
          location,
          pointer,
        )
      }
      if (observed.kind !== 'reference') {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      const declaration = this.context.observedDeclarations.get(observed.identity)
      if (!declaration) {
        if (matchesExternalIdentity(expected, observed)) {
          return this.compareTypeArguments(
            expected.arguments,
            observed.arguments,
            ruleId,
            location,
            pointer,
          )
        }
        this.error(
          ruleId,
          'MODULE_PUBLIC_TYPE_UNRESOLVED',
          `Publicly reachable type could not be observed: ${observed.name}`,
          pointer,
          location,
          expected,
          observed.identity,
        )
        return false
      }
      if (!matchesExternalType(expected, declaration)) {
        return this.typeMismatch(ruleId, pointer, location, expected, observed)
      }
      if (
        !this.compareTypeArguments(
          expected.arguments,
          this.effectiveTypeArguments(observed, declaration, expected.arguments.length),
          ruleId,
          location,
          pointer,
        )
      ) {
        return false
      }
      this.coverIdentityClosure(declaration.identity)
      return true
    }
    if (observed.kind !== 'reference') {
      if (this.bindExpandedDeclarationReference(expected, observed, ruleId, location, pointer)) {
        return true
      }
      this.fail(
        ruleId,
        'MODULE_TYPE_IDENTITY_MISMATCH',
        'A named declaration reference was expected.',
        pointer,
        location,
        expected.declaration.key,
        observed,
      )
      return false
    }
    const actualDeclaration = this.context.observedDeclarations.get(observed.identity)
    if (!actualDeclaration) {
      this.error(
        ruleId,
        'MODULE_PUBLIC_TYPE_UNRESOLVED',
        `Publicly reachable type could not be observed: ${observed.name}`,
        pointer,
        location,
        expected.declaration.key,
        observed.identity,
      )
      return false
    }
    const wasEvaluated = this.evaluated.has(ruleId)
    const expectedDeclaration = this.context.expected.declarations.get(expected.declaration.key)
    const projection =
      actualDeclaration.kind === 'factory' &&
      expectedDeclaration?.identity.kind === 'value' &&
      !expectedDeclaration.facets
        ? 'type'
        : 'full'
    this.bindDeclaration(expected.declaration, actualDeclaration, ruleId, projection)
    if (
      !this.compareTypeArguments(
        expected.arguments,
        this.effectiveTypeArguments(observed, actualDeclaration, expected.arguments.length),
        ruleId,
        location,
        pointer,
      )
    ) {
      return false
    }
    if (!wasEvaluated && !this.evaluated.has(ruleId)) return true
    const status = this.rulesById.get(ruleId)?.status
    return status !== 'fail' && status !== 'error'
  }

  protected compareTypeArguments(
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
    ruleId: string,
    location: ImplementationLocation,
    pointer: string,
  ): boolean {
    if (expected.length !== observed.length) {
      return this.typeMismatch(ruleId, pointer, location, expected, observed)
    }
    return expected.every((argument, index) =>
      this.compareTypeExpression(argument, observed[index]!, ruleId, location, pointer),
    )
  }

  protected effectiveTypeArguments(
    reference: Extract<ObservedType, { kind: 'reference' }>,
    declaration: ObservedDeclaration,
    requestedLength: number,
  ): readonly ObservedType[] {
    const parameters = declaration.typeParameters ?? []
    const scope = parameters[0]?.scope
    const arguments_ = [...reference.arguments]
    while (arguments_.length) {
      const index = arguments_.length - 1
      const fallback = parameters[index]?.default
      if (
        !fallback ||
        !sameObservedType(
          arguments_[index]!,
          scope ? substituteTypeParameters(fallback, scope, arguments_) : fallback,
        )
      ) {
        break
      }
      arguments_.pop()
    }
    if (arguments_.length >= requestedLength) return arguments_
    for (let index = arguments_.length; index < requestedLength; index++) {
      const fallback = parameters[index]?.default
      if (!fallback) return arguments_
      arguments_.push(scope ? substituteTypeParameters(fallback, scope, arguments_) : fallback)
    }
    return arguments_
  }

  protected bindTypeParameterScopes(
    expected: readonly { readonly scope: string }[],
    observed: readonly { readonly scope: string }[],
  ): void {
    const maximum = Math.min(expected.length, observed.length)
    for (let index = 0; index < maximum; index++) {
      const expectedScope = expected[index]!.scope
      const observedScope = observed[index]!.scope
      if (!this.typeParameterScopes.has(expectedScope)) {
        this.typeParameterScopes.set(expectedScope, observedScope)
      }
    }
  }

  protected typeParameterScopeCompatible(expected: string, observed: string): boolean {
    return (this.typeParameterScopes.get(expected) ?? expected) === observed
  }

  protected matchObjectTypeMembers(
    expected: readonly ExpectedMember[],
    observed: readonly ObservedMember[],
  ): readonly (readonly [ExpectedMember, ObservedMember])[] | undefined {
    if (expected.length !== observed.length) return undefined
    const used = new Set<number>()
    const matches: Array<readonly [ExpectedMember, ObservedMember]> = []
    const visit = (index: number): boolean => {
      if (index === expected.length) return true
      const member = expected[index]!
      for (let candidate = 0; candidate < observed.length; candidate++) {
        const actual = observed[candidate]!
        const actualType = memberType(actual)
        if (
          used.has(candidate) ||
          !actualType ||
          !this.objectMemberSkeletonCompatible(member, actual) ||
          !this.typeShapeCompatible(
            member.expression,
            actual.optional ? withoutUndefined(actualType) : actualType,
          )
        ) {
          continue
        }
        used.add(candidate)
        matches.push([member, actual])
        if (visit(index + 1)) return true
        matches.pop()
        used.delete(candidate)
      }
      return false
    }
    return visit(0) ? matches : undefined
  }

  protected objectMemberSkeletonCompatible(
    expected: ExpectedMember,
    observed: ObservedMember,
  ): boolean {
    return (
      expected.key === observed.key &&
      (expected.key === 'unique-symbol' || expected.name === observed.name) &&
      expected.optional === observed.optional &&
      (expected.readonly === undefined || expected.readonly === observed.readonly)
    )
  }

  protected compareTypeSet(
    kind: 'union' | 'intersection',
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
    ruleId: string,
    location: ImplementationLocation,
    pointer: string,
  ): boolean {
    const normalizedExpected = this.normalizeExpectedTypeSet(kind, expected)
    const normalizedObserved = this.normalizeObservedTypeSet(
      kind,
      normalizedExpected,
      observed,
    )
    this.coverTypeSetReferenceEvidence(normalizedExpected, normalizedObserved)
    if (normalizedExpected.length !== normalizedObserved.length) {
      return this.typeMismatch(
        ruleId,
        pointer,
        location,
        normalizedExpected,
        normalizedObserved,
      )
    }
    const candidates = normalizedExpected.map((item) => {
      const compatible = normalizedObserved.map((_, index) => index).filter((index) =>
        this.typeShapeCompatible(item, normalizedObserved[index]!),
      )
      // Preserve an authored named reference when ttsc also exposes its
      // structurally expanded shape elsewhere in the same union/intersection.
      // Both are compatible evidence, but the reference is the only candidate
      // with identity authority. Falling back to structural candidates remains
      // necessary when the checker has erased the alias entirely.
      const identityCandidates = compatible.filter(
        (index) =>
          (item.kind === 'declaration' || item.kind === 'external') &&
          normalizedObserved[index]!.kind === 'reference',
      )
      return identityCandidates.length ? identityCandidates : compatible
    })
    const assignments = typeSetAssignments(candidates, 2)
    if (!assignments.length) {
      const unmatched = candidates.findIndex((entries) => !entries.length)
      return this.typeMismatch(
        ruleId,
        pointer,
        location,
        unmatched >= 0 ? normalizedExpected[unmatched] : normalizedExpected,
        normalizedObserved,
      )
    }
    if (assignments.length > 1) {
      this.error(
        ruleId,
        'MODULE_TYPE_SET_AMBIGUOUS',
        'Type set contains multiple indistinguishable complete matchings.',
        pointer,
        location,
        normalizedExpected,
        normalizedObserved,
      )
      return false
    }
    return normalizedExpected.every((item, index) =>
      this.compareTypeExpression(
        item,
        normalizedObserved[assignments[0]![index]!]!,
        ruleId,
        location,
        pointer,
      ),
    )
  }

  /**
   * Normalize one union/intersection only as far as the expected contract
   * requires. Identity-bearing references are retained when a named expected
   * constituent can match them; otherwise transparent aliases are expanded and
   * nested sets are flattened. This preserves nominal evidence while allowing
   * checker-reduced and authored-alias representations to prove the same type.
   */
  protected normalizeObservedTypeSet(
    kind: 'union' | 'intersection',
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
  ): readonly ObservedType[] {
    const output: ObservedType[] = []
    const active = new Set<string>()
    const visit = (type: ObservedType): void => {
      if (type.kind === kind) {
        for (const item of type.types) visit(item)
        return
      }
      if (kind === 'union' && type.kind === 'template') {
        for (const variant of this.observedTemplateVariants(type)) output.push(variant)
        return
      }
      if (
        type.kind === 'reference' &&
        !active.has(type.identity) &&
        !expected.some(
          (item) =>
            (item.kind === 'declaration' || item.kind === 'external') &&
            this.typeShapeCompatible(item, type),
        )
      ) {
        const expanded = this.transparentObservedType(type)
        if (expanded) {
          active.add(type.identity)
          this.coverIdentityClosure(type.identity)
          visit(expanded)
          active.delete(type.identity)
          return
        }
      }
      output.push(type)
    }
    for (const type of observed) visit(type)

    const expandedBooleans = expectedContainsBooleanLiterals(expected)
      ? output.flatMap((type): readonly ObservedType[] =>
          type.kind === 'primitive' && type.name === 'boolean'
            ? [
                { kind: 'literal', value: false },
                { kind: 'literal', value: true },
              ]
            : [type],
        )
      : output
    return removeSubsumedObservedLiterals(expandedBooleans)
  }

  /**
   * A failing structural constituent must not erase independent exact identity
   * evidence from another constituent in the same set.
   */
  protected coverTypeSetReferenceEvidence(
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
  ): void {
    for (const item of expected) {
      if (item.kind !== 'declaration') continue
      const canonical = canonicalExpected(item.declaration.key, this.context.expected)
      const bound = this.bindings.get(canonical)
      if (!bound) continue
      const actual = observed.find(
        (candidate) =>
          candidate.kind === 'reference' &&
          this.observedIdentitiesEquivalent(bound, candidate.identity) &&
          this.typeArgumentsShapeCompatible(
            item.arguments,
            this.effectiveTypeArgumentsForIdentity(candidate, item.arguments.length),
          ),
      )
      if (!actual || actual.kind !== 'reference') continue
      this.usedExpected.add(canonical)
      this.boundObserved.add(actual.identity)
      this.coverIdentityClosure(actual.identity)
    }
  }

  protected markExpectedTypeDependencies(type: ExpectedTypeExpression): void {
    const visit = (current: ExpectedTypeExpression): void => {
      switch (current.kind) {
        case 'declaration':
          this.usedExpected.add(canonicalExpected(current.declaration.key, this.context.expected))
          for (const argument of current.arguments) visit(argument)
          return
        case 'external':
          for (const argument of current.arguments) visit(argument)
          return
        case 'template':
          for (const item of current.types) visit(item)
          return
        case 'array':
          visit(current.element)
          return
        case 'record':
          visit(current.key)
          visit(current.value)
          return
        case 'tuple':
        case 'union':
        case 'intersection':
          for (const item of current.kind === 'tuple' ? current.elements : current.types) visit(item)
          return
        case 'conditional':
          visit(current.check)
          visit(current.extends)
          visit(current.trueType)
          visit(current.falseType)
          return
        case 'keyof':
          visit(current.type)
          return
        case 'indexed-access':
          visit(current.object)
          visit(current.index)
          return
        case 'object':
          for (const member of current.members) visit(member.expression)
          return
        case 'function':
        case 'constructor':
          for (const parameter of current.callable.parameters) visit(parameter.expression)
          visit(current.callable.returns.expression)
          return
        default:
          return
      }
    }
    visit(type)
  }

  /** Expand authored template unions symmetrically with checker-expanded output. */
  protected normalizeExpectedTypeSet(
    kind: 'union' | 'intersection',
    values: readonly ExpectedTypeExpression[],
  ): readonly ExpectedTypeExpression[] {
    const flattened = flattenExpectedTypeSet(kind, values)
    if (kind !== 'union') return flattened
    return flattened.flatMap((value): readonly ExpectedTypeExpression[] =>
      value.kind === 'template' ? this.expectedTemplateVariants(value) : [value],
    )
  }

  protected expectedTemplateVariants(
    template: Extract<ExpectedTypeExpression, { readonly kind: 'template' }>,
  ): readonly Extract<ExpectedTypeExpression, { readonly kind: 'template' }>[] {
    const maximumVariants = 64
    const active = new Set<string>()
    const expandTemplate = (
      current: Extract<ExpectedTypeExpression, { readonly kind: 'template' }>,
    ): readonly Extract<ExpectedTypeExpression, { readonly kind: 'template' }>[] => {
      let variants: Array<{ texts: string[]; types: ExpectedTypeExpression[] }> = [
        { texts: [current.texts[0] ?? ''], types: [] },
      ]
      for (const [index, hole] of current.types.entries()) {
        const alternatives = expandHole(hole)
        const next: typeof variants = []
        for (const variant of variants) {
          for (const alternative of alternatives) {
            if (next.length >= maximumVariants) return [current]
            const texts = [...variant.texts]
            const types = [...variant.types]
            if (alternative.kind === 'template') {
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${alternative.texts[0] ?? ''}`
              for (const [nestedIndex, nested] of alternative.types.entries()) {
                types.push(nested)
                texts.push(alternative.texts[nestedIndex + 1] ?? '')
              }
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${current.texts[index + 1] ?? ''}`
            } else if (alternative.kind === 'literal') {
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${String(alternative.value)}${current.texts[index + 1] ?? ''}`
            } else {
              types.push(alternative)
              texts.push(current.texts[index + 1] ?? '')
            }
            next.push({ texts, types })
          }
        }
        variants = next
      }
      return variants.map((variant) => ({ kind: 'template', ...variant }))
    }
    const expandHole = (type: ExpectedTypeExpression): readonly ExpectedTypeExpression[] => {
      if (type.kind === 'union') return type.types.flatMap(expandHole)
      if (type.kind !== 'declaration') return [type]
      const canonical = canonicalExpected(type.declaration.key, this.context.expected)
      if (active.has(canonical)) return [type]
      const expanded = this.expectedDeclarationShape(type)
      if (
        !expanded ||
        (expanded.kind !== 'declaration' &&
          expanded.kind !== 'union' &&
          expanded.kind !== 'template')
      ) {
        return [type]
      }
      active.add(canonical)
      const values =
        expanded.kind === 'union'
          ? expanded.types.flatMap(expandHole)
          : expanded.kind === 'template'
            ? expandTemplate(expanded)
            : expandHole(expanded)
      active.delete(canonical)
      return values
    }
    return expandTemplate(template)
  }

  /** Expand only template-valued aliases and distributive union holes. */
  protected observedTemplateVariants(
    template: Extract<ObservedType, { kind: 'template' }>,
  ): readonly Extract<ObservedType, { kind: 'template' }>[] {
    const maximumVariants = 64
    const active = new Set<string>()
    const expandTemplate = (
      current: Extract<ObservedType, { kind: 'template' }>,
    ): readonly Extract<ObservedType, { kind: 'template' }>[] => {
      let variants: Array<{ texts: string[]; types: ObservedType[] }> = [
        { texts: [current.texts[0] ?? ''], types: [] },
      ]
      for (const [index, hole] of current.types.entries()) {
        const alternatives = expandHole(hole)
        const next: typeof variants = []
        for (const variant of variants) {
          for (const alternative of alternatives) {
            if (next.length >= maximumVariants) return [current]
            const texts = [...variant.texts]
            const types = [...variant.types]
            if (alternative.kind === 'template') {
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${alternative.texts[0] ?? ''}`
              for (const [nestedIndex, nested] of alternative.types.entries()) {
                types.push(nested)
                texts.push(alternative.texts[nestedIndex + 1] ?? '')
              }
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${current.texts[index + 1] ?? ''}`
            } else if (alternative.kind === 'literal') {
              texts[texts.length - 1] =
                `${texts[texts.length - 1] ?? ''}${String(alternative.value)}${current.texts[index + 1] ?? ''}`
            } else {
              types.push(alternative)
              texts.push(current.texts[index + 1] ?? '')
            }
            next.push({ texts, types })
          }
        }
        variants = next
      }
      return variants.map((variant) => ({ kind: 'template', ...variant }))
    }
    const expandHole = (type: ObservedType): readonly ObservedType[] => {
      if (type.kind === 'union') return type.types.flatMap(expandHole)
      if (type.kind !== 'reference' || active.has(type.identity)) return [type]
      const expanded = this.transparentObservedType(type)
      if (
        !expanded ||
        (expanded.kind !== 'reference' &&
          expanded.kind !== 'union' &&
          expanded.kind !== 'template')
      )
        return [type]
      active.add(type.identity)
      this.coverIdentityClosure(type.identity)
      const values =
        expanded.kind === 'union'
          ? expanded.types.flatMap(expandHole)
          : expanded.kind === 'template'
            ? expandTemplate(expanded)
            : expandHole(expanded)
      active.delete(type.identity)
      return values
    }
    return expandTemplate(template)
  }

  protected typeShapeCompatible(expected: ExpectedTypeExpression, observed: ObservedType): boolean {
    if (
      expected.kind !== 'declaration' &&
      (expected.kind !== 'external' || this.isLocalAliasReference(observed))
    ) {
      const expanded = this.transparentObservedType(observed)
      if (
        expanded &&
        observed.kind === 'reference' &&
        !this.activeShapeAliases.has(observed.identity)
      ) {
        this.activeShapeAliases.add(observed.identity)
        try {
          return this.typeShapeCompatible(expected, expanded)
        } finally {
          this.activeShapeAliases.delete(observed.identity)
        }
      }
    }
    if (expected.kind !== 'indexed-access' && observed.kind === 'indexed-access') {
      const resolved = this.resolveObservedIndexedAccess(observed)
      if (resolved) return this.typeShapeCompatible(expected, resolved)
    }
    if (expected.kind === 'data') {
      return dataTypeCompatible(expected.data, observed)
    }
    if (expected.kind === 'declaration') {
      if (observed.kind !== 'reference') {
        const shape = this.expectedDeclarationShape(expected)
        return Boolean(shape && this.typeShapeCompatible(shape, observed))
      }
      const canonical = canonicalExpected(expected.declaration.key, this.context.expected)
      const seeded = this.bindings.get(canonical)
      return (
        (seeded
          ? this.observedIdentitiesEquivalent(seeded, observed.identity)
          : expected.declaration.name === observed.name) &&
        this.typeArgumentsShapeCompatible(
          expected.arguments,
          this.effectiveTypeArgumentsForIdentity(observed, expected.arguments.length),
        )
      )
    }
    if (expected.kind === 'external') {
      if (expectedReadonlyShape(expected) && observed.kind !== 'reference') {
        return this.typeShapeCompatible(expected.arguments[0]!, observed)
      }
      if (observed.kind !== 'reference') return false
      const declaration = this.context.observedDeclarations.get(observed.identity)
      return Boolean(
        (declaration
          ? matchesExternalType(expected, declaration)
          : matchesExternalIdentity(expected, observed)) &&
        this.typeArgumentsShapeCompatible(
          expected.arguments,
          declaration
            ? this.effectiveTypeArguments(observed, declaration, expected.arguments.length)
            : observed.arguments,
        ),
      )
    }
    if (expected.kind === 'literal') {
      return observed.kind === 'literal' && observed.value === expected.value
    }
    if (expected.kind === 'bigint-literal') {
      return observed.kind === 'bigint-literal' && observed.value === expected.value
    }
    if (
      expectedBooleanUnion(expected) &&
      observed.kind === 'primitive' &&
      observed.name === 'boolean'
    ) {
      return true
    }
    if (expected.kind === 'this') {
      return observed.kind === 'this' && this.thisOwnerCompatible(expected.owner, observed.owner)
    }
    if (expected.kind === 'template') {
      return (
        observed.kind === 'template' &&
        sameStrings(expected.texts, observed.texts) &&
        expected.types.length === observed.types.length &&
        expected.types.every((item, index) =>
          this.typeShapeCompatible(item, observed.types[index]!),
        )
      )
    }
    if (expected.kind === 'unknown') return observed.kind === 'unknown'
    if (expected.kind === 'parameter') {
      return (
        observed.kind === 'parameter' &&
        observed.index === expected.index &&
        this.typeParameterScopeCompatible(expected.scope, observed.scope)
      )
    }
    if (
      expected.kind === 'null' ||
      expected.kind === 'undefined' ||
      expected.kind === 'void' ||
      expected.kind === 'never'
    ) {
      return intrinsicTypeCompatible(expected.kind, observed.kind)
    }
    if (expected.kind === 'array') {
      return (
        observed.kind === 'array' &&
        (expected.readonly === undefined || observed.readonly === expected.readonly) &&
        this.typeShapeCompatible(expected.element, observed.element)
      )
    }
    if (expected.kind === 'record') {
      return (
        observed.kind === 'record' &&
        this.typeShapeCompatible(expected.key, observed.key) &&
        this.typeShapeCompatible(expected.value, observed.value)
      )
    }
    if (expected.kind === 'tuple') {
      return (
        observed.kind === 'tuple' &&
        (expected.readonly === undefined || observed.readonly === expected.readonly) &&
        observed.elements.length === expected.elements.length &&
        expected.elements.every((item, index) =>
          this.typeShapeCompatible(item, observed.elements[index]!),
        )
      )
    }
    if (expected.kind === 'union' || expected.kind === 'intersection') {
      return (
        observed.kind === expected.kind &&
        this.typeSetsShapeCompatible(expected.kind, expected.types, observed.types)
      )
    }
    if (expected.kind === 'conditional') {
      return (
        observed.kind === 'conditional' &&
        this.typeShapeCompatible(expected.check, observed.check) &&
        this.typeShapeCompatible(expected.extends, observed.extends) &&
        this.typeShapeCompatible(expected.trueType, observed.trueType) &&
        this.typeShapeCompatible(expected.falseType, observed.falseType)
      )
    }
    if (expected.kind === 'keyof') {
      return observed.kind === 'keyof' && this.typeShapeCompatible(expected.type, observed.type)
    }
    if (expected.kind === 'indexed-access') {
      return (
        observed.kind === 'indexed-access' &&
        this.typeShapeCompatible(expected.object, observed.object) &&
        this.typeShapeCompatible(expected.index, observed.index)
      )
    }
    if (expected.kind === 'object') {
      return (
        observed.kind === 'object' &&
        Boolean(this.matchObjectTypeMembers(expected.members, observed.members))
      )
    }
    if (expected.kind === 'function' || expected.kind === 'constructor') {
      if (observed.kind !== expected.kind) return false
      const expectedSignatures = expected.overloads?.length
        ? expected.overloads
        : [expected.callable]
      const observedSignatures = observed.overloads?.length
        ? observed.overloads
        : [observed.callable]
      return (
        expectedSignatures.length === observedSignatures.length &&
        expectedSignatures.every((signature, index) =>
          this.callableTypeShapeCompatible(signature, observedSignatures[index]!),
        )
      )
    }
    return false
  }

  protected callableTypeShapeCompatible(
    expected: ExpectedCallableType,
    observed: ObservedCallable,
  ): boolean {
    const expectedTypeParameters = expected.typeParameters ?? []
    const observedTypeParameters = observed.typeParameters ?? []
    this.bindTypeParameterScopes(expectedTypeParameters, observedTypeParameters)
    return (
      expected.mode === observed.mode &&
      expected.parameters.length === observed.parameters.length &&
      expectedTypeParameters.length === observedTypeParameters.length &&
      expectedTypeParameters.every((parameter, index) => {
        const actual = observedTypeParameters[index]!
        return (
          parameter.variance === actual.variance &&
          Boolean(parameter.const) === Boolean(actual.const) &&
          Boolean(parameter.constraint) === Boolean(actual.constraint) &&
          Boolean(parameter.default) === Boolean(actual.default) &&
          (!parameter.constraint ||
            !actual.constraint ||
            this.typeShapeCompatible(parameter.constraint.expression, actual.constraint)) &&
          (!parameter.default ||
            !actual.default ||
            this.typeShapeCompatible(parameter.default.expression, actual.default))
        )
      }) &&
      expected.parameters.every((parameter, index) => {
        const actual = observed.parameters[index]!
        return (
          parameter.optional === actual.optional &&
          Boolean(parameter.rest) === actual.rest &&
          this.typeShapeCompatible(
            parameter.expression,
            actual.optional ? withoutUndefined(actual.type) : actual.type,
          )
        )
      }) &&
      this.typeShapeCompatible(expected.returns.expression, observed.returns)
    )
  }

  protected effectiveTypeArgumentsForIdentity(
    reference: Extract<ObservedType, { kind: 'reference' }>,
    requestedLength: number,
  ): readonly ObservedType[] {
    const declaration = this.context.observedDeclarations.get(reference.identity)
    return declaration
      ? this.effectiveTypeArguments(reference, declaration, requestedLength)
      : reference.arguments
  }

  protected typeArgumentsShapeCompatible(
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
  ): boolean {
    return (
      expected.length === observed.length &&
      expected.every((argument, index) => this.typeShapeCompatible(argument, observed[index]!))
    )
  }

  protected typeSetsShapeCompatible(
    kind: 'union' | 'intersection',
    expected: readonly ExpectedTypeExpression[],
    observed: readonly ObservedType[],
  ): boolean {
    const normalizedExpected = this.normalizeExpectedTypeSet(kind, expected)
    const normalizedObserved = this.normalizeObservedTypeSet(
      kind,
      normalizedExpected,
      observed,
    )
    if (normalizedExpected.length !== normalizedObserved.length) return false
    const used = new Set<number>()
    const match = (index: number): boolean => {
      if (index === normalizedExpected.length) return true
      for (let candidate = 0; candidate < normalizedObserved.length; candidate++) {
        if (
          used.has(candidate) ||
          !this.typeShapeCompatible(normalizedExpected[index]!, normalizedObserved[candidate]!)
        ) {
          continue
        }
        used.add(candidate)
        if (match(index + 1)) return true
        used.delete(candidate)
      }
      return false
    }
    return match(0)
  }

  protected typeMismatch(
    ruleId: string,
    pointer: string,
    location: ImplementationLocation,
    expected: unknown,
    observed: unknown,
  ): false {
    this.fail(
      ruleId,
      'MODULE_TYPE_MISMATCH',
      'Public type differs from its declaration.',
      pointer,
      location,
      expected,
      observed,
    )
    return false
  }

  protected addInverse(
    id: string,
    status: VerificationStatus,
    message: string,
    location: ImplementationLocation | undefined,
    code?: string,
  ): void {
    const existing = this.rulesById.get(id)
    if (existing) {
      mergeRule(existing, status, code ? { code, message, location } : undefined)
      return
    }
    const rule: VerificationRule = {
      id,
      status,
      diagnostics: status === 'pass' ? [] : [{ code, message, location }],
    }
    this.rulesById.set(id, rule)
    this.rules.push(rule)
    this.evaluated.add(id)
  }

  protected pass(id: string): void {
    this.set(id, 'pass')
  }

  protected fail(
    id: string,
    code: string,
    message: string,
    pointer: string,
    actualLocation?: ImplementationLocation,
    expected?: unknown,
    actual?: unknown,
  ): void {
    this.set(id, 'fail', {
      code,
      message,
      location: expectedLocation(this.expected, pointer),
      related: actualLocation ? [actualLocation] : undefined,
      expected,
      actual,
    })
  }

  protected error(
    id: string,
    code: string,
    message: string,
    pointer: string,
    actualLocation?: ImplementationLocation,
    expected?: unknown,
    actual?: unknown,
  ): void {
    this.set(id, 'error', {
      code,
      message,
      location: expectedLocation(this.expected, pointer),
      related: actualLocation ? [actualLocation] : undefined,
      expected,
      actual,
    })
  }

  protected set(id: string, status: VerificationStatus, diagnostic?: VerificationDiagnostic): void {
    const rule = this.rulesById.get(id)
    if (!rule) {
      const created = { id, status, diagnostics: diagnostic ? [diagnostic] : [] }
      this.rulesById.set(id, created)
      this.rules.push(created)
      this.evaluated.add(id)
      return
    }
    if (!this.evaluated.has(id)) {
      rule.status = status
      rule.diagnostics = diagnostic ? [diagnostic] : []
      this.evaluated.add(id)
      return
    }
    mergeRule(rule, status, diagnostic)
  }
}
