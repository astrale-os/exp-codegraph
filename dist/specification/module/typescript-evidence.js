import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourceRevision } from '../../source/file.js';
import { operationSnapshot, operationSnapshotNamespace, readSourceRevision, } from '../../source/operation-snapshot.js';
import { isAuthoringSpecifier } from './authoring-syntax.js';
import { visitModuleReferences } from './typescript-reference.js';
const resolutions = operationSnapshotNamespace('module-resolutions');
export function captureModuleTypeScriptEvidence(program, options, selectedSources = program.getSourceFiles()) {
    const sources = selectedSources;
    return {
        dependencies: sources
            .map((source) => ({
            file: canonicalFile(source.fileName),
            revision: sourceRevision(source.text),
        }))
            .sort((left, right) => compare(left.file, right.file)),
        resolutions: observeResolutions(sources, options),
    };
}
export async function moduleTypeScriptEvidenceCurrent(evidence, options) {
    const batchSize = 64;
    for (let index = 0; index < evidence.dependencies.length; index += batchSize) {
        const batch = evidence.dependencies.slice(index, index + batchSize);
        const revisions = await Promise.all(batch.map(({ file }) => readSourceRevision(file)));
        if (batch.some(({ revision }, offset) => revision !== revisions[offset]))
            return false;
    }
    return evidence.resolutions.every((expected) => {
        const current = resolveObserved(expected, options);
        return current === expected.resolvedFile;
    });
}
function observeResolutions(sources, options) {
    const values = [];
    for (const parsed of sources) {
        const file = canonicalFile(parsed.fileName);
        visitModuleReferences(parsed, (specifier, node, dynamic) => {
            if (dynamic)
                return;
            const mode = ts.getModeForUsageLocation(parsed, node, options);
            values.push(resolutionEvidence('module', file, specifier, mode, options));
        });
        for (const reference of parsed.referencedFiles) {
            values.push(resolutionEvidence('path', file, reference.fileName, undefined, options));
        }
        for (const reference of parsed.typeReferenceDirectives) {
            values.push(resolutionEvidence('type', file, reference.fileName, reference.resolutionMode, options));
        }
        // Compiler-owned lib directives resolve inside the immutable TypeScript installation. Their
        // loaded targets are already present in dependency evidence and content-validated above.
    }
    return values.sort((left, right) => compare(left.kind, right.kind) ||
        compare(left.containingFile, right.containingFile) ||
        compare(left.specifier, right.specifier) ||
        Number(left.mode ?? -1) - Number(right.mode ?? -1));
}
function resolutionEvidence(kind, containingFile, specifier, mode, options) {
    const identity = { kind, containingFile, specifier, mode };
    const resolvedFile = resolveObserved(identity, options);
    return { ...identity, ...(resolvedFile ? { resolvedFile } : {}) };
}
function resolveObserved(evidence, options) {
    const key = `${evidence.kind}\0${evidence.containingFile}\0${evidence.specifier}\0${evidence.mode ?? 'default'}`;
    const snapshot = operationSnapshot(resolutions);
    if (snapshot?.has(key))
        return snapshot.get(key) ?? undefined;
    const result = resolveFresh(evidence, options);
    snapshot?.set(key, result ?? null);
    return result;
}
function resolveFresh(evidence, options) {
    if (evidence.kind === 'path') {
        const target = resolve(dirname(evidence.containingFile), evidence.specifier);
        return ts.sys.fileExists(target) ? canonicalFile(target) : undefined;
    }
    if (evidence.kind === 'type') {
        const target = ts.resolveTypeReferenceDirective(evidence.specifier, evidence.containingFile, options, ts.sys, undefined, undefined, evidence.mode).resolvedTypeReferenceDirective?.resolvedFileName;
        return target ? canonicalFile(target) : undefined;
    }
    const containingFile = isAuthoringSpecifier(evidence.specifier)
        ? fileURLToPath(import.meta.url)
        : evidence.containingFile;
    const target = ts.resolveModuleName(evidence.specifier, containingFile, options, ts.sys, undefined, undefined, evidence.mode).resolvedModule?.resolvedFileName;
    return target ? canonicalFile(target) : undefined;
}
function canonicalFile(path) {
    const absolute = resolve(path);
    return ts.sys.realpath ? ts.sys.realpath(absolute) : absolute;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=typescript-evidence.js.map