import { declarationKey, MODULE_CONTRACT_ID } from './model.js';
import { compileObligations } from './obligations.js';
/** Compile a portable proof-obligation contract from one self-contained normative snapshot. */
export function compileModuleContract(snapshot) {
    const api = snapshot.module.api;
    if (!api?.model) {
        return { diagnostics: [] };
    }
    const module = {
        id: snapshot.module.id,
        name: snapshot.module.name,
        declarationPointer: snapshot.module.declarationPointer,
        source: snapshot.source,
        packages: snapshot.module.packageAuthority.packages,
        packagePatterns: snapshot.module.packageAuthority.packagePatterns,
        api: { ...api, model: api.model },
    };
    const index = indexSnapshotApi(module);
    const diagnostics = [];
    const identities = new Map();
    for (const declaration of module.api.model.surface.declarations) {
        const owner = index.owner.get(declaration.identity);
        if (owner)
            identities.set(declaration.identity, identityOf(owner.module, declaration));
    }
    const local = module.api.model.surface.declarations.filter((declaration) => index.owner.get(declaration.identity)?.module.id === module.id);
    const compiler = new ApiModuleCompiler(module, index, identities, diagnostics);
    const compilation = compiler.compile(local);
    if (!compilation.module || diagnostics.length)
        return compilation;
    const references = [...index.owner.values()]
        .filter((owner) => owner.module.id !== module.id)
        .sort((left, right) => left.declaration.identity.localeCompare(right.declaration.identity))
        .flatMap((owner) => {
        const referenceCompiler = new ApiModuleCompiler(owner.module, index, identities, diagnostics);
        const declaration = referenceCompiler.declaration(owner.declaration);
        return [declaration, ...referenceCompiler.pending];
    });
    return diagnostics.length
        ? { diagnostics }
        : {
            ...compilation,
            references: deduplicateDeclarations(references),
        };
}
class ApiModuleCompiler {
    module;
    index;
    identities;
    diagnostics;
    imports = new Map();
    externalExports = new Map();
    pending = [];
    locations = {};
    constructor(module, index, identities, diagnostics) {
        this.module = module;
        this.index = index;
        this.identities = identities;
        this.diagnostics = diagnostics;
    }
    compile(local) {
        const declarations = local.map((declaration) => this.declaration(declaration));
        const exports = this.exports();
        declarations.push(...this.pending);
        const packages = this.module.packages.map((resource, index) => ({
            name: resource.package,
            pointer: `${this.module.declarationPointer}/packageAuthority/packages/${index}`,
            requireObserved: false,
        }));
        const packagePatterns = this.module.packagePatterns.map((resource, index) => ({
            pattern: resource.pattern,
            pointer: `${this.module.declarationPointer}/packageAuthority/packagePatterns/${index}`,
        }));
        if (this.diagnostics.length)
            return { diagnostics: this.diagnostics };
        const declarationMap = new Map(declarations.map((declaration) => [declaration.identity.key, declaration]));
        const name = this.module.name;
        const expected = {
            contract: MODULE_CONTRACT_ID,
            id: this.module.id,
            source: this.module.source,
            name,
            declarations: declarations.sort((left, right) => left.identity.key.localeCompare(right.identity.key)),
            exports,
            imports: [...this.imports.values()].sort((left, right) => left.key.localeCompare(right.key)),
            packages,
            packagePatterns,
            obligations: compileObligations(name, `${this.module.declarationPointer}/api`, declarationMap, exports, [...this.imports.values()], packages),
            locations: this.locations,
        };
        return { module: expected, diagnostics: [] };
    }
    declaration(observed) {
        const identity = this.identities.get(observed.identity);
        const pointer = identity.pointer;
        this.record(pointer, observed.location);
        const metadata = this.module.api.model?.metadata[observed.identity];
        const typeFacetMetadata = this.module.api.model?.metadata[`${observed.identity}#facet:type`];
        const valueFacetMetadata = this.module.api.model?.metadata[`${observed.identity}#facet:value`];
        const factoryConformance = typeFacetMetadata?.conformance === 'identity' &&
            valueFacetMetadata?.conformance === 'identity'
            ? 'identity'
            : 'exact';
        const common = {
            identity,
            pointer,
            conformance: observed.kind === 'factory'
                ? factoryConformance
                : (metadata?.conformance ?? 'exact'),
        };
        if (common.conformance === 'identity' && observed.kind !== 'factory')
            return common;
        const typeParameters = observed.typeParameters?.length && typeFacetMetadata?.conformance !== 'identity'
            ? { typeParameters: this.typeParameters(observed.typeParameters, pointer) }
            : {};
        if (observed.kind === 'factory' && observed.facets) {
            const valueFacet = observed.facets.value;
            return {
                ...common,
                ...typeParameters,
                facets: {
                    type: {
                        pointer: `${pointer}/facet/type`,
                        conformance: typeFacetMetadata?.conformance ?? metadata?.conformance ?? 'exact',
                        ...typeParameters,
                        valueType: this.expectedType(observed.facets.type.authoredValueType ?? observed.facets.type.valueType, `${pointer}/facet/type/value`),
                    },
                    value: valueFacet.kind === 'callable'
                        ? {
                            kind: 'callable',
                            pointer: `${pointer}/facet/value`,
                            conformance: valueFacetMetadata?.conformance ?? metadata?.conformance ?? 'exact',
                            callable: identity,
                        }
                        : {
                            kind: 'value',
                            pointer: `${pointer}/facet/value`,
                            conformance: valueFacetMetadata?.conformance ?? metadata?.conformance ?? 'exact',
                            valueType: this.expectedType(valueFacet.valueType, `${pointer}/facet/value/type`),
                        },
                },
                ...(valueFacet.kind === 'callable'
                    ? this.callableFields(valueFacet.callable, valueFacet.overloads, pointer)
                    : {}),
                ...(metadata?.errors.length ? { errors: metadata.errors } : {}),
            };
        }
        if (observed.kind === 'callable') {
            return {
                ...common,
                ...typeParameters,
                ...(observed.callable
                    ? this.callableFields(observed.callable, observed.overloads, pointer, false)
                    : {}),
                ...(metadata?.errors.length ? { errors: metadata.errors } : {}),
            };
        }
        if (observed.kind === 'interface' || observed.kind === 'class') {
            return {
                ...common,
                ...typeParameters,
                ...(observed.callable
                    ? this.callableFields(observed.callable, observed.overloads, pointer, true)
                    : {}),
                properties: (observed.properties ?? []).flatMap((member) => member.type ? [this.member(member, pointer)] : []),
                callables: (observed.callables ?? []).flatMap((member) => member.callable ? [this.callableMember(member, pointer, observed.identity)] : []),
                ...(observed.kind === 'class'
                    ? {
                        statics: (observed.statics ?? []).flatMap((member) => member.callable
                            ? [this.callableMember(member, `${pointer}/static`, observed.identity)]
                            : []),
                    }
                    : {}),
                extends: (observed.extends ?? []).map((identity, index) => this.referenceType(identity, `${pointer}/extends/${index}`)),
                implements: (observed.implements ?? []).map((identity, index) => this.referenceType(identity, `${pointer}/implements/${index}`)),
            };
        }
        const alias = metadata?.form === 'type-alias' &&
            observed.valueType?.kind === 'reference' &&
            observed.valueType.arguments.length === 0
            ? this.referenceIdentity(observed.valueType.identity)
            : undefined;
        return {
            ...common,
            ...typeParameters,
            ...(alias ? { alias } : {}),
            ...(observed.valueType && !alias
                ? { valueType: this.expectedType(observed.valueType, `${pointer}/type`) }
                : {}),
            fields: (observed.fields ?? []).flatMap((member) => member.type ? [this.member(member, pointer)] : []),
            callables: (observed.callables ?? []).flatMap((member) => member.callable ? [this.callableMember(member, pointer, observed.identity)] : []),
        };
    }
    exports() {
        const exports = [];
        for (const item of this.module.api.model.surface.exports) {
            // A public facade may re-export declarations canonically owned by a sibling
            // module in the same cohesive specification. Preserve that ownership instead
            // of silently dropping the facade export from its contract.
            const referenced = this.referenceIdentity(item.declaration);
            const external = referenced ? undefined : this.externalExport(item);
            const identity = referenced ?? external?.identity;
            if (!identity)
                continue;
            exports.push({
                path: item.path,
                name: item.name,
                typeOnly: item.typeOnly,
                declaration: identity,
                ...(external ? { sourceModule: external.sourceModule } : {}),
                pointer: identity.pointer,
            });
        }
        return exports.sort((left, right) => left.path.join('.').localeCompare(right.path.join('.')));
    }
    externalExport(item) {
        if (!item.sourceModule?.startsWith('package:'))
            return;
        const declaration = this.index.declaration.get(item.declaration);
        if (!declaration)
            return;
        const kind = declarationKind(declaration);
        const key = `${item.sourceModule}\0${declaration.name}\0${kind}`;
        let identity = this.externalExports.get(key);
        if (!identity) {
            const pointer = `${this.module.declarationPointer}/api/external/${escapePointer(`${item.sourceModule}#${declaration.name}`)}`;
            identity = {
                key: declarationKey(this.module.id, pointer),
                source: this.module.id,
                pointer,
                kind,
                name: declaration.name,
            };
            this.externalExports.set(key, identity);
            this.pending.push({
                identity,
                pointer,
                conformance: 'identity',
                ...(declaration.kind === 'factory' ? { factory: true } : {}),
            });
            this.record(pointer, item.location);
        }
        return { identity, sourceModule: item.sourceModule };
    }
    member(member, ownerPointer) {
        const pointer = `${ownerPointer}/member/${escapePointer(member.name)}`;
        this.record(pointer, member.location);
        return {
            name: member.name,
            key: member.key,
            expression: this.type(member.type),
            optional: member.optional,
            readonly: member.readonly,
            pointer,
        };
    }
    typeParameters(parameters, ownerPointer) {
        return parameters.map((parameter) => {
            const pointer = `${ownerPointer}/typeParameter/${parameter.index}`;
            this.record(pointer, parameter.location);
            return {
                scope: parameter.scope,
                index: parameter.index,
                name: parameter.name,
                ...(parameter.variance ? { variance: parameter.variance } : {}),
                ...(parameter.const ? { const: true } : {}),
                ...(parameter.constraint
                    ? { constraint: this.expectedType(parameter.constraint, `${pointer}/constraint`) }
                    : {}),
                ...(parameter.default
                    ? { default: this.expectedType(parameter.default, `${pointer}/default`) }
                    : {}),
                pointer,
            };
        });
    }
    callableMember(member, ownerPointer, ownerIdentity) {
        const pointer = `${ownerPointer}/callable/${escapePointer(member.name)}`;
        this.record(pointer, member.location);
        const callable = member.callable;
        const identity = {
            key: declarationKey(this.module.id, pointer),
            source: this.module.id,
            pointer,
            kind: 'callable',
            name: member.name,
        };
        // Member callables are first-class expected declarations so their signatures and errors
        // receive the same proof obligations as exported functions.
        const metadata = this.module.api.model?.metadata[`${ownerIdentity}#${member.name}`];
        const declaration = {
            identity,
            pointer,
            conformance: 'exact',
            ...this.callableFields(callable, member.overloads, pointer),
            ...(metadata?.errors.length ? { errors: metadata.errors } : {}),
        };
        this.pending.push(declaration);
        return {
            name: member.name,
            callable: identity,
            optional: member.optional,
            pointer,
        };
    }
    parameters(callable, ownerPointer) {
        return callable.parameters.map((parameter) => {
            const pointer = `${ownerPointer}/parameter/${parameter.index}`;
            this.record(pointer, parameter.location);
            return {
                name: parameter.name,
                index: parameter.index,
                expression: this.type(parameter.type),
                optional: parameter.optional,
                rest: parameter.rest,
                pointer,
            };
        });
    }
    callableFields(callable, overloads, ownerPointer, separateTypeParameters = false) {
        if (overloads && overloads.length > 1) {
            return {
                overloads: overloads.map((signature, index) => this.callableType(signature, `${ownerPointer}/overload/${index}`)),
            };
        }
        const typeParameters = callable.typeParameters?.length
            ? this.typeParameters(callable.typeParameters, ownerPointer)
            : undefined;
        return {
            ...(typeParameters
                ? separateTypeParameters
                    ? { callableTypeParameters: typeParameters }
                    : { typeParameters }
                : {}),
            parameters: this.parameters(callable, ownerPointer),
            // The signature return is semantic authority. A declaration-level valueType
            // may be the whole callable alias (for example Component<Props>) and must
            // never be mistaken for the result produced by invoking that callable.
            returns: this.expectedType(callable.returns, `${ownerPointer}/return`),
            mode: callable.mode,
        };
    }
    callableType(callable, pointer) {
        this.record(pointer, callable.location);
        return {
            pointer,
            ...(callable.typeParameters?.length
                ? { typeParameters: this.typeParameters(callable.typeParameters, pointer) }
                : {}),
            parameters: this.parameters(callable, pointer),
            returns: this.expectedType(callable.returns, `${pointer}/return`),
            mode: callable.mode,
        };
    }
    expectedType(type, pointer) {
        return { expression: this.type(type), optional: false, pointer };
    }
    type(type) {
        switch (type.kind) {
            case 'primitive':
                return { kind: 'data', data: type.name };
            case 'reference': {
                const identity = this.referenceIdentity(type.identity);
                if (identity)
                    return {
                        kind: 'declaration',
                        declaration: identity,
                        arguments: type.arguments.map((argument) => this.type(argument)),
                    };
                const observed = this.index.declaration.get(type.identity);
                return {
                    kind: 'external',
                    target: externalReferenceTarget(observed, type.identity),
                    name: observed?.name ?? type.name,
                    arguments: type.arguments.map((argument) => this.type(argument)),
                };
            }
            case 'parameter':
                return { kind: 'parameter', scope: type.scope, index: type.index };
            case 'this':
                return { kind: 'this', owner: this.identities.get(type.owner)?.key ?? type.owner };
            case 'literal':
                return { kind: 'literal', value: type.value };
            case 'bigint-literal':
                return { kind: 'bigint-literal', value: type.value };
            case 'template':
                return {
                    kind: 'template',
                    texts: [...type.texts],
                    types: type.types.map((item) => this.type(item)),
                };
            case 'array':
                return { kind: 'array', element: this.type(type.element), readonly: type.readonly };
            case 'record':
                return { kind: 'record', key: this.type(type.key), value: this.type(type.value) };
            case 'tuple':
                return {
                    kind: 'tuple',
                    elements: type.elements.map((item) => this.type(item)),
                    readonly: type.readonly,
                };
            case 'union':
                return { kind: 'union', types: type.types.map((item) => this.type(item)) };
            case 'intersection':
                return { kind: 'intersection', types: type.types.map((item) => this.type(item)) };
            case 'conditional':
                return {
                    kind: 'conditional',
                    check: this.type(type.check),
                    extends: this.type(type.extends),
                    trueType: this.type(type.trueType),
                    falseType: this.type(type.falseType),
                };
            case 'keyof':
                return { kind: 'keyof', type: this.type(type.type) };
            case 'indexed-access':
                return {
                    kind: 'indexed-access',
                    object: this.type(type.object),
                    index: this.type(type.index),
                };
            case 'object':
                return {
                    kind: 'object',
                    members: type.members.flatMap((member) => {
                        const expression = member.type
                            ? this.type(member.type)
                            : member.callable
                                ? this.type({ kind: 'function', callable: member.callable })
                                : undefined;
                        return expression
                            ? [
                                {
                                    name: member.name,
                                    key: member.key,
                                    expression,
                                    optional: member.optional,
                                    readonly: member.readonly,
                                    pointer: '/api',
                                },
                            ]
                            : [];
                    }),
                };
            case 'function':
                return {
                    kind: 'function',
                    callable: {
                        ...(type.callable.typeParameters?.length
                            ? {
                                typeParameters: this.typeParameters(type.callable.typeParameters, '/api/function'),
                            }
                            : {}),
                        parameters: this.parameters(type.callable, '/api/function'),
                        returns: this.expectedType(type.callable.returns, '/api/function/return'),
                        mode: type.callable.mode,
                    },
                    ...(type.overloads && type.overloads.length > 1
                        ? {
                            overloads: type.overloads.map((callable, index) => this.callableType(callable, `/api/function/overload/${index}`)),
                        }
                        : {}),
                };
            case 'constructor':
                return {
                    kind: 'constructor',
                    callable: {
                        ...(type.callable.typeParameters?.length
                            ? {
                                typeParameters: this.typeParameters(type.callable.typeParameters, '/api/constructor'),
                            }
                            : {}),
                        parameters: this.parameters(type.callable, '/api/constructor'),
                        returns: this.expectedType(type.callable.returns, '/api/constructor/return'),
                        mode: type.callable.mode,
                    },
                    ...(type.overloads && type.overloads.length > 1
                        ? {
                            overloads: type.overloads.map((callable, index) => this.callableType(callable, `/api/constructor/overload/${index}`)),
                        }
                        : {}),
                };
            case 'unknown':
                return { kind: 'unknown' };
            case 'null':
            case 'undefined':
            case 'void':
            case 'never':
                return { kind: type.kind };
            case 'unsupported':
                this.report('API_TYPE_UNSUPPORTED', `Unsupported API type: ${type.display}`);
                return { kind: 'unknown' };
        }
    }
    referenceType(identity, pointer) {
        const declaration = this.referenceIdentity(identity);
        if (declaration)
            return {
                expression: { kind: 'declaration', declaration, arguments: [] },
                optional: false,
                pointer,
            };
        const observed = this.index.declaration.get(identity);
        return {
            expression: {
                kind: 'external',
                target: externalReferenceTarget(observed, identity),
                name: observed?.name ?? identity,
                arguments: [],
            },
            optional: false,
            pointer,
        };
    }
    referenceIdentity(identity) {
        const local = this.identities.get(identity);
        if (local) {
            if (local.source !== this.module.id)
                this.imports.set(local.key, local);
            return local;
        }
        const owner = this.index.owner.get(identity);
        if (!owner)
            return;
        if (owner.module.id !== this.module.id &&
            !this.index.exportsByModule.get(owner.module.id)?.has(identity)) {
            this.report('API_IMPORTED_DECLARATION_PRIVATE', `Imported declaration is not explicitly exported by ${owner.module.name}: ${owner.declaration.name}`);
            return;
        }
        const imported = identityOf(owner.module, owner.declaration);
        this.imports.set(imported.key, imported);
        return imported;
    }
    record(pointer, location) {
        if (!location.file)
            return;
        this.locations[pointer] = { file: location.file, line: location.line, column: location.column };
    }
    report(code, message) {
        this.diagnostics.push({
            code,
            message,
            file: this.module.api.source,
            line: 1,
            column: 1,
            pointer: `${this.module.declarationPointer}/api`,
        });
    }
}
function externalTypeTarget(coordinate) {
    const canonical = canonicalTypeProviderCoordinate(coordinate);
    if (/^package:typescript\/lib\/lib\.[^/]+\.d\.ts$/u.test(canonical)) {
        return 'platform:typescript';
    }
    if (!canonical.startsWith('package:'))
        return canonical;
    const parts = canonical.slice('package:'.length).split('/');
    const name = parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    return name ? `package:${name}` : canonical;
}
function externalReferenceTarget(declaration, identity) {
    const coordinate = declaration?.packageCoordinate ?? declaration?.location.external;
    if (coordinate)
        return externalTypeTarget(coordinate);
    if (identity.startsWith('platform:'))
        return identity.split('#')[0];
    return 'unowned';
}
function identityOf(module, declaration) {
    const pointer = `${module.declarationPointer}/api/declarations/${escapePointer(declaration.name)}@${declaration.location.line}`;
    return {
        key: declarationKey(module.id, pointer),
        source: module.id,
        pointer,
        kind: declarationKind(declaration),
        name: declaration.name,
    };
}
function indexSnapshotApi(module) {
    const declarations = module.api.model.surface.declarations;
    const declaration = new Map(declarations.map((item) => [item.identity, item]));
    const modules = new Map([[module.id, module]]);
    for (const item of declarations) {
        const source = declarationModuleId(item);
        if (!source || modules.has(source))
            continue;
        modules.set(source, {
            id: source,
            name: moduleName(source),
            declarationPointer: '',
            source,
            packages: [],
            packagePatterns: [],
            api: module.api,
        });
    }
    const owner = new Map();
    const exported = new Map();
    for (const item of declarations) {
        const source = declarationModuleId(item);
        const owned = source ? modules.get(source) : undefined;
        if (!owned)
            continue;
        owner.set(item.identity, { module: owned, declaration: item });
        const values = exported.get(owned.id);
        if (values)
            values.add(item.identity);
        else
            exported.set(owned.id, new Set([item.identity]));
    }
    exported.set(module.id, new Set(module.api.model.surface.exports.map((item) => item.declaration)));
    return { owner, declaration, exportsByModule: exported };
}
function declarationModuleId(declaration) {
    const file = declaration.location.file;
    if (!file)
        return;
    return /(?:^|\/)\.spec\/api\.d\.ts$/u.test(file) ? file : undefined;
}
function moduleName(source) {
    return source.replace(/(?:^|\/)\.spec\/api\.d\.ts$/u, '').replaceAll('/', '.');
}
function canonicalTypeProviderCoordinate(coordinate) {
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
function deduplicateDeclarations(declarations) {
    return [
        ...new Map(declarations.map((declaration) => [declaration.identity.key, declaration])).values(),
    ].sort((left, right) => left.identity.key.localeCompare(right.identity.key));
}
function declarationKind(declaration) {
    if (declaration.kind === 'callable')
        return 'callable';
    if (declaration.kind === 'interface')
        return 'interface';
    if (declaration.kind === 'class')
        return 'class';
    return 'value';
}
function escapePointer(value) {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
//# sourceMappingURL=compiler.js.map