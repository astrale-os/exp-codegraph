export interface OperationSnapshotNamespace<Value> {
    readonly key: symbol;
    /** Invariant type marker; namespaces are otherwise runtime symbols. */
    readonly value?: (value: Value) => Value;
}
export interface AdmittedSourceText {
    readonly text: string;
    readonly bytes: number;
    readonly digest: string;
}
export declare function operationSnapshotNamespace<Value>(description: string): OperationSnapshotNamespace<Value>;
/** Run one coherent catalog operation with namespaced, operation-local evidence reuse. */
export declare function withOperationSnapshot<T>(operation: () => Promise<T>): Promise<T>;
/** Return an isolated operation-local value map, when a snapshot was established. */
export declare function operationSnapshot<Value>(namespace: OperationSnapshotNamespace<Value>): Map<string, Value> | undefined;
/** Read and hash a source once within the current coherent catalog operation. */
export declare function readSourceRevision(file: string): Promise<string>;
/** Retain exact immutable text admitted by the operation's authoritative source provider. */
export declare function seedOperationSourceText(file: string, source: AdmittedSourceText): void;
/** Read already-admitted immutable source text without crossing the filesystem again. */
export declare function operationSourceText(file: string): AdmittedSourceText | undefined;
/** Read a source once, preferring exact text already admitted for this coherent operation. */
export declare function readOperationSourceText(file: string, maximumBytes?: number): Promise<string>;
