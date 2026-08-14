import { AsyncLocalStorage } from 'node:async_hooks'

import { readBounded, sourceRevision } from './file.ts'

export interface OperationSnapshotNamespace<Value> {
  readonly key: symbol
  /** Invariant type marker; namespaces are otherwise runtime symbols. */
  readonly value?: (value: Value) => Value
}

type OperationSnapshot = Map<symbol, Map<string, unknown>>

const snapshots = new AsyncLocalStorage<OperationSnapshot>()
const sourceRevisions = operationSnapshotNamespace<Promise<string>>('source-revisions')

export function operationSnapshotNamespace<Value>(
  description: string,
): OperationSnapshotNamespace<Value> {
  return { key: Symbol(description) }
}

/** Run one coherent catalog operation with namespaced, operation-local evidence reuse. */
export function withOperationSnapshot<T>(operation: () => Promise<T>): Promise<T> {
	if (snapshots.getStore()) return operation()
  return snapshots.run(new Map(), operation)
}

/** Return an isolated operation-local value map, when a snapshot was established. */
export function operationSnapshot<Value>(
  namespace: OperationSnapshotNamespace<Value>,
): Map<string, Value> | undefined {
  const snapshot = snapshots.getStore()
  if (!snapshot) return
  const current = snapshot.get(namespace.key)
  if (current) return current as Map<string, Value>
  const created = new Map<string, Value>()
  snapshot.set(namespace.key, created as Map<string, unknown>)
  return created
}

/** Read and hash a source once within the current coherent catalog operation. */
export function readSourceRevision(file: string): Promise<string> {
  const snapshot = operationSnapshot(sourceRevisions)
  if (!snapshot) return readBounded(file).then(sourceRevision)
  const current = snapshot.get(file)
  if (current) return current
  const revision = readBounded(file).then(sourceRevision)
  snapshot.set(file, revision)
  return revision
}
