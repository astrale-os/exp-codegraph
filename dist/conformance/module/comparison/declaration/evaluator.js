import { expectedLocation } from '../../contract/model.js';
import { canonicalExpected, declarationKindCompatible, observedDeclarationLookupKey, } from '../context.js';
import { declarationPrefix, matchesExternalType, externalAliasMatches, expectedDeclarationAliasesObserved, heritageProof, expectedTypeName, withoutUndefined, memberType, structuralExpectedMembers, expectedTypeParameterKey, substituteExpectedTypeParameters, substituteTypeParameters, reduceTransparentObservedType, witnessSkeletonCompatible, safeId, expectedDeclarationReferences, } from '../semantics.js';
import { TypeEvaluator } from '../type/evaluator.js';
export class DeclarationEvaluator extends TypeEvaluator {
    bindDeclaration(expectedIdentity, observed, ruleId, projection = 'full') {
        const expectedDeclaration = this.context.expected.declarations.get(expectedIdentity.key);
        if (!expectedDeclaration) {
            const unavailable = this.context.expected.unavailableModules.get(expectedIdentity.source);
            if (unavailable) {
                this.blockOnDependency(ruleId, expectedIdentity, unavailable, observed.location);
                return;
            }
            this.error(ruleId, 'MODULE_EXPECTED_DECLARATION_UNRESOLVED', `Compiled declaration identity is unavailable: ${expectedIdentity.key}`, expectedIdentity.pointer, observed.location);
            return;
        }
        const canonical = canonicalExpected(expectedIdentity.key, this.context.expected);
        this.usedExpected.add(canonical);
        const previous = this.bindings.get(canonical);
        const canonicalDeclaration = this.context.expected.declarations.get(canonical);
        if (expectedDeclaration.conformance === 'identity' ||
            expectedDeclaration.facets?.type.conformance === 'identity' ||
            expectedDeclaration.facets?.value.conformance === 'identity') {
            this.coverExpectedReferenceClosure(expectedDeclaration);
        }
        if (canonicalDeclaration !== undefined &&
            canonicalDeclaration.identity.source !== this.expected.id &&
            previous === undefined &&
            !expectedDeclarationAliasesObserved(canonicalDeclaration, observed) &&
            !this.observedAliasesExpectedDeclaration(observed.identity, canonicalDeclaration) &&
            this.context.observedDeclarationOwners.get(observed.identity) !==
                canonicalDeclaration.identity.source) {
            this.error(ruleId, 'MODULE_IMPORTED_DECLARATION_UNBOUND', `The owning module has not established a code identity for ${expectedIdentity.name}.`, expectedIdentity.pointer, observed.location, canonical, observed.identity);
            return;
        }
        if (previous &&
            previous !== observed.identity &&
            !this.observedIdentitiesEquivalent(previous, observed.identity)) {
            this.fail(ruleId, 'MODULE_DECLARATION_IDENTITY_MISMATCH', `Canonical declaration identity differs for ${expectedIdentity.name}.`, expectedIdentity.pointer, observed.location, previous, observed.identity);
            return;
        }
        if (previous && previous !== observed.identity) {
            this.boundObserved.add(observed.identity);
            this.coverObservedAliasClosure(previous);
            this.coverObservedAliasClosure(observed.identity);
            this.markAliasDeclarations(expectedIdentity.key);
            return;
        }
        this.bindings.set(canonical, observed.identity);
        this.boundObserved.add(observed.identity);
        this.coverObservedAliasClosure(observed.identity);
        this.markAliasDeclarations(expectedIdentity.key);
        if (expectedDeclaration.identity.source !== this.expected.id) {
            // A named imported declaration is the consumer's complete authority for
            // its provider-owned public closure. The provider module qualifies the
            // exact structure; requiring the consumer to redeclare every transparent
            // helper alias would turn one import into a duplicated schema.
            this.coverIdentityClosure(observed.identity);
            if (expectedDeclaration.conformance === 'identity' ||
                expectedDeclaration.facets?.type.conformance === 'identity' ||
                expectedDeclaration.facets?.value.conformance === 'identity') {
                this.coverExpectedReferenceClosure(expectedDeclaration);
            }
            if (expectedDeclaration.facets?.value.conformance === 'identity') {
                this.identityCovered.add(`${observed.identity}#value`);
            }
            if (expectedDeclaration.facets?.type.conformance === 'identity' &&
                expectedDeclaration.facets.value.conformance === 'identity') {
                this.identityCovered.add(`${observed.identity}#factory`);
            }
            return;
        }
        const pair = `${expectedDeclaration.identity.key}\0${observed.identity}\0${projection}`;
        if (this.pairs.has(pair))
            return;
        this.pairs.add(pair);
        if (projection === 'type')
            this.compareProjectedTypeDeclaration(expectedDeclaration, observed);
        else if (projection === 'identity') {
            this.pass(declarationPrefix(expectedDeclaration));
            this.coverIdentityClosure(observed.identity);
        }
        else
            this.compareDeclaration(expectedDeclaration, observed);
    }
    blockOnDependency(ruleId, expectedIdentity, unavailable, actualLocation) {
        // This is a real use of the import, but its owner could not produce a contract. Marking it
        // used prevents the causal failure from being followed by a false stale-import diagnostic.
        this.usedExpected.add(expectedIdentity.key);
        this.set(ruleId, 'idle');
        if (this.blockedDependencies.has(unavailable.id))
            return;
        this.blockedDependencies.add(unavailable.id);
        const cause = unavailable.diagnostics[0];
        this.set(`module.dependency.contract.${safeId(unavailable.id)}`, 'error', {
            code: 'MODULE_CONTRACT_DEPENDENCY_UNAVAILABLE',
            message: `The API contract required from ${unavailable.name} is unavailable; dependent obligations were not evaluated.`,
            location: expectedLocation(this.expected, expectedIdentity.pointer),
            related: [
                ...(actualLocation ? [actualLocation] : []),
                ...(cause
                    ? [
                        {
                            file: cause.file,
                            line: cause.line,
                            column: cause.column,
                            ...(cause.pointer ? { pointer: cause.pointer } : {}),
                            label: `${cause.code}: ${cause.message}`,
                        },
                    ]
                    : [{ file: unavailable.source }]),
            ],
            expected: expectedIdentity.key,
            actual: null,
        });
    }
    compareProjectedTypeDeclaration(expected, observed) {
        const prefix = declarationPrefix(expected);
        const type = observed.facets?.type;
        if (expected.identity.kind !== 'value') {
            this.fail(prefix, 'MODULE_DECLARATION_KIND_MISMATCH', `Type-only export does not expose a type-alias facet for ${expected.identity.name}.`, expected.pointer, observed.location);
            this.failDeclarationChildren(expected, observed.location, 'Type-alias facet unavailable.');
            return;
        }
        this.pass(prefix);
        if (expected.conformance === 'identity') {
            this.coverIdentityClosure(observed.identity);
            return;
        }
        this.compareTypeParameters(expected, observed);
        if (expected.alias)
            return;
        if (expected.valueType) {
            const id = `${prefix}.type`;
            if (externalAliasMatches(expected.valueType, observed)) {
                this.pass(id);
            }
            else if (!type) {
                this.fail(id, 'MODULE_TYPE_FACET_MISSING', `Type-only export does not expose materializable type evidence for ${expected.identity.name}.`, expected.valueType.pointer, observed.location);
            }
            else if (this.compareType(expected.valueType, type.valueType, id, type.location)) {
                this.pass(id);
            }
        }
        this.coverIdentityClosure(observed.identity);
    }
    compareDeclaration(expected, observed) {
        const prefix = declarationPrefix(expected);
        // A type alias contributes no independent runtime or structural declaration.
        // Its canonical target has already been identity-bound by bindDeclaration, so
        // comparing the alias's syntactic `value` kind to a merged target would reject
        // a valid type-only projection.
        if (expected.alias) {
            this.pass(prefix);
            this.coverIdentityClosure(observed.identity);
            return;
        }
        if (!declarationKindCompatible(expected.identity.kind, observed, expected)) {
            this.fail(prefix, 'MODULE_DECLARATION_KIND_MISMATCH', `Declaration kind differs for ${expected.identity.name}.`, expected.pointer, observed.location, expected.identity.kind, observed.kind);
            this.failDeclarationChildren(expected, observed.location, 'Declaration kind mismatch.');
            return;
        }
        this.pass(prefix);
        if (expected.conformance === 'exact' && !expected.facets) {
            this.compareTypeParameters(expected, observed);
        }
        if (expected.facets) {
            this.compareDeclarationFacets(expected, observed);
            if (expected.conformance === 'identity' ||
                expected.facets.type.conformance === 'identity' ||
                expected.facets.value.conformance === 'identity') {
                this.coverIdentityClosure(observed.identity);
            }
            if (expected.facets.value.conformance === 'identity') {
                this.identityCovered.add(`${observed.identity}#value`);
            }
            if (expected.facets.type.conformance === 'identity' &&
                expected.facets.value.conformance === 'identity') {
                this.identityCovered.add(`${observed.identity}#factory`);
            }
            return;
        }
        if (expected.conformance === 'identity') {
            this.coverIdentityClosure(observed.identity);
            return;
        }
        if (expected.identity.kind === 'value') {
            if (expected.valueType) {
                const id = `${declarationPrefix(expected)}.type`;
                if (externalAliasMatches(expected.valueType, observed)) {
                    this.pass(id);
                    this.coverIdentityClosure(observed.identity);
                    return;
                }
                else if (!observed.valueType) {
                    this.fail(id, 'MODULE_VALUE_TYPE_MISSING', `The public value type is unavailable: ${expected.identity.name}`, expected.valueType.pointer, observed.location);
                }
                else if (this.compareType(expected.valueType, observed.valueType, id, observed.location)) {
                    this.pass(id);
                }
            }
            const observedFields = observed.kind === 'interface' ? observed.properties : observed.fields;
            this.compareMembers(expected, observed, 'field', expected.fields?.length
                ? expected.fields
                : observedFields?.length
                    ? structuralExpectedMembers(expected.valueType?.expression)
                    : undefined, observedFields);
            this.compareCallableMembers(expected, observed, 'callable', expected.callables, observed.callables);
            this.compareHeritage(expected, observed, 'extends', expected.extends, observed.kind === 'interface' ? observed.extends : []);
            return;
        }
        if (expected.identity.kind === 'callable') {
            if (!observed.callable) {
                this.failDeclarationChildren(expected, observed.location, 'Callable signature is unavailable.');
                return;
            }
            this.compareCallableSignatures(expected, observed.callable, observed.overloads);
            return;
        }
        this.compareMembers(expected, observed, 'property', expected.properties, observed.properties);
        this.compareCallableMembers(expected, observed, 'callable', expected.callables, observed.callables);
        this.compareCallSignature(expected, observed);
        if (expected.identity.kind === 'class') {
            this.compareCallableMembers(expected, observed, 'static', expected.statics, observed.statics);
        }
        this.compareHeritage(expected, observed, 'extends', expected.extends, observed.extends);
        this.compareHeritage(expected, observed, 'implements', expected.implements, observed.implements);
    }
    compareCallSignature(expected, observed) {
        const prefix = declarationPrefix(expected);
        const expectedCallable = expected.returns !== undefined || Boolean(expected.overloads?.length);
        if (!expectedCallable) {
            if (observed.callable) {
                this.addInverse(`observed.call-signature.${safeId(observed.identity)}`, 'fail', `Public call signature is not declared: ${observed.name}().`, observed.callable.location, 'MODULE_CALL_SIGNATURE_UNDECLARED');
            }
            return;
        }
        const id = `${prefix}.call-signature`;
        if (!observed.callable) {
            this.fail(id, 'MODULE_CALL_SIGNATURE_MISSING', `Specified call signature is absent: ${expected.identity.name}().`, expected.pointer, observed.location);
            for (const obligation of this.expected.obligations) {
                if (obligation.id.startsWith(`${prefix}.parameter.`) ||
                    obligation.id === `${prefix}.return` ||
                    obligation.id === `${prefix}.mode`) {
                    this.set(obligation.id, 'fail', {
                        code: 'MODULE_CALL_SIGNATURE_MISSING',
                        message: `Containing call signature is absent: ${expected.identity.name}().`,
                        location: expectedLocation(this.expected, obligation.pointer),
                        related: [observed.location],
                    });
                }
            }
            return;
        }
        this.pass(id);
        this.compareCallableSignatures(expected, observed.callable, observed.overloads, {
            expectedTypeParameters: expected.callableTypeParameters ?? [],
            typeParameterPrefix: `${prefix}.call-signature`,
        });
    }
    compareTypeParameters(expected, observed, options) {
        const expectedParameters = options?.expectedParameters ?? expected.typeParameters ?? [];
        const observedParameters = options?.observedParameters ?? observed.typeParameters ?? [];
        const prefix = options?.prefix ?? declarationPrefix(expected);
        const inverseIdentity = options?.prefix ?? observed.identity;
        this.bindTypeParameterScopes(expectedParameters, observedParameters);
        const maximum = Math.max(expectedParameters.length, observedParameters.length);
        for (let index = 0; index < maximum; index++) {
            const parameter = expectedParameters[index];
            const actual = observedParameters[index];
            if (!parameter) {
                this.addInverse(`observed.type-parameter.${safeId(inverseIdentity)}.${index}`, 'fail', `Public generic declaration has an undeclared type parameter at position ${index}.`, actual?.location, 'MODULE_TYPE_PARAMETER_UNDECLARED');
                continue;
            }
            const id = `${prefix}.type-parameter.${index}`;
            if (!actual) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_MISSING', `Generic type parameter is absent at position ${index}.`, parameter.pointer, observed.location);
                continue;
            }
            if (parameter.variance !== actual.variance) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_VARIANCE_MISMATCH', `Generic type parameter variance differs at position ${index}.`, parameter.pointer, actual.location, parameter.variance, actual.variance);
                continue;
            }
            if (Boolean(parameter.const) !== Boolean(actual.const)) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_CONST_MISMATCH', `Generic type parameter const inference differs at position ${index}.`, parameter.pointer, actual.location, Boolean(parameter.const), Boolean(actual.const));
                continue;
            }
            if (Boolean(parameter.constraint) !== Boolean(actual.constraint)) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_CONSTRAINT_MISMATCH', `Generic type parameter constraint differs at position ${index}.`, parameter.pointer, actual.location, parameter.constraint?.expression, actual.constraint);
                continue;
            }
            if (parameter.constraint &&
                actual.constraint &&
                !this.typeShapeCompatible(parameter.constraint.expression, actual.constraint)) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_CONSTRAINT_MISMATCH', `Generic type parameter constraint differs at position ${index}.`, parameter.constraint.pointer, actual.location, parameter.constraint.expression, actual.constraint);
                continue;
            }
            if (parameter.constraint && actual.constraint) {
                this.compareType(parameter.constraint, actual.constraint, id, actual.location);
            }
            if (Boolean(parameter.default) !== Boolean(actual.default)) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_DEFAULT_MISMATCH', `Generic type parameter default differs at position ${index}.`, parameter.pointer, actual.location, parameter.default?.expression, actual.default);
                continue;
            }
            if (parameter.default &&
                actual.default &&
                !this.typeShapeCompatible(parameter.default.expression, actual.default)) {
                this.fail(id, 'MODULE_TYPE_PARAMETER_DEFAULT_MISMATCH', `Generic type parameter default differs at position ${index}.`, parameter.default.pointer, actual.location, parameter.default.expression, actual.default);
                continue;
            }
            if (parameter.default && actual.default) {
                this.compareType(parameter.default, actual.default, id, actual.location);
            }
            this.pass(id);
            this.addInverse(`observed.type-parameter.${safeId(inverseIdentity)}.${index}`, 'pass', `Observed generic type parameter is declared at position ${index}.`, actual.location);
        }
    }
    compareDeclarationFacets(expected, observed) {
        const expectedFacets = expected.facets;
        if (!expectedFacets)
            return;
        const prefix = declarationPrefix(expected);
        const typeId = `${prefix}.facet.type`;
        const typeValueId = `${typeId}.value`;
        const observedType = observed.facets?.type;
        if (!observedType) {
            this.fail(typeId, 'MODULE_TYPE_FACET_MISSING', `Type-alias facet is absent: ${expected.identity.name}`, expectedFacets.type.pointer, observed.location);
            if (expectedFacets.type.valueType) {
                this.fail(typeValueId, 'MODULE_TYPE_FACET_MISSING', `Type-alias facet is unavailable for comparison: ${expected.identity.name}`, expectedFacets.type.valueType.pointer, observed.location);
            }
        }
        else {
            this.pass(typeId);
            if (expectedFacets.type.conformance === 'exact') {
                this.compareTypeParameters(expected, observed, {
                    prefix: typeId,
                    expectedParameters: expectedFacets.type.typeParameters ?? [],
                    observedParameters: observed.typeParameters ?? [],
                });
            }
            if (expectedFacets.type.valueType) {
                if (expectedFacets.type.conformance === 'identity') {
                    this.pass(typeValueId);
                }
                else if (this.compareType(expectedFacets.type.valueType, observedType.valueType, typeValueId, observedType.location)) {
                    this.pass(typeValueId);
                }
            }
        }
        const valueId = `${prefix}.facet.value`;
        const observedValue = observed.facets?.value;
        if (!observedValue) {
            this.fail(valueId, 'MODULE_VALUE_FACET_MISSING', `Runtime value facet is absent: ${expected.identity.name}`, expectedFacets.value.pointer, observed.location);
            return;
        }
        this.pass(valueId);
        if (expectedFacets.value.kind === 'value') {
            const valueTypeId = `${valueId}.type`;
            if (observedValue.kind !== 'value') {
                this.fail(valueTypeId, 'MODULE_VALUE_FACET_KIND_MISMATCH', `Runtime value facet is callable but an object-valued constructor namespace is required: ${expected.identity.name}`, expectedFacets.value.valueType.pointer, observedValue.location);
            }
            else if (expectedFacets.value.conformance === 'identity') {
                this.pass(valueTypeId);
            }
            else if (this.compareType(expectedFacets.value.valueType, observedValue.valueType, valueTypeId, observedValue.location)) {
                this.pass(valueTypeId);
            }
            return;
        }
        if (observedValue.kind !== 'callable') {
            this.fail(valueId, 'MODULE_VALUE_FACET_KIND_MISMATCH', `Runtime value facet is not callable: ${expected.identity.name}`, expectedFacets.value.pointer, observedValue.location);
            return;
        }
        const signature = this.context.expected.declarations.get(expectedFacets.value.callable.key);
        const selfFactorySignature = signature?.identity.key === expected.identity.key && signature.facets !== undefined;
        if (!signature || (signature.identity.kind !== 'callable' && !selfFactorySignature)) {
            this.error(valueId, 'MODULE_FACTORY_REFERENCE_INVALID', `Factory signature declaration is unavailable: ${expectedFacets.value.callable.key}`, expectedFacets.value.pointer, observedValue.location);
            return;
        }
        this.usedExpected.add(canonicalExpected(signature.identity.key, this.context.expected));
        this.markAliasDeclarations(signature.identity.key);
        if (!selfFactorySignature)
            this.pass(declarationPrefix(signature));
        if (expectedFacets.value.conformance === 'exact') {
            this.compareCallableSignatures(signature, observedValue.callable, observedValue.overloads);
        }
    }
    compareMembers(declaration, observedDeclaration, category, expectedMembers, observedMembers) {
        const observed = observedMembers ?? [];
        const matchedObserved = new Set();
        for (const member of expectedMembers ?? []) {
            const id = `${declarationPrefix(declaration)}.${category}.${member.name}`;
            const actual = this.matchMember(member, observed, matchedObserved);
            if (!actual?.type) {
                this.fail(id, 'MODULE_MEMBER_MISSING', `Specified ${category} is absent: ${declaration.identity.name}.${member.name}`, member.pointer, actual?.location);
                continue;
            }
            matchedObserved.add(actual);
            if (member.optional !== actual.optional) {
                this.fail(id, 'MODULE_OPTIONALITY_MISMATCH', `Optionality differs for ${declaration.identity.name}.${member.name}.`, member.pointer, actual.location, member.optional, actual.optional);
                continue;
            }
            if (member.readonly !== undefined && member.readonly !== actual.readonly) {
                this.fail(id, 'MODULE_READONLY_MISMATCH', `Readonly semantics differ for ${declaration.identity.name}.${member.name}.`, member.pointer, actual.location, member.readonly, actual.readonly);
                continue;
            }
            const actualType = actual.optional ? withoutUndefined(actual.type) : actual.type;
            if (this.compareType(member, actualType, id, actual.location))
                this.pass(id);
        }
        for (const actual of observed) {
            const inverseId = `observed.${category}.${safeId(observedDeclaration.identity)}.${safeId(actual.name)}`;
            if (matchedObserved.has(actual)) {
                this.addInverse(inverseId, 'pass', `Observed ${category} is declared: ${actual.name}`, actual.location);
            }
            else {
                this.addInverse(inverseId, 'fail', `Public ${category} is not declared: ${observedDeclaration.name}.${actual.name}`, actual.location, 'MODULE_MEMBER_UNDECLARED');
            }
        }
    }
    matchMember(expected, observed, used) {
        if (expected.key === 'named') {
            return observed.find((member) => !used.has(member) && member.key === 'named' && member.name === expected.name);
        }
        // A declaration-private unique symbol has no cross-program identity. Match
        // witness properties by their complete structural role, making private
        // symbol spelling and declaration order alpha-renamable.
        const candidates = observed.filter((member) => {
            if (used.has(member) || member.key !== 'unique-symbol' || !member.type)
                return false;
            if (expected.optional !== member.optional)
                return false;
            if (expected.readonly !== undefined && expected.readonly !== member.readonly)
                return false;
            return true;
        });
        const exact = candidates.find((member) => {
            const actualType = member.optional ? withoutUndefined(member.type) : member.type;
            return this.typeShapeCompatible(expected.expression, actualType);
        });
        if (exact)
            return exact;
        return (candidates.find((member) => witnessSkeletonCompatible(expected.expression, member.optional ? withoutUndefined(member.type) : member.type)) ?? candidates[0]);
    }
    compareCallableMembers(declaration, observedDeclaration, category, expectedMembers, observedMembers) {
        const expectedByName = new Map((expectedMembers ?? []).map((member) => [member.name, member]));
        const observedByName = new Map((observedMembers ?? []).map((member) => [member.name, member]));
        for (const member of expectedMembers ?? []) {
            const id = `${declarationPrefix(declaration)}.${category}.${member.name}`;
            const actual = observedByName.get(member.name);
            if (!actual?.callable) {
                this.fail(id, 'MODULE_CALLABLE_MEMBER_MISSING', `Specified ${category} is absent: ${declaration.identity.name}.${member.name}`, member.pointer, actual?.location);
                continue;
            }
            if (Boolean(member.optional) !== actual.optional) {
                this.fail(id, 'MODULE_CALLABLE_OPTIONALITY_MISMATCH', `Callable member optionality differs: ${declaration.identity.name}.${member.name}`, member.pointer, actual.location, Boolean(member.optional), actual.optional);
            }
            this.pass(id);
            const signature = this.context.expected.declarations.get(member.callable.key);
            if (!signature || signature.identity.kind !== 'callable') {
                this.error(id, 'MODULE_CALLABLE_REFERENCE_INVALID', `Callable signature declaration is unavailable: ${member.callable.key}`, member.pointer, actual.location);
                continue;
            }
            this.usedExpected.add(canonicalExpected(signature.identity.key, this.context.expected));
            this.markAliasDeclarations(signature.identity.key);
            this.pass(declarationPrefix(signature));
            if (signature.conformance === 'exact') {
                this.compareCallableSignatures(signature, actual.callable, actual.overloads);
            }
        }
        for (const actual of observedMembers ?? []) {
            const inverseId = `observed.${category}.${safeId(observedDeclaration.identity)}.${safeId(actual.name)}`;
            if (expectedByName.has(actual.name)) {
                this.addInverse(inverseId, 'pass', `Observed ${category} is declared: ${actual.name}`, actual.location);
            }
            else {
                this.addInverse(inverseId, 'fail', `Public ${category} is not declared: ${observedDeclaration.name}.${actual.name}`, actual.location, 'MODULE_MEMBER_UNDECLARED');
            }
        }
    }
    compareCallableSignatures(expected, observed, observedOverloads, options) {
        const expectedOverloads = expected.overloads;
        const actual = observedOverloads?.length ? observedOverloads : [observed];
        if (!expectedOverloads?.length) {
            if (actual.length > 1) {
                this.addInverse(`observed.overload.${safeId(declarationPrefix(expected))}`, 'fail', `Public callable has ${actual.length} overloads but the contract declares one signature.`, actual[1]?.location ?? observed.location, 'MODULE_OVERLOAD_UNDECLARED');
            }
            this.compareCallable(expected, actual[0], options);
            return;
        }
        const prefix = declarationPrefix(expected);
        const maximum = Math.max(expectedOverloads.length, actual.length);
        for (let index = 0; index < maximum; index++) {
            const specified = expectedOverloads[index];
            const implemented = actual[index];
            if (!specified) {
                this.addInverse(`observed.overload.${safeId(prefix)}.${index}`, 'fail', `Public callable has an undeclared overload at position ${index}.`, implemented?.location, 'MODULE_OVERLOAD_UNDECLARED');
                continue;
            }
            const id = `${prefix}.overload.${index}`;
            const pointer = specified.pointer ?? expected.pointer;
            if (!implemented) {
                this.fail(id, 'MODULE_OVERLOAD_MISSING', `Specified overload is absent at position ${index}.`, pointer, observed.location);
                continue;
            }
            if (this.compareCallableType(specified, implemented, id, pointer))
                this.pass(id);
        }
    }
    compareCallableType(expected, observed, ruleId, pointer) {
        const expectedTypeParameters = expected.typeParameters ?? [];
        const observedTypeParameters = observed.typeParameters ?? [];
        this.bindTypeParameterScopes(expectedTypeParameters, observedTypeParameters);
        if (expected.mode !== observed.mode ||
            expected.parameters.length !== observed.parameters.length ||
            expectedTypeParameters.length !== observedTypeParameters.length) {
            this.fail(ruleId, 'MODULE_OVERLOAD_SIGNATURE_MISMATCH', 'Callable overload mode, arity, or generic arity differs.', pointer, observed.location, expected, observed);
            return false;
        }
        let matches = true;
        for (const [index, parameter] of expectedTypeParameters.entries()) {
            const actual = observedTypeParameters[index];
            const sameSkeleton = parameter.variance === actual.variance &&
                Boolean(parameter.const) === Boolean(actual.const) &&
                Boolean(parameter.constraint) === Boolean(actual.constraint) &&
                Boolean(parameter.default) === Boolean(actual.default);
            if (!sameSkeleton) {
                this.fail(ruleId, 'MODULE_OVERLOAD_TYPE_PARAMETER_MISMATCH', `Callable overload type parameter differs at position ${index}.`, parameter.pointer, actual.location);
                matches = false;
                continue;
            }
            if (parameter.constraint &&
                actual.constraint &&
                !this.compareTypeExpression(parameter.constraint.expression, actual.constraint, ruleId, actual.location, parameter.constraint.pointer)) {
                matches = false;
            }
            if (parameter.default &&
                actual.default &&
                !this.compareTypeExpression(parameter.default.expression, actual.default, ruleId, actual.location, parameter.default.pointer)) {
                matches = false;
            }
        }
        for (const [index, parameter] of expected.parameters.entries()) {
            const actual = observed.parameters[index];
            if (parameter.optional !== actual.optional || Boolean(parameter.rest) !== actual.rest) {
                this.fail(ruleId, 'MODULE_OVERLOAD_PARAMETER_MISMATCH', `Callable overload parameter differs at position ${index}.`, parameter.pointer, actual.location);
                matches = false;
                continue;
            }
            const actualType = actual.optional ? withoutUndefined(actual.type) : actual.type;
            if (!this.compareTypeExpression(parameter.expression, actualType, ruleId, actual.location, parameter.pointer)) {
                matches = false;
            }
        }
        if (!this.compareTypeExpression(expected.returns.expression, observed.returns, ruleId, observed.location, expected.returns.pointer)) {
            matches = false;
        }
        return matches;
    }
    compareCallable(expected, observed, options) {
        const prefix = declarationPrefix(expected);
        this.compareCallableTypeParameters(expected, observed, options?.typeParameterPrefix ?? prefix, options?.expectedTypeParameters);
        const expectedParameters = expected.parameters ?? [];
        const maximum = Math.max(expectedParameters.length, observed.parameters.length);
        for (let index = 0; index < maximum; index++) {
            const parameter = expectedParameters[index];
            const actual = observed.parameters[index];
            if (!parameter) {
                this.addInverse(`observed.parameter.${safeId(prefix)}.${index}.${safeId(actual.name)}`, 'fail', `Public callable has an undeclared parameter at position ${index}: ${actual.name}`, actual.location, 'MODULE_PARAMETER_UNDECLARED');
                continue;
            }
            const id = `${prefix}.parameter.${parameter.index}.${parameter.name}`;
            if (!actual) {
                // The imported type is causally required by this missing public slot.
                // Reporting it again as a stale contract import would duplicate the
                // surface failure and incorrectly call the specification reference dead.
                this.markExpectedTypeDependencies(parameter.expression);
                this.fail(id, 'MODULE_PARAMETER_MISSING', `Callable parameter is absent at position ${index}: ${parameter.name}`, parameter.pointer, observed.location);
                continue;
            }
            if (parameter.optional !== actual.optional) {
                this.fail(id, 'MODULE_PARAMETER_OPTIONALITY_MISMATCH', `Callable parameter optionality differs: ${parameter.name}`, parameter.pointer, actual.location, parameter.optional, actual.optional);
                continue;
            }
            if (parameter.rest !== undefined && parameter.rest !== actual.rest) {
                this.fail(id, 'MODULE_PARAMETER_REST_MISMATCH', `Callable parameter rest semantics differ: ${parameter.name}`, parameter.pointer, actual.location, parameter.rest, actual.rest);
                continue;
            }
            const actualType = actual.optional ? withoutUndefined(actual.type) : actual.type;
            if (this.compareType(parameter, actualType, id, actual.location))
                this.pass(id);
            this.addInverse(`observed.parameter.${safeId(prefix)}.${index}.${safeId(actual.name)}`, 'pass', `Observed parameter is declared: ${actual.name}`, actual.location);
        }
        if (expected.returns !== undefined) {
            const id = `${prefix}.return`;
            if (expected.returns === null) {
                if (observed.returns.kind === 'void')
                    this.pass(id);
                else
                    this.fail(id, 'MODULE_RETURN_TYPE_MISMATCH', 'Callable return type differs.', `${expected.pointer}/returns`, observed.location, 'void', observed.returns);
            }
            else if (this.compareType(expected.returns, observed.returns, id, observed.location)) {
                this.pass(id);
            }
        }
        if (expected.mode) {
            const id = `${prefix}.mode`;
            if (expected.mode === observed.mode)
                this.pass(id);
            else
                this.fail(id, 'MODULE_CALLABLE_MODE_MISMATCH', 'Callable sync/async mode differs.', `${expected.pointer}/mode`, observed.location, expected.mode, observed.mode);
        }
    }
    compareCallableTypeParameters(expected, observed, prefix, expectedParameters) {
        const declared = expectedParameters ?? expected.typeParameters ?? [];
        const actual = observed.typeParameters ?? [];
        this.bindTypeParameterScopes(declared, actual);
        const maximum = Math.max(declared.length, actual.length);
        for (let index = 0; index < maximum; index++) {
            const parameter = declared[index];
            const observedParameter = actual[index];
            if (!parameter || !observedParameter) {
                const id = `${prefix}.type-parameter.${index}`;
                this.fail(id, !parameter ? 'MODULE_TYPE_PARAMETER_UNDECLARED' : 'MODULE_TYPE_PARAMETER_MISSING', `Callable type parameter differs at position ${index}.`, parameter?.pointer ?? expected.pointer, observedParameter?.location ?? observed.location);
                continue;
            }
            const id = `${prefix}.type-parameter.${index}`;
            const constraintMatches = Boolean(parameter.constraint) === Boolean(observedParameter.constraint) &&
                (!parameter.constraint ||
                    !observedParameter.constraint ||
                    this.typeShapeCompatible(parameter.constraint.expression, observedParameter.constraint));
            const defaultMatches = Boolean(parameter.default) === Boolean(observedParameter.default) &&
                (!parameter.default ||
                    !observedParameter.default ||
                    this.typeShapeCompatible(parameter.default.expression, observedParameter.default));
            if (parameter.variance === observedParameter.variance &&
                Boolean(parameter.const) === Boolean(observedParameter.const) &&
                constraintMatches &&
                defaultMatches) {
                this.pass(id);
            }
            else {
                this.fail(id, 'MODULE_TYPE_PARAMETER_MISMATCH', `Callable type parameter differs at position ${index}.`, parameter.pointer, observedParameter.location);
            }
        }
    }
    compareHeritage(declaration, observedDeclaration, category, expectedValues, observedValues) {
        const remaining = new Set(observedValues ?? []);
        for (const expected of expectedValues ?? []) {
            const id = `${declarationPrefix(declaration)}.${category}.${heritageProof(expected)}`;
            const expression = expected.expression;
            const candidates = [...remaining].filter((identity) => {
                if (expression.kind === 'external' &&
                    expression.target.startsWith('platform:') &&
                    identity === `${expression.target}#${expression.name}`) {
                    return true;
                }
                const target = this.context.observedDeclarations.get(identity);
                if (!target) {
                    return (expression.kind === 'external' && identity === `${expression.target}#${expression.name}`);
                }
                if (expression.kind === 'external')
                    return matchesExternalType(expression, target);
                if (expression.kind !== 'declaration')
                    return false;
                const canonical = canonicalExpected(expression.declaration.key, this.context.expected);
                const seeded = this.bindings.get(canonical);
                return seeded ? seeded === identity : target.name === expression.declaration.name;
            });
            const actual = candidates.length === 1 ? candidates[0] : undefined;
            if (!actual) {
                this.fail(id, 'MODULE_HERITAGE_MISSING', `Heritage declaration is absent or ambiguous: ${expectedTypeName(expected)}`, expected.pointer, observedDeclaration.location);
                continue;
            }
            if (expression.kind === 'external' &&
                expression.target.startsWith('platform:') &&
                actual === `${expression.target}#${expression.name}`) {
                remaining.delete(actual);
                this.pass(id);
                continue;
            }
            const observedTarget = this.context.observedDeclarations.get(actual);
            if (!observedTarget) {
                if (expression.kind === 'external' &&
                    actual === `${expression.target}#${expression.name}`) {
                    remaining.delete(actual);
                    this.pass(id);
                    continue;
                }
                this.error(id, 'MODULE_HERITAGE_UNRESOLVED', `Heritage target could not be observed: ${actual}`, expected.pointer, observedDeclaration.location);
                continue;
            }
            remaining.delete(actual);
            if (expression.kind === 'declaration') {
                this.bindDeclaration(expression.declaration, observedTarget, id);
            }
            else if (expression.kind === 'external') {
                this.coverIdentityClosure(observedTarget.identity);
            }
            if (!this.evaluated.has(id))
                this.pass(id);
        }
        for (const actual of remaining) {
            const target = this.context.observedDeclarations.get(actual);
            this.addInverse(`observed.heritage.${safeId(observedDeclaration.identity)}.${category}.${safeId(actual)}`, 'fail', `Public ${category} target is not declared: ${target?.name ?? actual}`, target?.location ?? observedDeclaration.location, 'MODULE_HERITAGE_UNDECLARED');
        }
    }
    coverIdentityClosure(identity) {
        const pending = [identity];
        while (pending.length) {
            const current = pending.pop();
            if (this.identityCovered.has(current))
                continue;
            this.identityCovered.add(current);
            this.boundObserved.add(current);
            const declaration = this.context.observedDeclarations.get(current);
            if (declaration)
                pending.push(...declaration.referencedDeclarations);
        }
    }
    /**
     * Identity conformance intentionally withholds structural evidence. Preserve
     * the authored dependency closure that is hidden by that opacity so a public
     * reference is not misclassified as stale. Imported declarations remain
     * terminals: their own dependency closure belongs to their owning module.
     */
    coverExpectedReferenceClosure(root) {
        if (root.identity.source !== this.expected.id)
            return;
        const pending = [root];
        const visited = new Set();
        while (pending.length) {
            const declaration = pending.pop();
            if (visited.has(declaration.identity.key))
                continue;
            visited.add(declaration.identity.key);
            this.usedExpected.add(canonicalExpected(declaration.identity.key, this.context.expected));
            for (const reference of expectedDeclarationReferences(declaration)) {
                this.usedExpected.add(canonicalExpected(reference.key, this.context.expected));
                const target = this.context.expected.declarations.get(reference.key);
                if (target?.identity.source === this.expected.id)
                    pending.push(target);
            }
        }
    }
    markAliasDeclarations(identity) {
        let current = identity;
        const seen = new Set();
        while (current && !seen.has(current)) {
            seen.add(current);
            const declaration = this.context.expected.declarations.get(current);
            if (!declaration)
                break;
            if (declaration.identity.source === this.expected.id)
                this.pass(declarationPrefix(declaration));
            current = declaration.alias?.key;
        }
    }
    /**
     * A facade factory commonly names an internal type alias in its type facet. Both symbols denote
     * one public type authority even though TypeScript assigns them different declaration identities.
     */
    observedIdentitiesEquivalent(left, right) {
        if (left === right)
            return true;
        const leftClosure = this.observedAliasClosure(left);
        const rightClosure = this.observedAliasClosure(right);
        for (const identity of leftClosure)
            if (rightClosure.has(identity))
                return true;
        return false;
    }
    /** Compare polymorphic-this through the declaration binding already proven for its owner. */
    thisOwnerCompatible(expectedOwner, observedOwner) {
        const canonical = canonicalExpected(expectedOwner, this.context.expected);
        const bound = this.bindings.get(canonical);
        return bound
            ? this.observedIdentitiesEquivalent(bound, observedOwner)
            : expectedOwner === observedOwner;
    }
    observedAliasesExpectedDeclaration(identity, expected) {
        for (const current of this.observedAliasClosure(identity)) {
            const declaration = this.context.observedDeclarations.get(current);
            if (declaration?.name === expected.identity.name &&
                this.context.observedDeclarationOwners.get(current) === expected.identity.source) {
                return true;
            }
        }
        return false;
    }
    expectedDeclarationShape(reference) {
        const canonical = canonicalExpected(reference.declaration.key, this.context.expected);
        const declaration = this.context.expected.declarations.get(canonical);
        const parameters = declaration?.facets?.type.typeParameters ?? declaration?.typeParameters ?? [];
        if (!declaration || reference.arguments.length > parameters.length)
            return;
        const bindings = new Map();
        for (let index = 0; index < parameters.length; index++) {
            const parameter = parameters[index];
            const argument = reference.arguments[index] ??
                (parameter.default
                    ? substituteExpectedTypeParameters(parameter.default.expression, bindings)
                    : undefined);
            if (!argument)
                return;
            bindings.set(expectedTypeParameterKey(parameter.scope, parameter.index), argument);
        }
        const declaredShape = declaration?.facets?.type.valueType?.expression ?? declaration?.valueType?.expression;
        const shape = declaredShape
            ? substituteExpectedTypeParameters(declaredShape, bindings)
            : undefined;
        if (shape?.kind === 'declaration' &&
            canonicalExpected(shape.declaration.key, this.context.expected) === canonical) {
            return;
        }
        return shape;
    }
    bindExpandedDeclarationReference(reference, observed, ruleId, location, pointer) {
        const shape = this.expectedDeclarationShape(reference);
        if (!shape || !this.typeShapeCompatible(shape, observed))
            return false;
        const canonical = canonicalExpected(reference.declaration.key, this.context.expected);
        const expected = this.context.expected.declarations.get(canonical);
        if (!expected)
            return false;
        const candidates = (this.context.observedDeclarationsByOwnerAndName.get(observedDeclarationLookupKey(expected.identity.source, expected.identity.name)) ?? []).filter((candidate) => declarationKindCompatible(expected.identity.kind, candidate, expected));
        if (candidates.length !== 1)
            return false;
        const candidate = candidates[0];
        const previous = this.bindings.get(canonical);
        if (previous && !this.observedIdentitiesEquivalent(previous, candidate.identity)) {
            this.fail(ruleId, 'MODULE_DECLARATION_IDENTITY_MISMATCH', `Canonical declaration identity differs for ${reference.declaration.name}.`, pointer, location, previous, candidate.identity);
            return false;
        }
        this.usedExpected.add(canonical);
        this.bindings.set(canonical, candidate.identity);
        this.boundObserved.add(candidate.identity);
        this.coverObservedAliasClosure(candidate.identity);
        this.markAliasDeclarations(reference.declaration.key);
        return true;
    }
    observedAliasClosure(identity) {
        const closure = new Set();
        let current = identity;
        while (current && !closure.has(current)) {
            closure.add(current);
            const declaration = this.context.observedDeclarations.get(current);
            const value = declaration?.facets?.type.valueType ?? declaration?.valueType;
            current =
                value?.kind === 'reference' && value.arguments.length === 0 ? value.identity : undefined;
        }
        return closure;
    }
    coverObservedAliasClosure(identity) {
        for (const current of this.observedAliasClosure(identity))
            this.boundObserved.add(current);
    }
    /** Expand a named type only while comparing it to an explicitly structural contract. */
    transparentObservedType(observed) {
        if (observed.kind !== 'reference')
            return undefined;
        if (observed.name === 'Readonly' &&
            observed.identity === 'platform:typescript#Readonly' &&
            observed.arguments.length === 1) {
            return observed.arguments[0];
        }
        const declaration = this.context.observedDeclarations.get(observed.identity);
        if (!declaration)
            return undefined;
        const authored = declaration.facets?.type.authoredValueType ?? declaration.authoredValueType;
        let expanded = authored;
        if (!expanded && declaration.callable) {
            expanded = {
                kind: 'function',
                callable: declaration.callable,
                ...(declaration.overloads ? { overloads: declaration.overloads } : {}),
            };
        }
        if (!expanded)
            expanded = declaration.facets?.type.valueType ?? declaration.valueType;
        if (!expanded && declaration.kind === 'interface' && !declaration.extends?.length) {
            const members = [...(declaration.properties ?? []), ...(declaration.callables ?? [])].map((member) => ({
                name: member.name,
                key: member.key,
                optional: member.optional,
                readonly: member.readonly,
                ...(member.type
                    ? { type: member.type }
                    : member.callable
                        ? {
                            type: {
                                kind: 'function',
                                callable: member.callable,
                                ...(member.overloads ? { overloads: member.overloads } : {}),
                            },
                        }
                        : {}),
                location: member.location,
            }));
            expanded = { kind: 'object', members };
        }
        if (!expanded)
            return undefined;
        const parameters = declaration.typeParameters ?? [];
        if (!parameters.length)
            return observed.arguments.length ? undefined : reduceTransparentObservedType(expanded);
        const arguments_ = this.effectiveTypeArguments(observed, declaration, parameters.length);
        if (arguments_.length !== parameters.length)
            return undefined;
        const scope = parameters[0]?.scope;
        if (!scope || parameters.some((parameter) => parameter.scope !== scope))
            return undefined;
        return reduceTransparentObservedType(substituteTypeParameters(expanded, scope, arguments_));
    }
    /** Resolve a property indexed access only when both owner and key are exact. */
    resolveObservedIndexedAccess(indexed) {
        if (indexed.index.kind !== 'literal' || typeof indexed.index.value !== 'string')
            return undefined;
        const key = indexed.index.value;
        let object = indexed.object;
        const active = new Set();
        while (object.kind === 'reference' && !active.has(object.identity)) {
            active.add(object.identity);
            const declaration = this.context.observedDeclarations.get(object.identity);
            if (!declaration)
                return undefined;
            this.coverIdentityClosure(object.identity);
            const member = [...(declaration.properties ?? []), ...(declaration.fields ?? [])].find((candidate) => candidate.key === 'named' && candidate.name === key);
            const direct = memberType(member);
            if (direct)
                return direct;
            const expanded = this.transparentObservedType(object);
            if (!expanded)
                return undefined;
            object = expanded;
        }
        if (object.kind !== 'object')
            return undefined;
        const member = object.members.find((candidate) => candidate.key === 'named' && candidate.name === key);
        return memberType(member);
    }
    /** A module-local type alias may transparently preserve an external type's exact authority. */
    isLocalAliasReference(observed) {
        if (observed.kind !== 'reference')
            return false;
        const declaration = this.context.observedDeclarations.get(observed.identity);
        return Boolean(declaration &&
            this.context.observedDeclarationOwners.get(observed.identity) === this.observed.id &&
            (declaration.valueType || declaration.facets?.type.valueType));
    }
    failDeclarationChildren(declaration, actual, message) {
        for (const obligation of this.expected.obligations) {
            if (obligation.id === declarationPrefix(declaration))
                continue;
            if (!obligation.id.startsWith(`${declarationPrefix(declaration)}.`))
                continue;
            this.set(obligation.id, 'fail', {
                code: 'MODULE_DECLARATION_UNAVAILABLE',
                message,
                location: expectedLocation(this.expected, obligation.pointer),
                related: actual ? [actual] : undefined,
            });
        }
    }
}
//# sourceMappingURL=evaluator.js.map