import type { ApplicationModuleBindingCompilation, ApplicationModuleBindingRequest } from '../analysis/binding/index.ts';
/** Execute compatible binding Programs serially so their compiler heaps cannot accumulate. */
export declare function compileApplicationModuleBindingsIsolated(options: {
    readonly root: string;
    readonly requests: readonly ApplicationModuleBindingRequest[];
    readonly ownershipRequests?: readonly ApplicationModuleBindingRequest[];
    readonly signal?: AbortSignal;
}): Promise<ApplicationModuleBindingCompilation>;
