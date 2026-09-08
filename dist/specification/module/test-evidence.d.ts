import type { Diagnostic } from '../../source/diagnostic.ts';
import type { LawResource, StateResource } from '../resource/index.ts';
interface ResolvedEvidence {
    readonly laws: readonly LawResource[];
    readonly states: readonly StateResource[];
    readonly diagnostics: readonly Diagnostic[];
}
/** Resolve exact Vitest test declarations without importing or executing test code. */
export declare function resolveTestEvidence(root: string, moduleRoot: string, laws: readonly LawResource[], states: readonly StateResource[]): Promise<ResolvedEvidence>;
export {};
