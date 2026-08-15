import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { APPLICATION_TEST_FACT_NAMESPACE, } from '../application/observation/index.js';
/** Plan only executable evidence attached to the requested module scope. */
export async function planEvidenceTests(root, reader, scope) {
    const snapshot = reader.snapshot;
    const selected = scope === 'all' || snapshot.selection.kind === 'full'
        ? undefined
        : new Set(scope === 'selected'
            ? snapshot.selection.primary
            : snapshot.selection.selected);
    const facts = [];
    for (const universe of snapshot.analysis?.universes ?? []) {
        const query = await reader.query(universe);
        try {
            for await (const fact of query.export({ namespaces: [APPLICATION_TEST_FACT_NAMESPACE] })) {
                const payload = fact.payload;
                const specification = snapshot.specifications.find((candidate) => candidate.id === payload.specification);
                if (!specification || (selected && !selected.has(specification.source)))
                    continue;
                facts.push(payload);
            }
        }
        finally {
            await query.dispose();
        }
    }
    const evidence = deduplicateEvidence(facts.flatMap((fact) => [
        ...fact.laws.flatMap((definition) => definition.evidence),
        ...fact.states.flatMap((definition) => definition.evidence),
    ]));
    const active = evidence.filter((item) => item.status === 'active');
    const groups = new Map();
    const owners = new Map();
    for (const item of active) {
        const directory = dirname(item.source);
        let owner = owners.get(directory);
        if (!owner) {
            owner = owningPackage(root, item.source);
            owners.set(directory, owner);
        }
        const packageName = await owner;
        const current = groups.get(packageName) ?? { files: new Set(), evidenceCount: 0 };
        current.files.add(item.source);
        current.evidenceCount += 1;
        groups.set(packageName, current);
    }
    return {
        active: active.length,
        skipped: evidence.filter((item) => item.status === 'skipped').length,
        todo: evidence.filter((item) => item.status === 'todo').length,
        groups: [...groups]
            .sort(([left], [right]) => compare(left, right))
            .map(([packageName, group]) => ({
            packageName,
            files: [...group.files].sort(compare),
            evidenceCount: group.evidenceCount,
        })),
    };
}
/** Execute one package at a time through the repository's standard test:file adapter. */
export async function executeEvidenceTests(root, plan, onGroup, executor = defaultExecutor) {
    const failedPackages = [];
    for (const group of plan.groups) {
        onGroup?.(group);
        if ((await executor.run(root, group.files)) !== 0)
            failedPackages.push(group.packageName);
    }
    return {
        passed: plan.groups.length - failedPackages.length,
        failed: failedPackages.length,
        failedPackages,
    };
}
const defaultExecutor = {
    run(root, files) {
        return new Promise((resolveExit, reject) => {
            const child = spawn('pnpm', ['run', 'test:file', ...files], {
                cwd: root,
                stdio: 'inherit',
            });
            child.once('error', reject);
            child.once('exit', (code, signal) => {
                if (signal)
                    reject(new Error(`Evidence tests terminated by ${signal}.`));
                else
                    resolveExit(code ?? 1);
            });
        });
    },
};
function deduplicateEvidence(values) {
    return [
        ...new Map(values.map((evidence) => [`${evidence.source}\0${evidence.id}`, evidence])).values(),
    ].sort((left, right) => compare(left.source, right.source) || compare(left.id, right.id));
}
async function owningPackage(root, source) {
    const catalogRoot = resolve(root);
    let current = dirname(resolve(catalogRoot, ...source.split('/')));
    while (within(catalogRoot, current)) {
        try {
            const value = JSON.parse(await readFile(resolve(current, 'package.json'), 'utf8'));
            if (isRecord(value) && typeof value.name === 'string')
                return value.name;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (current === catalogRoot)
            break;
        current = dirname(current);
    }
    throw new Error(`No package.json with a package name owns test evidence ${source}.`);
}
function within(root, target) {
    const path = relative(resolve(root), resolve(target));
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=evidence.js.map