import { expectedLocation } from '../contract/model.js';
export function canonicalTypeProviderCoordinate(coordinate) {
    if (!coordinate.startsWith('package:@types/'))
        return coordinate;
    const parts = coordinate.slice('package:@types/'.length).split('/');
    const provider = parts.shift();
    if (!provider)
        return coordinate;
    const separator = provider.indexOf('__');
    const packageName = separator < 0 ? provider : `@${provider.slice(0, separator)}/${provider.slice(separator + 2)}`;
    return `package:${packageName}${parts.length ? `/${parts.join('/')}` : ''}`;
}
export function isTestArtifact(file) {
    const path = file.replaceAll('\\', '/');
    const segments = path.split('/');
    return (segments.includes('tests') ||
        segments.includes('__tests__') ||
        /(?:^|\/)[^/]+\.(?:test|spec|bench|perf)\.[cm]?[jt]sx?$/.test(path));
}
export function unevaluatedRule(obligation, module) {
    return {
        id: obligation.id,
        status: 'error',
        diagnostics: [
            {
                code: 'MODULE_OBLIGATION_UNEVALUATED',
                message: obligation.label,
                location: expectedLocation(module, obligation.pointer),
            },
        ],
    };
}
export function declarationPrefix(declaration) {
    return `module.${declaration.identity.kind}.${safeId(declaration.identity.key)}`;
}
export function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
export function matchesExternalType(expected, observed) {
    const coordinates = [observed.packageCoordinate, observed.location.external]
        .filter((coordinate) => coordinate !== undefined)
        .map(canonicalTypeProviderCoordinate);
    return (observed.name === expected.name &&
        coordinates.some((coordinate) => coordinate === expected.target || coordinate.startsWith(`${expected.target}/`)));
}
export function matchesExternalIdentity(expected, observed) {
    return (expected.target.startsWith('platform:') &&
        observed.name === expected.name &&
        observed.identity === `${expected.target}#${expected.name}`);
}
export function externalAliasMatches(expected, observed) {
    return (expected.expression.kind === 'external' && matchesExternalType(expected.expression, observed));
}
export function expectedDeclarationAliasesObserved(expected, observed) {
    return Boolean(expected.valueType && externalAliasMatches(expected.valueType, observed));
}
export function heritageProof(expected) {
    const expression = expected.expression;
    return expression.kind === 'declaration'
        ? safeId(expression.declaration.key)
        : expression.kind === 'external'
            ? safeId(`${expression.target}#${expression.name}`)
            : safeId(JSON.stringify(expression));
}
export function expectedTypeName(expected) {
    const expression = expected.expression;
    return expression.kind === 'declaration'
        ? expression.declaration.name
        : expression.kind === 'external'
            ? expression.name
            : JSON.stringify(expression);
}
export function withoutUndefined(type) {
    if (type.kind !== 'union')
        return type;
    const remaining = type.types.filter((item) => item.kind !== 'undefined');
    return remaining.length === 1 ? remaining[0] : { kind: 'union', types: remaining };
}
export function memberType(member) {
    if (!member)
        return undefined;
    if (member.type)
        return member.type;
    return member.callable
        ? {
            kind: 'function',
            callable: member.callable,
            ...(member.overloads ? { overloads: member.overloads } : {}),
        }
        : undefined;
}
export function expectedReadonlyShape(type) {
    return (type.target === 'platform:typescript' && type.name === 'Readonly' && type.arguments.length === 1);
}
export function structuralExpectedMembers(type) {
    let current = type;
    while (current?.kind === 'external' && expectedReadonlyShape(current)) {
        current = current.arguments[0];
    }
    return current?.kind === 'object' ? current.members : undefined;
}
export function expectedBooleanUnion(type) {
    if (type.kind !== 'union' || type.types.length !== 2)
        return false;
    const values = type.types.flatMap((item) => item.kind === 'literal' && typeof item.value === 'boolean' ? [item.value] : []);
    return values.length === 2 && values.includes(false) && values.includes(true);
}
export function flattenExpectedTypeSet(kind, values) {
    const flattened = values.flatMap((value) => value.kind === kind ? flattenExpectedTypeSet(kind, value.types) : [value]);
    return flattened.filter((value) => !expectedLiteralIsSubsumed(value, flattened));
}
export function expectedLiteralIsSubsumed(value, values) {
    if (value.kind !== 'literal')
        return false;
    const data = typeof value.value === 'string'
        ? 'string'
        : typeof value.value === 'number'
            ? 'number'
            : 'boolean';
    return values.some((candidate) => candidate.kind === 'data' && candidate.data === data);
}
export function expectedContainsBooleanLiterals(values) {
    if (values.some((value) => value.kind === 'data' && value.data === 'boolean'))
        return false;
    let hasFalse = false;
    let hasTrue = false;
    for (const value of values) {
        if (value.kind !== 'literal' || typeof value.value !== 'boolean')
            continue;
        if (value.value)
            hasTrue = true;
        else
            hasFalse = true;
    }
    return hasFalse && hasTrue;
}
export function removeSubsumedObservedLiterals(values) {
    return values.filter((value) => {
        if (value.kind !== 'literal')
            return true;
        const primitive = typeof value.value === 'string'
            ? 'string'
            : typeof value.value === 'number'
                ? 'number'
                : 'boolean';
        return !values.some((candidate) => candidate.kind === 'primitive' && candidate.name === primitive);
    });
}
export function collapseObservedUnion(expected, values) {
    if (values.length === 1)
        return values[0];
    if (expected.kind === 'data' &&
        expected.data === 'boolean' &&
        values.length === 2 &&
        values.every((value) => value.kind === 'literal' && typeof value.value === 'boolean') &&
        values.some((value) => value.kind === 'literal' && value.value === false) &&
        values.some((value) => value.kind === 'literal' && value.value === true)) {
        return { kind: 'primitive', name: 'boolean' };
    }
    return undefined;
}
export function expectedTypeParameterKey(scope, index) {
    return `${scope}:${index}`;
}
export function substituteExpectedTypeParameters(type, bindings) {
    switch (type.kind) {
        case 'parameter':
            return bindings.get(expectedTypeParameterKey(type.scope, type.index)) ?? type;
        case 'declaration':
        case 'external':
            return {
                ...type,
                arguments: type.arguments.map((argument) => substituteExpectedTypeParameters(argument, bindings)),
            };
        case 'template':
            return {
                ...type,
                types: type.types.map((item) => substituteExpectedTypeParameters(item, bindings)),
            };
        case 'array':
            return { ...type, element: substituteExpectedTypeParameters(type.element, bindings) };
        case 'record':
            return {
                ...type,
                key: substituteExpectedTypeParameters(type.key, bindings),
                value: substituteExpectedTypeParameters(type.value, bindings),
            };
        case 'tuple':
            return {
                ...type,
                elements: type.elements.map((item) => substituteExpectedTypeParameters(item, bindings)),
            };
        case 'union':
        case 'intersection':
            return {
                ...type,
                types: type.types.map((item) => substituteExpectedTypeParameters(item, bindings)),
            };
        case 'conditional':
            return {
                ...type,
                check: substituteExpectedTypeParameters(type.check, bindings),
                extends: substituteExpectedTypeParameters(type.extends, bindings),
                trueType: substituteExpectedTypeParameters(type.trueType, bindings),
                falseType: substituteExpectedTypeParameters(type.falseType, bindings),
            };
        case 'keyof':
            return { ...type, type: substituteExpectedTypeParameters(type.type, bindings) };
        case 'indexed-access':
            return {
                ...type,
                object: substituteExpectedTypeParameters(type.object, bindings),
                index: substituteExpectedTypeParameters(type.index, bindings),
            };
        case 'object':
            return {
                ...type,
                members: type.members.map((member) => ({
                    ...member,
                    expression: substituteExpectedTypeParameters(member.expression, bindings),
                })),
            };
        case 'function':
        case 'constructor':
            return {
                ...type,
                callable: substituteExpectedCallableTypeParameters(type.callable, bindings),
                ...(type.overloads
                    ? {
                        overloads: type.overloads.map((callable) => substituteExpectedCallableTypeParameters(callable, bindings)),
                    }
                    : {}),
            };
        default:
            return type;
    }
}
export function substituteExpectedCallableTypeParameters(callable, bindings) {
    return {
        ...callable,
        ...(callable.typeParameters
            ? {
                typeParameters: callable.typeParameters.map((parameter) => ({
                    ...parameter,
                    ...(parameter.constraint
                        ? {
                            constraint: {
                                ...parameter.constraint,
                                expression: substituteExpectedTypeParameters(parameter.constraint.expression, bindings),
                            },
                        }
                        : {}),
                    ...(parameter.default
                        ? {
                            default: {
                                ...parameter.default,
                                expression: substituteExpectedTypeParameters(parameter.default.expression, bindings),
                            },
                        }
                        : {}),
                })),
            }
            : {}),
        parameters: callable.parameters.map((parameter) => ({
            ...parameter,
            expression: substituteExpectedTypeParameters(parameter.expression, bindings),
        })),
        returns: {
            ...callable.returns,
            expression: substituteExpectedTypeParameters(callable.returns.expression, bindings),
        },
    };
}
export function substituteTypeParameters(type, scope, arguments_) {
    switch (type.kind) {
        case 'parameter':
            return type.scope === scope ? (arguments_[type.index] ?? type) : type;
        case 'reference':
            return {
                ...type,
                arguments: type.arguments.map((argument) => substituteTypeParameters(argument, scope, arguments_)),
            };
        case 'template':
            return {
                ...type,
                types: type.types.map((item) => substituteTypeParameters(item, scope, arguments_)),
            };
        case 'array':
            return { ...type, element: substituteTypeParameters(type.element, scope, arguments_) };
        case 'record':
            return {
                ...type,
                key: substituteTypeParameters(type.key, scope, arguments_),
                value: substituteTypeParameters(type.value, scope, arguments_),
            };
        case 'tuple':
            return {
                ...type,
                elements: type.elements.map((item) => substituteTypeParameters(item, scope, arguments_)),
            };
        case 'union':
        case 'intersection':
            return {
                ...type,
                types: type.types.map((item) => substituteTypeParameters(item, scope, arguments_)),
            };
        case 'conditional':
            return {
                ...type,
                check: substituteTypeParameters(type.check, scope, arguments_),
                extends: substituteTypeParameters(type.extends, scope, arguments_),
                trueType: substituteTypeParameters(type.trueType, scope, arguments_),
                falseType: substituteTypeParameters(type.falseType, scope, arguments_),
            };
        case 'keyof':
            return { ...type, type: substituteTypeParameters(type.type, scope, arguments_) };
        case 'indexed-access':
            return {
                ...type,
                object: substituteTypeParameters(type.object, scope, arguments_),
                index: substituteTypeParameters(type.index, scope, arguments_),
            };
        case 'object':
            return {
                ...type,
                members: type.members.map((member) => ({
                    ...member,
                    ...(member.type
                        ? { type: substituteTypeParameters(member.type, scope, arguments_) }
                        : {}),
                    ...(member.callable
                        ? { callable: substituteCallableTypeParameters(member.callable, scope, arguments_) }
                        : {}),
                })),
            };
        case 'function':
        case 'constructor':
            return {
                ...type,
                callable: substituteCallableTypeParameters(type.callable, scope, arguments_),
                ...(type.overloads
                    ? {
                        overloads: type.overloads.map((callable) => substituteCallableTypeParameters(callable, scope, arguments_)),
                    }
                    : {}),
            };
        default:
            return type;
    }
}
/** Reduce only conditional outcomes established by intrinsic checker semantics. */
export function reduceTransparentObservedType(type) {
    let current = type;
    const active = new Set();
    while (current.kind === 'conditional' && !active.has(current)) {
        active.add(current);
        if (current.check.kind === 'never')
            return { kind: 'never' };
        if (current.extends.kind === 'unknown') {
            current = current.trueType;
            continue;
        }
        if (sameObservedType(current.check, current.extends)) {
            current = current.trueType;
            continue;
        }
        if (current.check.kind === 'literal' &&
            current.extends.kind === 'primitive' &&
            typeof current.check.value === current.extends.name) {
            current = current.trueType;
            continue;
        }
        break;
    }
    return current;
}
export function substituteCallableTypeParameters(callable, scope, arguments_) {
    return {
        ...callable,
        parameters: callable.parameters.map((parameter) => ({
            ...parameter,
            type: substituteTypeParameters(parameter.type, scope, arguments_),
        })),
        returns: substituteTypeParameters(callable.returns, scope, arguments_),
    };
}
export function sameObservedType(left, right, scopes = new Map()) {
    if (left.kind !== right.kind)
        return false;
    switch (left.kind) {
        case 'primitive':
            return right.kind === 'primitive' && left.name === right.name;
        case 'reference':
            return (right.kind === 'reference' &&
                left.identity === right.identity &&
                sameObservedTypes(left.arguments, right.arguments, scopes));
        case 'parameter':
            return (right.kind === 'parameter' &&
                (scopes.get(left.scope) ?? left.scope) === right.scope &&
                left.index === right.index);
        case 'literal':
            return right.kind === 'literal' && left.value === right.value;
        case 'template':
            return (right.kind === 'template' &&
                sameStrings(left.texts, right.texts) &&
                sameObservedTypes(left.types, right.types, scopes));
        case 'array':
            return (right.kind === 'array' &&
                left.readonly === right.readonly &&
                sameObservedType(left.element, right.element, scopes));
        case 'record':
            return (right.kind === 'record' &&
                sameObservedType(left.key, right.key, scopes) &&
                sameObservedType(left.value, right.value, scopes));
        case 'tuple':
            return (right.kind === 'tuple' &&
                left.readonly === right.readonly &&
                sameObservedTypes(left.elements, right.elements, scopes));
        case 'union':
        case 'intersection':
            return right.kind === left.kind && sameObservedTypeSet(left.types, right.types, scopes);
        case 'conditional':
            return (right.kind === 'conditional' &&
                sameObservedType(left.check, right.check, scopes) &&
                sameObservedType(left.extends, right.extends, scopes) &&
                sameObservedType(left.trueType, right.trueType, scopes) &&
                sameObservedType(left.falseType, right.falseType, scopes));
        case 'keyof':
            return right.kind === 'keyof' && sameObservedType(left.type, right.type, scopes);
        case 'indexed-access':
            return (right.kind === 'indexed-access' &&
                sameObservedType(left.object, right.object, scopes) &&
                sameObservedType(left.index, right.index, scopes));
        case 'object':
            return right.kind === 'object' && sameObservedMembers(left.members, right.members, scopes);
        case 'function':
        case 'constructor':
            return (right.kind === left.kind &&
                sameObservedCallable(left.callable, right.callable, scopes) &&
                sameObservedCallables(left.overloads, right.overloads, scopes));
        case 'unsupported':
            return (right.kind === 'unsupported' &&
                left.reason === right.reason &&
                left.display === right.display);
        default:
            return true;
    }
}
export function sameObservedTypes(left, right, scopes) {
    return (left.length === right.length &&
        left.every((item, index) => sameObservedType(item, right[index], scopes)));
}
export function sameObservedTypeSet(left, right, scopes) {
    if (left.length !== right.length)
        return false;
    const used = new Set();
    return left.every((item) => {
        const index = right.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && sameObservedType(item, candidate, scopes));
        if (index < 0)
            return false;
        used.add(index);
        return true;
    });
}
export function sameObservedMembers(left, right, scopes) {
    if (left.length !== right.length)
        return false;
    const used = new Set();
    return left.every((member) => {
        const type = memberType(member);
        if (!type)
            return false;
        const index = right.findIndex((candidate, candidateIndex) => {
            if (used.has(candidateIndex))
                return false;
            const candidateType = memberType(candidate);
            return Boolean(candidateType &&
                member.key === candidate.key &&
                (member.key === 'unique-symbol' || member.name === candidate.name) &&
                member.optional === candidate.optional &&
                member.readonly === candidate.readonly &&
                sameObservedType(type, candidateType, scopes));
        });
        if (index < 0)
            return false;
        used.add(index);
        return true;
    });
}
export function sameObservedCallable(left, right, parentScopes) {
    const leftParameters = left.typeParameters ?? [];
    const rightParameters = right.typeParameters ?? [];
    if (left.mode !== right.mode ||
        leftParameters.length !== rightParameters.length ||
        left.parameters.length !== right.parameters.length)
        return false;
    const scopes = new Map(parentScopes);
    for (const [index, parameter] of leftParameters.entries()) {
        const target = rightParameters[index];
        const previous = scopes.get(parameter.scope);
        if (previous !== undefined && previous !== target.scope)
            return false;
        scopes.set(parameter.scope, target.scope);
    }
    if (!leftParameters.every((parameter, index) => {
        const target = rightParameters[index];
        return (parameter.index === target.index &&
            parameter.variance === target.variance &&
            Boolean(parameter.const) === Boolean(target.const) &&
            Boolean(parameter.constraint) === Boolean(target.constraint) &&
            Boolean(parameter.default) === Boolean(target.default) &&
            (!parameter.constraint ||
                !target.constraint ||
                sameObservedType(parameter.constraint, target.constraint, scopes)) &&
            (!parameter.default ||
                !target.default ||
                sameObservedType(parameter.default, target.default, scopes)));
    }))
        return false;
    return (left.parameters.every((parameter, index) => {
        const target = right.parameters[index];
        return (parameter.index === target.index &&
            parameter.optional === target.optional &&
            parameter.rest === target.rest &&
            sameObservedType(parameter.type, target.type, scopes));
    }) && sameObservedType(left.returns, right.returns, scopes));
}
export function sameObservedCallables(left, right, scopes) {
    if (!left && !right)
        return true;
    if (!left || !right || left.length !== right.length)
        return false;
    return left.every((callable, index) => sameObservedCallable(callable, right[index], scopes));
}
export function intrinsicTypeCompatible(expected, observed) {
    return expected === observed || (expected === 'void' && observed === 'undefined');
}
export function dataTypeCompatible(expected, observed) {
    const expectedName = expected === 'decimal' ? 'number' : expected;
    if (observed.kind === 'primitive' && observed.name === expectedName)
        return true;
    return Boolean(expected === 'bytes' &&
        observed.kind === 'reference' &&
        observed.identity.startsWith('platform:typescript#') &&
        (observed.name === 'Uint8Array' || observed.name === 'ArrayBuffer'));
}
export function packagePatternMatches(pattern, packageName) {
    return pattern.endsWith('*') && packageName.startsWith(pattern.slice(0, -1));
}
/** Return at most `limit` complete bipartite assignments for one unordered type set. */
export function typeSetAssignments(candidates, limit) {
    const output = [];
    const assignment = Array(candidates.length).fill(-1);
    const used = new Set();
    const visit = () => {
        if (output.length >= limit)
            return;
        let selected = -1;
        let available;
        for (let index = 0; index < candidates.length; index++) {
            if (assignment[index] !== -1)
                continue;
            const current = candidates[index].filter((candidate) => !used.has(candidate));
            if (!current.length)
                return;
            if (!available || current.length < available.length) {
                selected = index;
                available = current;
            }
        }
        if (selected === -1) {
            output.push([...assignment]);
            return;
        }
        for (const candidate of available) {
            assignment[selected] = candidate;
            used.add(candidate);
            visit();
            used.delete(candidate);
            assignment[selected] = -1;
            if (output.length >= limit)
                return;
        }
    };
    visit();
    return output;
}
export function witnessSkeletonCompatible(expected, observed) {
    if (expected.kind !== observed.kind)
        return false;
    if (expected.kind !== 'function' || observed.kind !== 'function')
        return true;
    if (expected.callable.mode !== observed.callable.mode)
        return false;
    if (expected.callable.parameters.length !== observed.callable.parameters.length)
        return false;
    return expected.callable.parameters.every((parameter, index) => {
        const actual = observed.callable.parameters[index];
        return parameter.optional === actual.optional && Boolean(parameter.rest) === actual.rest;
    });
}
export function mergeRule(rule, status, diagnostic) {
    if (priority(status) < priority(rule.status))
        rule.status = status;
    if (diagnostic && !rule.diagnostics.some((item) => sameDiagnostic(item, diagnostic))) {
        rule.diagnostics.push(diagnostic);
    }
}
export function sameDiagnostic(left, right) {
    return (left.code === right.code &&
        left.message === right.message &&
        left.location?.file === right.location?.file &&
        left.location?.external === right.location?.external &&
        left.location?.pointer === right.location?.pointer);
}
export function priority(status) {
    return { error: 0, fail: 1, idle: 2, pass: 3 }[status];
}
export function safeId(value) {
    return encodeURIComponent(value).replaceAll('.', '%2E');
}
export function expectedDeclarationReferences(declaration) {
    const references = [];
    const visitType = (type) => {
        if (type)
            visitExpression(type.expression);
    };
    const visitTypeParameters = (parameters) => {
        for (const parameter of parameters ?? []) {
            visitType(parameter.constraint);
            visitType(parameter.default);
        }
    };
    const visitCallable = (callable) => {
        visitTypeParameters(callable.typeParameters);
        for (const parameter of callable.parameters)
            visitType(parameter);
        visitType(callable.returns);
    };
    const visitExpression = (expression) => {
        switch (expression.kind) {
            case 'declaration':
                references.push(expression.declaration);
                for (const argument of expression.arguments)
                    visitExpression(argument);
                return;
            case 'external':
                for (const argument of expression.arguments)
                    visitExpression(argument);
                return;
            case 'template':
                for (const type of expression.types)
                    visitExpression(type);
                return;
            case 'array':
                visitExpression(expression.element);
                return;
            case 'record':
                visitExpression(expression.key);
                visitExpression(expression.value);
                return;
            case 'tuple':
                for (const element of expression.elements)
                    visitExpression(element);
                return;
            case 'union':
            case 'intersection':
                for (const type of expression.types)
                    visitExpression(type);
                return;
            case 'conditional':
                visitExpression(expression.check);
                visitExpression(expression.extends);
                visitExpression(expression.trueType);
                visitExpression(expression.falseType);
                return;
            case 'keyof':
                visitExpression(expression.type);
                return;
            case 'indexed-access':
                visitExpression(expression.object);
                visitExpression(expression.index);
                return;
            case 'object':
                for (const member of expression.members)
                    visitType(member);
                return;
            case 'function':
            case 'constructor':
                visitCallable(expression.callable);
                for (const overload of expression.overloads ?? [])
                    visitCallable(overload);
                return;
            default:
                return;
        }
    };
    if (declaration.alias)
        references.push(declaration.alias);
    visitTypeParameters(declaration.typeParameters);
    visitType(declaration.valueType);
    for (const member of declaration.fields ?? [])
        visitType(member);
    for (const member of declaration.properties ?? [])
        visitType(member);
    for (const member of declaration.callables ?? [])
        references.push(member.callable);
    for (const member of declaration.statics ?? [])
        references.push(member.callable);
    for (const type of declaration.extends ?? [])
        visitType(type);
    for (const type of declaration.implements ?? [])
        visitType(type);
    for (const parameter of declaration.parameters ?? [])
        visitType(parameter);
    visitType(declaration.returns ?? undefined);
    for (const overload of declaration.overloads ?? [])
        visitCallable(overload);
    if (declaration.facets?.type.valueType)
        visitType(declaration.facets.type.valueType);
    if (declaration.facets?.value.kind === 'callable') {
        references.push(declaration.facets.value.callable);
    }
    else if (declaration.facets?.value.kind === 'value') {
        visitType(declaration.facets.value.valueType);
    }
    return references;
}
//# sourceMappingURL=semantics.js.map