/** Resolve the one locally declared interface that gives a Port resource its identity. */
export function resolvePort(resource, pointer, namespace) {
    const api = resource.model;
    if (!api)
        return { diagnostics: [] };
    const declarations = new Map(api.surface.declarations.map((item) => [item.identity, item]));
    const interfaces = rootInterfaceExports(api);
    const defaults = api.surface.exports.filter((item) => item.path.length === 1 && item.path[0] === 'default');
    if (defaults.length > 0) {
        const declaration = defaults[0] ? declarations.get(defaults[0].declaration) : undefined;
        return {
            diagnostics: [
                portDiagnostic('PORT_DEFAULT_EXPORT', 'A port interface must be a named export; default exports are not valid port identities.', resource, pointer, declaration),
            ],
        };
    }
    const named = interfaces.filter((item) => item.export.path[0] !== 'default');
    const local = named.filter((item) => isLocal(item.declaration, api));
    const reexported = named.filter((item) => !isLocal(item.declaration, api));
    if (local.length === 0) {
        if (reexported.length > 0) {
            return {
                diagnostics: [
                    portDiagnostic('PORT_INTERFACE_REEXPORTED', `A port must declare its required interface locally; found only re-exported interface${reexported.length === 1 ? '' : 's'}: ${names(reexported)}.`, resource, pointer, reexported[0]?.declaration),
                ],
            };
        }
        return {
            diagnostics: [
                portDiagnostic('PORT_INTERFACE_MISSING', 'A Port declaration must export at least one locally declared named interface.', resource, pointer),
            ],
        };
    }
    if (local.length !== 1) {
        return {
            diagnostics: [
                portDiagnostic('PORT_INTERFACE_AMBIGUOUS', `A Port declaration must export exactly one locally declared named interface; found ${local.length}: ${names(local)}. Supporting declarations must not be locally exported interfaces.`, resource, pointer, local[0]?.declaration),
            ],
        };
    }
    return {
        port: {
            ...resource,
            declarationPointer: pointer,
            ...(namespace ? { namespace } : {}),
            port: portInterface(local[0]),
        },
        diagnostics: [],
    };
}
export function duplicatePortNameDiagnostics(ports, declarationSource) {
    const seen = new Map();
    const diagnostics = [];
    for (const [index, port] of ports.entries()) {
        const qualified = port.namespace ? `${port.namespace}.${port.port.name}` : port.port.name;
        const first = seen.get(qualified);
        if (first === undefined) {
            seen.set(qualified, index);
            continue;
        }
        diagnostics.push({
            code: 'PORT_DUPLICATE_NAME',
            message: `Port interface ${qualified} is already declared by ${ports[first]?.declarationPointer ?? `/ports/${first}`}; qualified capability names must be unique within a specification.`,
            file: declarationSource,
            line: 1,
            column: 1,
            pointer: port.declarationPointer,
        });
    }
    return diagnostics;
}
function portInterface(item) {
    return { name: item.declaration.name, declaration: item.declaration.identity };
}
function rootInterfaceExports(api) {
    const declarations = new Map(api.surface.declarations.map((item) => [item.identity, item]));
    const unique = new Map();
    for (const item of api.surface.exports) {
        if (item.path.length !== 1 || item.kind !== 'interface')
            continue;
        const declaration = declarations.get(item.declaration);
        if (!declaration || declaration.kind !== 'interface')
            continue;
        const key = `${item.path[0]}\0${declaration.identity}`;
        unique.set(key, { export: item, declaration });
    }
    return [...unique.values()];
}
function isLocal(declaration, api) {
    return declaration.location.file === api.entrypoint;
}
function names(items) {
    return items.map((item) => item.export.path[0] ?? item.declaration.name).join(', ');
}
function portDiagnostic(code, message, resource, pointer, declaration) {
    return {
        code,
        message,
        file: declaration?.location.file ?? resource.source,
        line: declaration?.location.line ?? 1,
        column: declaration?.location.column ?? 1,
        pointer,
    };
}
//# sourceMappingURL=port.js.map