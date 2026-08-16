import { posix } from 'node:path';
const FALLBACK_UNKNOWN_DECLARATION = 'unknown-declaration';
const FALLBACK_PACKAGE_CONFIGURATION = 'package-configuration';
const FALLBACK_TYPESCRIPT_CONFIGURATION = 'typescript-configuration';
const FALLBACK_TOPOLOGY = 'topology-ambiguity';
/**
 * Build a pure reverse index over one immutable specification corpus.
 *
 * The index stores only portable paths and owner source identities. It does not read the
 * repository, inspect the file system, or mutate the supplied snapshots.
 */
export function createSpecificationImpactIndex(specifications) {
    const ownership = new Map();
    const reverseDependencies = new Map();
    const ownerSet = new Set();
    const pendingEdges = [];
    const roots = [];
    const schemaOwners = new Set();
    const schemaPaths = new Set();
    for (const specification of specifications) {
        const owner = canonicalOwner(specification.source);
        ownerSet.add(owner);
        roots.push({ root: canonicalModuleRoot(specification.root), owner });
        if (!reverseDependencies.has(owner))
            reverseDependencies.set(owner, new Set());
        // The snapshot identity is normally the module API source. Retaining it here also keeps
        // hand-built snapshots with an omitted api resource useful without weakening path checks.
        addOwnership(ownership, owner, owner);
        addOwnership(ownership, owner, specification.module.packageAuthority.source);
        addDeclarationResource(ownership, pendingEdges, owner, specification.module.api);
        addTextResource(ownership, pendingEdges, owner, specification.module.code);
        addDeclarationResource(ownership, pendingEdges, owner, specification.module.internal);
        for (const resource of specification.module.ports) {
            addDeclarationResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.schemas) {
            addTextResource(ownership, pendingEdges, owner, resource);
            schemaOwners.add(owner);
            schemaPaths.add(assertCanonicalRepositoryPath(resource.source));
        }
        for (const resource of specification.examples) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.capabilities) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.flows) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.laws) {
            addTextResource(ownership, pendingEdges, owner, resource);
            addTestEvidenceInputs(ownership, owner, specification.root, resource.definitions);
        }
        for (const resource of specification.states) {
            addTextResource(ownership, pendingEdges, owner, resource);
            addTestEvidenceInputs(ownership, owner, specification.root, resource.definitions);
        }
        addTextResource(ownership, pendingEdges, owner, specification.limits);
        addTextResource(ownership, pendingEdges, owner, specification.layout);
        for (const resource of specification.benchmarks) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.packages) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.packagePatterns) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        // Package authority may be inherited from a package root and therefore may not appear in
        // the child module's top-level packages/packagePatterns arrays. Index both forms so an edit
        // to an authority input refreshes every module that compiled against it.
        for (const resource of specification.module.packageAuthority.packages) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const resource of specification.module.packageAuthority.packagePatterns) {
            addTextResource(ownership, pendingEdges, owner, resource);
        }
        for (const reference of specification.sourceReferences) {
            addSourceReference(ownership, pendingEdges, owner, reference);
        }
    }
    // Resolve cross-owner edges only after every snapshot has contributed its owned paths. The
    // corpus order is not a semantic input, so providers may appear before or after consumers.
    for (const edge of pendingEdges) {
        addDependencyEdges(ownership, reverseDependencies, edge.owner, edge.target);
    }
    const owners = sortedUnique(ownerSet);
    const paths = sortedUnique([
        ...ownership.keys(),
        ...pendingEdges.map((edge) => edge.target),
    ]);
    const frozenOwnership = freezeSetMap(ownership);
    const frozenReverseDependencies = freezeSetMap(reverseDependencies);
    const impact = (path, options) => {
        const validatedPath = assertCanonicalRepositoryPath(path);
        const directOwners = sortedUnique([
            ...(frozenOwnership.get(validatedPath) ?? EMPTY_OWNERS),
            ...(schemaPaths.has(validatedPath) || isPotentialSchemaPath(validatedPath)
                ? schemaOwners
                : EMPTY_OWNERS),
            ...roots
                .filter(({ root }) => root === '' || validatedPath === root || validatedPath.startsWith(`${root}/`))
                .map(({ owner }) => owner),
        ]);
        const fallbackReasons = fallbackReasonsFor(validatedPath, directOwners.length === 0, options);
        const dependentOwners = dependentClosure(directOwners, frozenReverseDependencies);
        const completeness = fallbackReasons.length
            ? 'conservative-full'
            : 'exact';
        const refreshedOwners = completeness === 'conservative-full'
            ? owners
            : sortedUnique([...directOwners, ...dependentOwners]);
        return Object.freeze({
            path: validatedPath,
            directOwners,
            dependentOwners,
            refreshedOwners,
            completeness,
            fallbackReasons,
        });
    };
    return Object.freeze({
        owners,
        paths,
        impact,
        lookup: impact,
        resolve: impact,
    });
}
function addTestEvidenceInputs(ownership, owner, moduleRoot, definitions) {
    for (const definition of definitions) {
        for (const reference of definition.tests ?? []) {
            const source = testEvidenceSource(moduleRoot, reference.file);
            if (source)
                addOwnership(ownership, owner, source);
        }
    }
}
function testEvidenceSource(moduleRoot, reference) {
    if (reference.startsWith('/') || /^[A-Za-z]:/u.test(reference) || reference.includes('\\')) {
        return;
    }
    const source = posix.normalize(posix.join(moduleRoot, reference));
    if (source === '..' || source.startsWith('../'))
        return;
    try {
        return assertCanonicalRepositoryPath(source);
    }
    catch {
        // Invalid authored evidence is already represented by specification diagnostics. It is not
        // a repository input until the reference itself becomes valid.
        return;
    }
}
function isPotentialSchemaPath(path) {
    return (path.startsWith('.spec/') || path.includes('/.spec/')) && path.endsWith('.schema.json');
}
/** Resolve one path directly against a corpus without retaining an index. */
export function computeSpecificationImpact(specifications, path, options) {
    return createSpecificationImpactIndex(specifications).impact(path, options);
}
/** Resolve one path against an existing index. */
export function findSpecificationImpact(index, path, options) {
    return 'impact' in index
        ? index.impact(path, options)
        : computeSpecificationImpact(index, path, options);
}
/**
 * Validate an already-root-relative POSIX repository path.
 *
 * No normalization is performed: a caller that supplies `./file`, `a/../file`, a backslash,
 * an empty segment, or an absolute path receives an error instead of a silently reinterpreted
 * query.
 */
export function assertCanonicalRepositoryPath(path) {
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('Repository paths must be non-empty canonical POSIX strings.');
    }
    if (path.includes('\\')) {
        throw new TypeError(`Repository path contains a backslash: ${path}`);
    }
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
        throw new TypeError(`Repository path must be root-relative, not absolute: ${path}`);
    }
    if (path.includes('\0')) {
        throw new TypeError(`Repository path contains a NUL byte: ${path}`);
    }
    const segments = path.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new TypeError(`Repository path is not canonical or escapes its root: ${path}`);
    }
    return path;
}
const EMPTY_OWNERS = Object.freeze([]);
function canonicalOwner(path) {
    return assertCanonicalRepositoryPath(path);
}
function canonicalModuleRoot(path) {
    return path === '.' ? '' : assertCanonicalRepositoryPath(path);
}
function addDeclarationResource(ownership, pendingEdges, owner, resource) {
    addTextResource(ownership, pendingEdges, owner, resource);
}
function addTextResource(ownership, pendingEdges, owner, resource) {
    if (!resource)
        return;
    addOwnership(ownership, owner, resource.source);
    if (!('model' in resource) || !resource.model)
        return;
    addModelInputs(ownership, pendingEdges, owner, resource.model);
}
function addModelInputs(ownership, pendingEdges, owner, model) {
    for (const source of model.sources ?? [])
        addOwnership(ownership, owner, source.file);
    for (const dependency of model.dependencies ?? []) {
        // A checker dependency is an indexed input, but not an owned file. Keep it in the
        // pending reverse graph so a provider snapshot is direct while this snapshot is dependent.
        pendingEdges.push({ owner, target: dependency.file });
    }
}
function addSourceReference(ownership, pendingEdges, owner, reference) {
    addOwnership(ownership, owner, reference.source);
    const targetPath = assertCanonicalRepositoryPath(reference.target.source);
    pendingEdges.push({ owner, target: targetPath });
}
function addDependencyEdges(ownership, reverseDependencies, owner, dependencyPath) {
    const targetOwners = ownership.get(dependencyPath);
    if (!targetOwners)
        return;
    for (const targetOwner of targetOwners) {
        if (targetOwner === owner)
            continue;
        addReverseDependency(reverseDependencies, targetOwner, owner);
    }
}
function addOwnership(ownership, owner, path) {
    const validatedPath = assertCanonicalRepositoryPath(path);
    let owners = ownership.get(validatedPath);
    if (!owners) {
        owners = new Set();
        ownership.set(validatedPath, owners);
    }
    owners.add(owner);
}
function addReverseDependency(reverseDependencies, changedOwner, dependentOwner) {
    let dependents = reverseDependencies.get(changedOwner);
    if (!dependents) {
        dependents = new Set();
        reverseDependencies.set(changedOwner, dependents);
    }
    dependents.add(dependentOwner);
}
function freezeSetMap(values) {
    return new Map([...values.entries()].map(([key, set]) => [key, sortedUnique(set)]));
}
function dependentClosure(directOwners, reverseDependencies) {
    if (directOwners.length === 0)
        return EMPTY_OWNERS;
    const direct = new Set(directOwners);
    const visited = new Set();
    const queue = [...directOwners];
    while (queue.length) {
        const owner = queue.shift();
        for (const dependent of reverseDependencies.get(owner) ?? EMPTY_OWNERS) {
            if (visited.has(dependent))
                continue;
            visited.add(dependent);
            queue.push(dependent);
        }
    }
    return sortedUnique([...visited].filter((owner) => !direct.has(owner)));
}
function fallbackReasonsFor(path, unknown, options) {
    const reasons = new Set();
    if (options?.topologyAmbiguous === true) {
        reasons.add(FALLBACK_TOPOLOGY);
    }
    if ((options?.kind === 'add' || options?.kind === 'delete' || options?.kind === 'unlink') &&
        isTopologyChangingSource(path)) {
        reasons.add(FALLBACK_TOPOLOGY);
    }
    if (!unknown)
        return sortedUnique(reasons);
    if (path.endsWith('.d.ts'))
        reasons.add(FALLBACK_UNKNOWN_DECLARATION);
    if (isPackageConfiguration(path))
        reasons.add(FALLBACK_PACKAGE_CONFIGURATION);
    if (isTypeScriptConfiguration(path))
        reasons.add(FALLBACK_TYPESCRIPT_CONFIGURATION);
    return sortedUnique(reasons);
}
function isTopologyChangingSource(path) {
    return (/\.(?:cts|mts|tsx?|cjs|mjs|jsx?|d\.ts)$/u.test(path) ||
        (path.startsWith('.spec/') || path.includes('/.spec/')));
}
function isPackageConfiguration(path) {
    return path === 'package.json' || path.endsWith('/package.json');
}
function isTypeScriptConfiguration(path) {
    return /(?:^|\/)tsconfig[^/]*\.json$/.test(path);
}
function sortedUnique(values) {
    return Object.freeze([...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}
//# sourceMappingURL=index.js.map