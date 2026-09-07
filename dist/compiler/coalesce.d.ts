import type { ApiBatchCompiler, ApiCompiler } from './contract.ts';
export interface ApiCompilerCoalescingOptions {
    readonly schedule?: (flush: () => void) => void;
}
/**
 * Adapt a batch compiler to the ordinary compiler contract.
 *
 * Calls made in the same event-loop turn form one semantic compilation session. The batch
 * backend remains replaceable; callers and resource loaders retain the single-entry contract.
 */
export declare function createCoalescingApiCompiler(compiler: ApiBatchCompiler, options?: ApiCompilerCoalescingOptions): ApiCompiler;
