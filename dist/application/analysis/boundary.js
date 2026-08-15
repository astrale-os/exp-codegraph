import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { discoverModuleBinding } from '../../specification/module/binding.js';
/** Resolve implementation observations without adding them to normative specification identity. */
export async function resolveApplicationModuleBoundaries(inputRoot, specifications) {
    const root = await realpath(resolve(inputRoot));
    const boundaries = [];
    const diagnostics = [];
    for (const specification of [...specifications].sort((left, right) => left.source.localeCompare(right.source))) {
        const specDirectory = dirname(resolve(root, specification.source));
        const discovered = await discoverModuleBinding(root, specDirectory, specification.source);
        diagnostics.push(...discovered.diagnostics);
        if (!discovered.binding)
            continue;
        const binding = {
            ...discovered.binding,
            ...(specification.module.code?.internals.length
                ? { internals: specification.module.code.internals }
                : {}),
        };
        try {
            boundaries.push(await resolveBoundary(root, specDirectory, specification, binding, discovered.specifier));
        }
        catch (error) {
            diagnostics.push({
                code: 'APPLICATION_CODE_TARGET_INVALID',
                message: error instanceof Error ? error.message : String(error),
                file: specification.source,
                line: 1,
                column: 1,
            });
        }
    }
    const uniqueness = validateApplicationModuleBoundaries(boundaries);
    diagnostics.push(...uniqueness.diagnostics);
    return {
        boundaries: uniqueness.boundaries,
        diagnostics: deduplicateDiagnostics(diagnostics),
    };
}
async function resolveBoundary(root, specDirectory, specification, binding, specifier) {
    const project = await existing(root, specDirectory, binding.project, 'file');
    const moduleRoot = await existing(root, specDirectory, binding.root, 'directory');
    const entrypoint = await existing(root, specDirectory, binding.entrypoint, 'file');
    const facades = await Promise.all((binding.facades ?? []).map((path) => existing(root, specDirectory, path, 'file')));
    const aliases = await Promise.all((binding.aliases ?? []).map((path) => existing(root, specDirectory, path, 'file')));
    const internals = await Promise.all((binding.internals ?? []).map((path) => existing(root, specDirectory, path, 'file')));
    for (const target of [entrypoint, ...facades, ...aliases, ...internals]) {
        if (!within(moduleRoot, target)) {
            throw new Error('Every implementation entrypoint must be contained by its module root.');
        }
    }
    if (new Set([entrypoint, ...facades, ...aliases, ...internals]).size !==
        1 + facades.length + aliases.length + internals.length) {
        throw new Error('Implementation entrypoints must be canonically unique.');
    }
    return {
        id: specification.module.id,
        name: specifier ?? specification.module.name,
        project: portable(relative(root, project)),
        root: portable(relative(root, moduleRoot)) || '.',
        entrypoint: portable(relative(root, entrypoint)),
        facades: facades.map((path) => portable(relative(root, path))).sort(compare),
        aliases: aliases.map((path) => portable(relative(root, path))).sort(compare),
        internals: internals.map((path) => portable(relative(root, path))).sort(compare),
    };
}
async function existing(root, directory, input, kind) {
    if (!input || isAbsolute(input) || input.includes('\\')) {
        throw new Error('Implementation paths must be non-empty relative POSIX paths.');
    }
    const lexical = resolve(directory, input);
    if (!within(root, lexical))
        throw new Error('Implementation path escapes the repository root.');
    const canonical = await realpath(lexical);
    if (!within(root, canonical))
        throw new Error('Implementation path resolves outside the repository root.');
    const metadata = await stat(canonical);
    if (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory()) {
        throw new Error(`Implementation path is not a ${kind}: ${portable(relative(root, canonical))}`);
    }
    return canonical;
}
/** Reject ambiguous logical identities, canonical roots, and every entrypoint class generically. */
export function validateApplicationModuleBoundaries(values) {
    const byId = new Map();
    const diagnostics = [];
    const ambiguous = new Set();
    for (const value of values) {
        const existing = byId.get(value.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
            ambiguous.add(value.id);
            diagnostics.push(ambiguityDiagnostic(value, existing, 'module identity', value.id));
        }
        byId.set(value.id, value);
    }
    const owners = new Map();
    for (const boundary of byId.values()) {
        for (const [kind, path] of [
            ['module root', boundary.root],
            ...[boundary.entrypoint, ...boundary.facades, ...boundary.aliases, ...boundary.internals].map((entrypoint) => ['entrypoint', entrypoint]),
        ]) {
            const key = `${kind}\0${path}`;
            const existing = owners.get(key);
            if (!existing) {
                owners.set(key, boundary);
                continue;
            }
            if (existing.id === boundary.id)
                continue;
            ambiguous.add(existing.id);
            ambiguous.add(boundary.id);
            diagnostics.push(ambiguityDiagnostic(existing, boundary, kind, path));
            diagnostics.push(ambiguityDiagnostic(boundary, existing, kind, path));
        }
    }
    return {
        boundaries: [...byId.values()]
            .filter((boundary) => !ambiguous.has(boundary.id))
            .sort((left, right) => left.id.localeCompare(right.id)),
        diagnostics,
    };
}
function ambiguityDiagnostic(boundary, other, kind, value) {
    return {
        code: 'APPLICATION_CODE_TARGET_AMBIGUOUS',
        message: `Module ${boundary.id} and ${other.id} bind the same ${kind}: ${value}.`,
        file: boundary.id,
        line: 1,
        column: 1,
    };
}
function deduplicateDiagnostics(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = JSON.stringify([value.code, value.message, value.file, value.line, value.column]);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function within(root, target) {
    const path = relative(resolve(root), resolve(target));
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=boundary.js.map