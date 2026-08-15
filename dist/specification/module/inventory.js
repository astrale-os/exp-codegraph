import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.js';
const DIRECT_FILES = new Map([
    ['api.d.ts', 'api'],
    ['code.ts', 'code'],
    ['icon.svg', 'icon'],
    ['internal.d.ts', 'internal'],
    ['limits.ts', 'limits'],
    ['layout.ts', 'layout'],
    ['architecture.md', 'architecture'],
]);
const DIRECTORIES = {
    api: (name) => name.endsWith('.d.ts'),
    schemas: (name) => name.endsWith('.schema.json'),
    ports: (name) => name.endsWith('.d.ts'),
    capabilities: (name) => name.endsWith('.ts'),
    flows: (name) => name.endsWith('.ts'),
    laws: (name) => name.endsWith('.ts'),
    states: (name) => name.endsWith('.ts'),
    examples: (name) => name.endsWith('.ts'),
    benchmarks: (name) => name.endsWith('.ts'),
    packages: (name) => name.endsWith('.ts'),
};
const inventories = operationSnapshotNamespace('module-inventories');
/** Discover the closed normative `.spec/` grammar and the open sibling `.history/` tree. */
export async function inventoryModuleFiles(catalogRoot, specDirectory) {
    const snapshot = operationSnapshot(inventories);
    if (!snapshot)
        return inventoryModuleFilesFresh(catalogRoot, specDirectory);
    const key = `${resolve(catalogRoot)}\0${resolve(specDirectory)}`;
    const current = snapshot.get(key);
    if (current)
        return current;
    const inventory = inventoryModuleFilesFresh(catalogRoot, specDirectory);
    snapshot.set(key, inventory);
    return inventory;
}
async function inventoryModuleFilesFresh(catalogRoot, specDirectory) {
    const root = await realpath(resolve(catalogRoot));
    const spec = await realpath(resolve(specDirectory));
    if (basename(spec) !== '.spec' || !within(root, spec)) {
        throw new Error('A convention-based module specification must be a .spec directory.');
    }
    const api = moduleFile(root, spec, join(spec, 'api.d.ts'));
    const output = {
        api,
        apiFragments: [],
        schemas: [],
        ports: [],
        capabilities: [],
        flows: [],
        laws: [],
        states: [],
        examples: [],
        benchmarks: [],
        packages: [],
        history: [],
        diagnostics: [],
        historyDiagnostics: [],
    };
    const entries = await sortedEntries(spec);
    for (const entry of entries) {
        const target = join(spec, entry.name);
        if (entry.isSymbolicLink()) {
            output.diagnostics.push(inventoryDiagnostic('MODULE_SPEC_SYMBOLIC_LINK', 'Normative specification paths cannot contain symbolic links.', portable(relative(root, target))));
            continue;
        }
        if (entry.isFile()) {
            const field = DIRECT_FILES.get(entry.name);
            if (!field) {
                output.diagnostics.push(inventoryDiagnostic('MODULE_SPEC_ARTIFACT_UNKNOWN', `Unknown top-level specification artifact: ${entry.name}`, portable(relative(root, target))));
                continue;
            }
            output[field] = moduleFile(root, spec, target);
            continue;
        }
        if (!entry.isDirectory() || !(entry.name in DIRECTORIES)) {
            output.diagnostics.push(inventoryDiagnostic('MODULE_SPEC_ARTIFACT_UNKNOWN', `Unknown top-level specification directory: ${entry.name}`, portable(relative(root, target))));
            continue;
        }
        const owner = entry.name;
        const files = await walkTypedDirectory(root, spec, target, owner, DIRECTORIES[owner], output.diagnostics);
        if (owner === 'api') {
            output.apiFragments.push(...files);
        }
        else if (owner === 'packages') {
            for (const file of files) {
                if (file.relative === 'packages/exceptions.ts')
                    output.packageExceptions = file;
                else
                    output.packages.push(file);
            }
        }
        else {
            output[owner].push(...files);
        }
    }
    const historyDirectory = join(dirname(spec), '.history');
    try {
        const historyMetadata = await lstat(historyDirectory);
        if (historyMetadata.isSymbolicLink()) {
            throw new Error('History directory cannot be a symbolic link.');
        }
        const canonicalHistory = await realpath(historyDirectory);
        if (!within(root, canonicalHistory))
            throw new Error('History directory escapes the catalog.');
        output.history.push(...(await walkHistoryDirectory(root, canonicalHistory, canonicalHistory, output.historyDiagnostics)));
    }
    catch (error) {
        if (!isMissing(error)) {
            output.historyDiagnostics.push(inventoryDiagnostic('HISTORY_DIRECTORY_INVALID', error instanceof Error ? error.message : String(error), portable(relative(root, historyDirectory))));
        }
    }
    return output;
}
async function walkTypedDirectory(root, spec, directory, owner, accepts, diagnostics) {
    const files = [];
    const entries = await sortedEntries(directory);
    if (entries.length === 0) {
        diagnostics.push(inventoryDiagnostic('MODULE_SPEC_DIRECTORY_EMPTY', `Remove the empty optional ${owner} directory.`, portable(relative(root, directory))));
    }
    for (const entry of entries) {
        const target = join(directory, entry.name);
        const source = portable(relative(root, target));
        if (entry.isSymbolicLink()) {
            diagnostics.push(inventoryDiagnostic('MODULE_SPEC_SYMBOLIC_LINK', 'Normative specification paths cannot contain symbolic links.', source));
        }
        else if (entry.isDirectory()) {
            files.push(...(await walkTypedDirectory(root, spec, target, owner, accepts, diagnostics)));
        }
        else if (!entry.isFile() || !accepts(entry.name)) {
            diagnostics.push(inventoryDiagnostic('MODULE_SPEC_FILE_INVALID', `Invalid ${owner} artifact: ${portable(relative(spec, target))}`, source));
        }
        else {
            files.push(moduleFile(root, spec, target));
        }
    }
    return files;
}
async function walkHistoryDirectory(root, base, directory, diagnostics) {
    const files = [];
    for (const entry of await sortedEntries(directory)) {
        const target = join(directory, entry.name);
        const source = portable(relative(root, target));
        if (entry.isSymbolicLink()) {
            diagnostics.push(inventoryDiagnostic('HISTORY_SYMBOLIC_LINK', 'History paths cannot contain symbolic links.', source));
        }
        else if (entry.isDirectory()) {
            files.push(...(await walkHistoryDirectory(root, base, target, diagnostics)));
        }
        else if (entry.isFile()) {
            files.push({
                absolute: target,
                relative: portable(relative(base, target)),
                source,
            });
        }
    }
    return files;
}
async function sortedEntries(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.sort((left, right) => compare(left.name, right.name));
}
function moduleFile(root, spec, absolute) {
    return {
        absolute,
        relative: portable(relative(spec, absolute)),
        source: portable(relative(root, absolute)),
    };
}
function inventoryDiagnostic(code, message, file) {
    return { code, message, file, line: 1, column: 1 };
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function isMissing(error) {
    return (!!error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT');
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=inventory.js.map