/** Whether an authored module coordinate can only name a strict descendant of its citing module. */
export function isDescendantModulePath(value) {
    if (!value || value.includes('\\') || value.includes('\0'))
        return false;
    if (value.startsWith('/') || /^[A-Za-z]:/u.test(value))
        return false;
    return value
        .split('/')
        .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
/** Catalog-relative root of the descendant module cited from one module root. */
export function descendantModuleRoot(root, module) {
    return root === '.' ? module : `${root}/${module}`;
}
/** Stable identity of one authored reference inside its citing module. */
export function semanticReferenceKey(reference) {
    return typeof reference === 'string' ? `\0${reference}` : `${reference.module}\0${reference.id}`;
}
/** Public-contract anchors of every descendant module cited by one module's capabilities. */
export function capabilityReferenceSources(specification) {
    const sources = new Set();
    for (const resource of specification.capabilities) {
        for (const definition of resource.definitions) {
            for (const reference of [...(definition.laws ?? []), ...(definition.capabilities ?? [])]) {
                if (typeof reference === 'string' || !isDescendantModulePath(reference.module))
                    continue;
                sources.add(`${descendantModuleRoot(specification.root, reference.module)}/.spec/api.d.ts`);
            }
        }
    }
    return [...sources].sort(compare);
}
/** Capabilities that cite any of the given laws, directly or through other capabilities. */
export function capabilitiesCiting(modules, laws) {
    const entries = derivationEntries(modules);
    const reachedLaws = new Set(laws.map(coordinateKey));
    const reached = new Set();
    const ordered = [];
    // Each round admits the capabilities one citation further from the laws: direct citers first.
    for (;;) {
        const round = entries.filter((entry) => !reached.has(coordinateKey(entry)) &&
            (entry.laws.some((law) => reachedLaws.has(coordinateKey(law))) ||
                entry.capabilities.some((cited) => reached.has(coordinateKey(cited)))));
        if (!round.length)
            break;
        for (const entry of round)
            reached.add(coordinateKey(entry));
        ordered.push(...round);
    }
    return ordered.map((entry) => ({
        module: entry.module,
        id: entry.id,
        source: entry.source,
        cites: {
            laws: entry.laws.filter((law) => reachedLaws.has(coordinateKey(law))),
            capabilities: entry.capabilities.filter((cited) => reached.has(coordinateKey(cited))),
        },
    }));
}
/**
 * Derive every capability status from authored citations and attached active tests.
 *
 * A capability that cites nothing is declared. It is held when every cited law has an active
 * attached test and every cited capability is held; anything else, including an unresolved
 * citation or a citation cycle, is partial. The status is reported and is never a diagnostic.
 */
export function deriveCapabilityStatuses(modules) {
    const activeLaws = new Map();
    for (const module of modules) {
        for (const law of module.laws) {
            const key = coordinateKey({ module: module.root, id: law.id });
            activeLaws.set(key, law.active || activeLaws.get(key) === true);
        }
    }
    const entries = derivationEntries(modules);
    const capabilities = new Map();
    for (const entry of entries) {
        const key = coordinateKey(entry);
        if (!capabilities.has(key))
            capabilities.set(key, entry);
    }
    const derived = new Map();
    const visiting = new Set();
    const derive = (entry) => {
        const known = derived.get(entry);
        if (known)
            return known;
        visiting.add(entry);
        const blockingLaws = entry.laws.filter((law) => activeLaws.get(coordinateKey(law)) !== true);
        const blockingCapabilities = entry.capabilities.filter((cited) => {
            const target = capabilities.get(coordinateKey(cited));
            // A capability reached again while it is being derived closes a citation cycle.
            if (!target || visiting.has(target))
                return true;
            return derive(target).status !== 'held';
        });
        visiting.delete(entry);
        const result = {
            module: entry.module,
            id: entry.id,
            source: entry.source,
            status: entry.laws.length + entry.capabilities.length === 0
                ? 'declared'
                : blockingLaws.length + blockingCapabilities.length === 0
                    ? 'held'
                    : 'partial',
            blocking: { laws: blockingLaws, capabilities: blockingCapabilities },
        };
        derived.set(entry, result);
        return result;
    };
    return entries.map(derive);
}
/** Every declared capability with its citations resolved, in stable module order. */
function derivationEntries(modules) {
    return [...modules]
        .sort((left, right) => compare(left.root, right.root))
        .flatMap((module) => module.capabilities.flatMap((resource) => resource.definitions.map((definition) => ({
        module: module.root,
        id: definition.id,
        source: resource.source,
        laws: (definition.laws ?? []).map((reference) => coordinate(module.root, reference)),
        capabilities: (definition.capabilities ?? []).map((reference) => coordinate(module.root, reference)),
    }))));
}
function coordinate(root, reference) {
    return typeof reference === 'string'
        ? { module: root, id: reference }
        : { module: descendantModuleRoot(root, reference.module), id: reference.id };
}
function coordinateKey(value) {
    return `${value.module}\0${value.id}`;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
