/** Index the analysis-snapshot side once, then reuse it for every specification comparison. */
export function indexComparisonObservation(observation) {
    const declarations = canonicalObservedDeclarations(observation);
    const entrypointOwners = firstModuleBy(observation.modules, (module) => module.target.entrypoint);
    const rootOwners = firstModuleBy(observation.modules, (module) => module.target.root);
    const declarationOwners = new Map();
    for (const declaration of declarations.values()) {
        const owner = declaration.location.file
            ? (entrypointOwners.get(declaration.location.file) ??
                nearestRootOwner(declaration.location.file, rootOwners))
            : undefined;
        if (owner)
            declarationOwners.set(declaration.identity, owner.id);
    }
    const declarationsByOwnerAndName = new Map();
    for (const declaration of declarations.values()) {
        const owner = declarationOwners.get(declaration.identity);
        if (!owner)
            continue;
        const key = observedDeclarationLookupKey(owner, declaration.name);
        const values = declarationsByOwnerAndName.get(key) ?? [];
        values.push(declaration);
        declarationsByOwnerAndName.set(key, values);
    }
    return {
        declarations,
        declarationOwners,
        declarationsByOwnerAndName: new Map([...declarationsByOwnerAndName].map(([key, values]) => [
            key,
            values.sort((left, right) => left.identity.localeCompare(right.identity)),
        ])),
        modules: new Map(observation.modules.map((module) => [module.id, module])),
    };
}
function firstModuleBy(modules, key) {
    const values = new Map();
    for (const module of modules) {
        const identity = key(module);
        if (!values.has(identity))
            values.set(identity, module);
    }
    return values;
}
function nearestRootOwner(file, roots) {
    let candidate = file;
    while (candidate) {
        const owner = roots.get(candidate);
        if (owner)
            return owner;
        const separator = candidate.lastIndexOf('/');
        if (separator < 0)
            return;
        candidate = candidate.slice(0, separator);
    }
    return;
}
/** Build one immutable semantic comparison context without catalog or filesystem authority. */
export function createComparisonContext(expected, compilation, observation, observedIndex = indexComparisonObservation(observation)) {
    const declarations = new Map([...expected.declarations, ...(compilation.references ?? [])].map((declaration) => [declaration.identity.key, declaration]));
    const index = { declarations, unavailableModules: new Map() };
    return {
        observation,
        expected: index,
        observedDeclarations: observedIndex.declarations,
        observedDeclarationOwners: observedIndex.declarationOwners,
        observedDeclarationsByOwnerAndName: observedIndex.declarationsByOwnerAndName,
        observedModules: observedIndex.modules,
        seeds: seedBindings(expected, index, observation, observedIndex.declarations),
    };
}
export function observedDeclarationLookupKey(owner, name) {
    return `${owner}\0${name}`;
}
function canonicalObservedDeclarations(observation) {
    const candidates = new Map();
    for (const module of observation.modules) {
        for (const declaration of module.declarations) {
            const current = candidates.get(declaration.identity);
            const candidate = { module, declaration };
            if (current)
                current.push(candidate);
            else
                candidates.set(declaration.identity, [candidate]);
        }
    }
    return new Map([...candidates].map(([identity, values]) => {
        const canonical = [...values].sort((left, right) => {
            const ownership = ownershipRank(left.module, left.declaration) -
                ownershipRank(right.module, right.declaration);
            return ownership || left.module.id.localeCompare(right.module.id);
        })[0];
        return [identity, canonical.declaration];
    }));
}
function ownershipRank(module, declaration) {
    const file = declaration.location.file;
    if (!file)
        return Number.POSITIVE_INFINITY;
    if (file === module.target.entrypoint)
        return 0;
    if (file === module.target.root || file.startsWith(`${module.target.root}/`))
        return 1;
    return Number.POSITIVE_INFINITY;
}
function seedBindings(expected, index, observation, observedByIdentity) {
    const observed = observation.modules.find((module) => module.id === expected.id);
    if (!observed)
        return new Map();
    const exports = new Map(observed.exports.map((item) => [item.path.join('.'), item]));
    const candidates = new Map();
    const ambiguous = new Set();
    const offer = (canonical, candidate) => {
        if (ambiguous.has(canonical))
            return;
        const previous = candidates.get(canonical);
        if (!previous || previous.identity === candidate.identity) {
            candidates.set(canonical, previous?.direct ? previous : candidate);
        }
        else if (candidate.direct && !previous.direct) {
            candidates.set(canonical, candidate);
        }
        else if (candidate.direct === previous.direct) {
            candidates.delete(canonical);
            ambiguous.add(canonical);
        }
    };
    for (const item of expected.exports) {
        const actual = exports.get(item.path.join('.'));
        if (!actual)
            continue;
        const declaration = observedByIdentity.get(actual.declaration);
        if (!declaration)
            continue;
        const expectedDeclaration = index.declarations.get(item.declaration.key);
        if (!declarationKindCompatible(item.declaration.kind, declaration, expectedDeclaration))
            continue;
        const canonical = canonicalExpected(item.declaration.key, index);
        if (ambiguous.has(canonical))
            continue;
        const candidate = {
            identity: actual.declaration,
            direct: canonical === item.declaration.key,
        };
        offer(canonical, candidate);
    }
    // A focused qualification still needs authoritative identities for imported contracts. The
    // provider module's own public export is sufficient evidence; compiling unrelated consumers is
    // neither necessary nor desirable. This is the module-local equivalent of V1's catalog seed.
    for (const declaration of index.declarations.values()) {
        if (declaration.identity.source === expected.id)
            continue;
        const provider = observation.modules.find((module) => module.id === declaration.identity.source);
        if (!provider)
            continue;
        const matching = new Set();
        for (const item of provider.exports) {
            if (item.name !== declaration.identity.name)
                continue;
            const observedDeclaration = observedByIdentity.get(item.declaration);
            if (observedDeclaration &&
                declarationKindCompatible(declaration.identity.kind, observedDeclaration, declaration)) {
                matching.add(item.declaration);
            }
        }
        if (matching.size !== 1)
            continue;
        const canonical = canonicalExpected(declaration.identity.key, index);
        offer(canonical, {
            identity: [...matching][0],
            direct: canonical === declaration.identity.key,
        });
    }
    return new Map([...candidates].map(([canonical, candidate]) => [canonical, candidate.identity]));
}
export function canonicalExpected(identity, expected) {
    let current = identity;
    const seen = new Set();
    while (!seen.has(current)) {
        seen.add(current);
        const alias = expected.declarations.get(current)?.alias?.key;
        if (!alias)
            return current;
        current = alias;
    }
    return current;
}
export function declarationKindCompatible(expected, observed, declaration) {
    if (declaration?.facets || declaration?.factory) {
        return expected === 'value' && observed.kind === 'factory';
    }
    if (expected === 'value' &&
        declaration?.valueType?.expression.kind === 'external' &&
        ['value', 'callable', 'interface', 'class'].includes(observed.kind)) {
        return true;
    }
    if (observed.kind === 'factory')
        return false;
    if (expected === observed.kind)
        return true;
    if (expected === 'value' && observed.kind === 'callable' && declaration?.valueType)
        return true;
    return expected === 'value' && observed.kind === 'interface';
}
//# sourceMappingURL=context.js.map