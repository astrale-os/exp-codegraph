import { AsyncLocalStorage } from 'node:async_hooks'

import { resolve } from 'node:path'

import { MAX_FILE_BYTES, readBounded, sourceRevision } from './file.ts'

export interface OperationSnapshotNamespace<Value> {
  readonly key: symbol
  /** Invariant type marker; namespaces are otherwise runtime symbols. */
  readonly value?: (value: Value) => Value
}

type OperationSnapshot = Map<symbol, Map<string, unknown>>

const snapshots = new AsyncLocalStorage<OperationSnapshot>()
const sourceRevisions = operationSnapshotNamespace<Promise<string>>('source-revisions')
const admittedSourceTexts = operationSnapshotNamespace<AdmittedSourceText>(
  'admitted-source-texts',
)

export interface AdmittedSourceText {
  readonly text: string
  readonly bytes: number
  readonly digest: string
}

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

/** Retain exact immutable text admitted by the operation's authoritative source provider. */
export function seedOperationSourceText(file: string, source: AdmittedSourceText): void {
  const values = operationSnapshot(admittedSourceTexts)
  if (!values) return
  const key = resolve(file)
  const current = values.get(key)
  if (
    current &&
    (current.bytes !== source.bytes || current.digest !== source.digest || current.text !== source.text)
  ) {
    throw new Error(`Operation source text changed after admission: ${key}`)
  }
  values.set(key, source)
}

/** Read already-admitted immutable source text without crossing the filesystem again. */
export function operationSourceText(file: string): AdmittedSourceText | undefined {
  return operationSnapshot(admittedSourceTexts)?.get(resolve(file))
}

/** Read a source once, preferring exact text already admitted for this coherent operation. */
export async function readOperationSourceText(
  file: string,
  maximumBytes: number = MAX_FILE_BYTES,
): Promise<string> {
  const admitted = operationSourceText(file)
  if (!admitted) return readBounded(file, maximumBytes)
  if (admitted.bytes > maximumBytes) throw new Error(`File exceeds ${maximumBytes} bytes.`)
  return admitted.text
}
