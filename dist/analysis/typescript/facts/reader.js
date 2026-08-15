import { TYPESCRIPT_FACT_NAMESPACES, TypeScriptFactContractError, } from './model.js';
import { validateTypeScriptFactPayload } from './validate.js';
export function createTypeScriptFactReader(query) {
    return {
        async facts(kind, filter = {}, page) {
            const result = await query.facts({ ...filter, namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]] }, page);
            return {
                ...result,
                facts: result.facts.map((fact) => admit(kind, fact)),
            };
        },
        async factsById(kind, ids) {
            return (await query.factsById(ids)).map((fact) => admit(kind, fact));
        },
        async *export(kind, filter = {}) {
            for await (const fact of query.export({
                ...filter,
                namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]],
            })) {
                yield admit(kind, fact);
            }
        },
        async *exportAll(filter = {}) {
            for await (const fact of query.export({
                ...filter,
                namespaces: Object.values(TYPESCRIPT_FACT_NAMESPACES),
            })) {
                yield admitAny(fact);
            }
        },
    };
}
const kindByNamespace = new Map(Object.entries(TYPESCRIPT_FACT_NAMESPACES).map(([kind, namespace]) => [
    namespace,
    kind,
]));
function admitAny(fact) {
    const kind = kindByNamespace.get(fact.namespace);
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
    if (fact.schemaVersion !== 1)
        diagnostics.push(`schema-version:${fact.schemaVersion}`);
    diagnostics.push(...validateTypeScriptFactPayload(kind, fact.payload));
    if (diagnostics.length)
        throw new TypeScriptFactContractError(kind, fact.id, diagnostics);
    return fact;
}
//# sourceMappingURL=reader.js.map