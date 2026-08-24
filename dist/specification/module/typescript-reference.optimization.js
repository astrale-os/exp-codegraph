import { resolve } from 'node:path';
import typescript from 'typescript';
import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.js';
const canonicalPaths = operationSnapshotNamespace('module-typescript-canonical-paths');
/** Canonicalize a physical source once per coherent compiler operation. */
export function canonicalModuleTypeScriptPath(path) {
    const snapshot = operationSnapshot(canonicalPaths);
    const retained = snapshot?.get(path);
    if (retained)
        return retained;
    const absolute = resolve(path);
    const canonical = snapshot?.get(absolute) ??
        (typescript.sys.realpath ? typescript.sys.realpath(absolute) : absolute);
    snapshot?.set(path, canonical);
    snapshot?.set(absolute, canonical);
    return canonical;
}
/** Deduplicate immutable source spans in linear time while preserving the canonical first entry. */
export function deduplicateModuleSourceReferences(references) {
    const seen = new Set();
    return references.filter((reference) => {
        const key = `${reference.source}\0${reference.from}\0${reference.to}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=typescript-reference.optimization.js.map