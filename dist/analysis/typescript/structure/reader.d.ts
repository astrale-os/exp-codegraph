import { type StructuralIndex, type StructuralRevision } from './owner.ts';
import type { TypeScriptStructuralReader } from './model.ts';
interface Scope {
    readonly signal?: AbortSignal;
    check(): void;
    selection(revision: StructuralRevision, keys: readonly string[]): void;
}
/** Project and computation readers use the same selections and negative-read witnesses. */
export declare function createTypeScriptStructuralReader(load: () => Promise<StructuralIndex>, scope?: Scope): TypeScriptStructuralReader & {
    dispose(): void;
};
export {};
