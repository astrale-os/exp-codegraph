import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sourceRevision } from '../../source/file.js';
import { operationSnapshot, operationSnapshotNamespace, readSourceRevision, } from '../../source/operation-snapshot.js';
import { isAuthoringSpecifier } from './authoring-syntax.js';
import { canonicalModuleTypeScriptPath } from './typescript-reference.optimization.js';
import { visitModuleReferences } from './typescript-reference.js';
const resolutions = operationSnapshotNamespace('module-resolutions');
const canonicalFile = canonicalModuleTypeScriptPath;
export function captureModuleTypeScriptEvidence(program, options, selectedSources = program.getSourceFiles(), observed) {
    const sources = selectedSources;
    return {
        sources: sources.map((source) => ({
            dependency: {
                file: canonicalFile(source.fileName),
                revision: sourceRevision(source.text),
            },
            resolutions: observeResolutions([source], options, observed),
        })).sort((left, right) => compare(left.dependency.file, right.dependency.file)),
    };
}
export async function moduleTypeScriptEvidenceCurrent(evidence, options) {
    const batchSize = 64;
    for (let index = 0; index < evidence.sources.length; index += batchSize) {
        const batch = evidence.sources.slice(index, index + batchSize);
        const revisions = await Promise.all(batch.map(({ dependency }) => readSourceRevision(dependency.file)));
        if (batch.some(({ dependency }, offset) => dependency.revision !== revisions[offset]))
            return false;
    }
    return evidence.sources.every(({ resolutions }) => resolutions.every((expected) => resolveObserved(expected, options) === expected.resolvedFile));
}
function observeResolutions(sources, options, observed) {
    const values = [];
    for (const parsed of sources) {
        const file = canonicalFile(parsed.fileName);
        visitModuleReferences(parsed, (specifier, node, dynamic) => {
            if (dynamic)
                return;
            const mode = ts.getModeForUsageLocation(parsed, node, options);
            values.push(resolutionEvidence('module', file, specifier, mode, options, observed));
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
function resolutionEvidence(kind, containingFile, specifier, mode, options, observed) {
    const identity = { kind, containingFile, specifier, mode };
    const key = moduleTypeScriptResolutionKey(kind, containingFile, specifier, mode);
    const resolvedFile = observed?.has(key) ? observed.get(key) ?? undefined : resolveObserved(identity, options);
    return { ...identity, ...(resolvedFile ? { resolvedFile } : {}) };
}
function resolveObserved(evidence, options) {
    const key = moduleTypeScriptResolutionKey(evidence.kind, evidence.containingFile, evidence.specifier, evidence.mode);
    const snapshot = operationSnapshot(resolutions);
    if (snapshot?.has(key))
        return snapshot.get(key) ?? undefined;
    const result = resolveFresh(evidence, options);
    snapshot?.set(key, result ?? null);
    return result;
}
export function moduleTypeScriptResolutionKey(kind, containingFile, specifier, mode) {
    return `${kind}\0${containingFile}\0${specifier}\0${mode ?? 'default'}`;
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
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=typescript-evidence.js.map