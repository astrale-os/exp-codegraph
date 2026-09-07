import type { ApplicationModuleBindingCompilation, ApplicationModuleBindingRequest } from '../analysis/binding/index.ts';
/** Compile compact explicit bindings without constructing an implementation declaration graph. */
export declare function compileApplicationModuleBindings(options: {
    readonly root: string;
    readonly requests: readonly ApplicationModuleBindingRequest[];
    readonly ownershipRequests?: readonly ApplicationModuleBindingRequest[];
}): ApplicationModuleBindingCompilation;
