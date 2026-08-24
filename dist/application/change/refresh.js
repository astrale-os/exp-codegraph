import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { compileSpecificationSnapshots } from '../../specification/index.js';
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.js';
import { createSpecificationImpactIndex } from './impact.js';
/** Prove that a partial request corpus cannot gain or lose normative owners or dependency edges. */
export function canRetainPartialSpecificationCorpus(previous, changes) {
    if (!changes.length || changes.some((change) => change.kind !== 'change'))
        return false;
    return changes.every((change) => change.path.endsWith('/.spec/layout.ts') ||
        previous.every((specification) => !normativeSpecificationInputs(specification).has(change.path)));
}
/** Recompile exactly the proven normative owner closure and retain every unaffected snapshot. */
export async function refreshSpecificationCorpus(root, directories, previous, inventoryChanges, changedHints, compile) {
    const available = new Map(directories.map((directory) => [portable(relative(root, resolve(directory))), resolve(directory)]));
    const retained = new Map(previous.map((specification) => [
        portable(relative(root, dirname(resolve(root, specification.source)))),
        specification,
    ]));
    const index = createSpecificationImpactIndex(previous);
    const impactedOwners = new Set();
    const compilationOwners = new Set();
    const specificationsBySource = new Map(previous.map((value) => [value.source, value]));
    const affected = new Set();
    for (const directory of available.keys()) {
        if (!retained.has(directory))
            affected.add(directory);
    }
    const changes = new Map(inventoryChanges.map((change) => [change.path, change.kind]));
    for (const input of changedHints) {
        const source = await workspacePath(root, input);
        if (!source)
            continue;
        if (!changes.has(source))
            changes.set(source, 'change');
    }
    for (const [source, kind] of changes) {
        const impact = index.impact(source, { kind });
        const fallback = requiresNormativeFallback(source, kind, impact.fallbackReasons);
        const normative = fallback ||
            impact.directOwners.some((owner) => specificationsBySource.get(owner) &&
                normativeSpecificationInputs(specificationsBySource.get(owner)).has(source));
        const refreshedOwners = normative
            ? impact.refreshedOwners
            : deepestSpecificationOwners(impact.directOwners, specificationsBySource);
        for (const owner of refreshedOwners) {
            impactedOwners.add(owner);
            if (normative)
                compilationOwners.add(owner);
        }
    }
    for (const owner of compilationOwners) {
        const directory = portable(relative(root, dirname(resolve(root, owner))));
        if (available.has(directory))
            affected.add(directory);
    }
    const compiled = affected.size
        ? await compile(root, [...affected].map((directory) => available.get(directory)).filter(Boolean), {
            maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
            previous,
            changed: [...changes.keys()],
        })
        : [];
    const replacements = new Map(compiled.map((specification) => [
        portable(relative(root, dirname(resolve(root, specification.source)))),
        specification,
    ]));
    const specifications = [...available.keys()]
        .map((directory) => replacements.get(directory) ?? retained.get(directory))
        .filter((value) => value !== undefined)
        .sort((left, right) => left.source.localeCompare(right.source));
    return {
        specifications,
        refreshedOwners: sortedUnique([...impactedOwners, ...compiled.map((value) => value.source)]),
        compiled: compiled.length,
    };
}
export function repositoryInventoryChanges(previous, current) {
    const before = new Map(previous.files.map((file) => [file.path, file.revision]));
    const after = new Map(current.files.map((file) => [file.path, file.revision]));
    return sortedUnique([...before.keys(), ...after.keys()]).flatMap((path) => {
        const left = before.get(path);
        const right = after.get(path);
        if (left === right)
            return [];
        return [{ path, kind: left === undefined ? 'add' : right === undefined ? 'unlink' : 'change' }];
    });
}
function deepestSpecificationOwners(owners, specifications) {
    const depth = Math.max(...owners.map((owner) => specifications.get(owner)?.root.split('/').length ?? -1), -1);
    return owners.filter((owner) => (specifications.get(owner)?.root.split('/').length ?? -1) === depth);
}
function normativeSpecificationInputs(specification) {
    const inputs = new Set();
    const add = (resource) => {
        if (!resource)
            return;
        inputs.add(resource.source);
        for (const source of resource.model?.sources ?? [])
            inputs.add(source.file);
        for (const dependency of resource.model?.dependencies ?? [])
            inputs.add(dependency.file);
    };
    add(specification.module.api);
    add(specification.module.code);
    add(specification.module.internal);
    for (const resource of specification.module.ports)
        add(resource);
    for (const resource of [
        ...specification.schemas,
        ...specification.examples,
        ...specification.capabilities,
        ...specification.flows,
        ...specification.laws,
        ...specification.states,
        ...(specification.limits ? [specification.limits] : []),
        ...(specification.layout ? [specification.layout] : []),
        ...specification.benchmarks,
        ...specification.packages,
        ...specification.packagePatterns,
        ...specification.module.packageAuthority.packages,
        ...specification.module.packageAuthority.packagePatterns,
    ])
        add(resource);
    inputs.add(specification.module.packageAuthority.source);
    for (const reference of specification.sourceReferences) {
        inputs.add(reference.source);
        inputs.add(reference.target.source);
    }
    return inputs;
}
function requiresNormativeFallback(source, kind, reasons) {
    if (reasons.includes('unknown-declaration') ||
        reasons.includes('package-configuration') ||
        reasons.includes('typescript-configuration'))
        return true;
    if (kind === 'change')
        return false;
    if (!(source.startsWith('.spec/') || source.includes('/.spec/')))
        return false;
    return !source.endsWith('/architecture.md') && !source.endsWith('/icon.svg');
}
async function workspacePath(root, input) {
    let target = resolve(root, input);
    try {
        target = await realpath(target);
    }
    catch {
        try {
            target = join(await realpath(dirname(target)), basename(target));
        }
        catch {
            return;
        }
    }
    const path = relative(root, target);
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
        return;
    return portable(path);
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
//# sourceMappingURL=refresh.js.map