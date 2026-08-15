import { AsyncLocalStorage } from 'node:async_hooks';
import { readBounded, sourceRevision } from './file.js';
const snapshots = new AsyncLocalStorage();
const sourceRevisions = operationSnapshotNamespace('source-revisions');
export function operationSnapshotNamespace(description) {
    return { key: Symbol(description) };
}
/** Run one coherent catalog operation with namespaced, operation-local evidence reuse. */
export function withOperationSnapshot(operation) {
    if (snapshots.getStore())
        return operation();
    return snapshots.run(new Map(), operation);
}
/** Return an isolated operation-local value map, when a snapshot was established. */
export function operationSnapshot(namespace) {
    const snapshot = snapshots.getStore();
    if (!snapshot)
        return;
    const current = snapshot.get(namespace.key);
    if (current)
        return current;
    const created = new Map();
    snapshot.set(namespace.key, created);
    return created;
}
/** Read and hash a source once within the current coherent catalog operation. */
export function readSourceRevision(file) {
    const snapshot = operationSnapshot(sourceRevisions);
    if (!snapshot)
        return readBounded(file).then(sourceRevision);
    const current = snapshot.get(file);
    if (current)
        return current;
    const revision = readBounded(file).then(sourceRevision);
    snapshot.set(file, revision);
    return revision;
}
//# sourceMappingURL=operation-snapshot.js.map