import { TYPESCRIPT_FACT_NAMESPACES, TypeScriptFactContractError, } from './model.js';
import { validateTypeScriptFactPayload } from './validate.js';
export function createTypeScriptFactReader(query) {
    let declarationIndex;
    const allDeclarations = () => (declarationIndex ??= loadDeclarationIndex(query));
    return {
        async facts(kind, filter = {}, page) {
            const result = await query.facts(factFilter(kind, filter), page);
            return {
                ...result,
                facts: await admitFacts(query, kind, result.facts),
            };
        },
        async factsById(kind, ids) {
            return admitFacts(query, kind, await query.factsById(ids));
        },
        async *export(kind, filter = {}) {
            const declarations = kind === 'module' ? await allDeclarations() : undefined;
            for await (const fact of query.export({
                ...factFilter(kind, filter),
            })) {
                yield (kind === 'module'
                    ? hydrateModule(fact, declarations)
                    : admit(kind, fact));
            }
        },
        async *exportAll(filter = {}) {
            const declarations = await allDeclarations();
            for await (const fact of query.export({
                ...filter,
                namespaces: [...new Set(Object.values(TYPESCRIPT_FACT_NAMESPACES))],
            })) {
                if (fact.namespace === TYPESCRIPT_FACT_NAMESPACES.declaration &&
                    fact.kind === 'declaration') {
                    admit('declaration', fact);
                    continue;
                }
                yield fact.namespace === TYPESCRIPT_FACT_NAMESPACES.module && fact.kind === 'module'
                    ? hydrateModule(fact, declarations)
                    : admitAny(fact);
            }
        },
    };
}
const kindByNamespace = new Map(Object.entries(TYPESCRIPT_FACT_NAMESPACES)
    .filter(([kind]) => kind !== 'declaration')
    .map(([kind, namespace]) => [namespace, kind]));
function admitAny(fact) {
    const kind = fact.namespace === TYPESCRIPT_FACT_NAMESPACES.declaration && fact.kind === 'declaration'
        ? 'declaration'
        : kindByNamespace.get(fact.namespace);
    if (!kind) {
        throw new TypeScriptFactContractError('project', fact.id, [
            `namespace:${fact.namespace}`,
        ]);
    }
    return admit(kind, fact);
}
function admit(kind, fact) {
    const diagnostics = [];
    if (fact.namespace !== TYPESCRIPT_FACT_NAMESPACES[kind]) {
        diagnostics.push(`namespace:${fact.namespace}`);
    }
    if (kind === 'module' && fact.kind !== 'module')
        diagnostics.push(`kind:${fact.kind}`);
    if (kind === 'declaration' && fact.kind !== 'declaration')
        diagnostics.push(`kind:${fact.kind}`);
    if (fact.schemaVersion !== 1 &&
        !((kind === 'module' || kind === 'declaration') && fact.schemaVersion === 2)) {
        diagnostics.push(`schema-version:${fact.schemaVersion}`);
    }
    diagnostics.push(...validateTypeScriptFactPayload(kind, fact.payload, fact.schemaVersion));
    if (diagnostics.length)
        throw new TypeScriptFactContractError(kind, fact.id, diagnostics);
    return fact;
}
async function admitFacts(query, kind, facts) {
    if (kind !== 'module')
        return facts.map((fact) => admit(kind, fact));
    const raw = facts.map((fact) => admit(kind, fact));
    const references = raw.flatMap((fact) => fact.schemaVersion === 2
        ? fact.payload.declarations.map((declaration) => declaration.fact)
        : []);
    const declarations = new Map();
    for (const fact of await query.factsById([...new Set(references)].sort())) {
        const admitted = admit('declaration', fact);
        if (declarations.has(admitted.id)) {
            throw new TypeScriptFactContractError('declaration', admitted.id, ['fact:duplicate']);
        }
        declarations.set(admitted.id, admitted);
    }
    return raw.map((fact) => hydrateModule(fact, declarations));
}
async function loadDeclarationIndex(query) {
    const declarations = new Map();
    for await (const fact of query.export({
        namespaces: [TYPESCRIPT_FACT_NAMESPACES.declaration],
        kinds: ['declaration'],
    })) {
        if (fact.namespace !== TYPESCRIPT_FACT_NAMESPACES.declaration ||
            fact.kind !== 'declaration') {
            continue;
        }
        const admitted = admit('declaration', fact);
        if (declarations.has(admitted.id)) {
            throw new TypeScriptFactContractError('declaration', admitted.id, ['fact:duplicate']);
        }
        declarations.set(admitted.id, admitted);
    }
    return declarations;
}
function factFilter(kind, filter) {
    return {
        ...filter,
        namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]],
        ...(kind === 'module' || kind === 'declaration' ? { kinds: [kind] } : {}),
    };
}
function hydrateModule(input, declarations) {
    const fact = admit('module', input);
    if (fact.schemaVersion === 1)
        return fact;
    const normalized = fact.payload;
    const payload = {
        ...normalized,
        declarations: normalized.declarations.map((reference) => {
            const declaration = declarations.get(reference.fact);
            if (!declaration ||
                declaration.subject !== reference.identity ||
                declaration.payload.declaration.identity !== reference.identity) {
                throw new TypeScriptFactContractError('module', fact.id, [
                    `declaration:${reference.fact}:missing-or-mismatched`,
                ]);
            }
            return { ...declaration.payload.declaration, exportPaths: reference.exportPaths };
        }),
    };
    const diagnostics = validateTypeScriptFactPayload('module', payload, 1);
    if (diagnostics.length)
        throw new TypeScriptFactContractError('module', fact.id, diagnostics);
    return { ...fact, schemaVersion: 1, payload };
}
//# sourceMappingURL=reader.js.map