import type { Diagnostic } from '../../source/diagnostic.ts';
import type { ImplementationBinding } from '../binding.ts';
export interface ModuleBindingDiscovery {
    readonly binding?: ImplementationBinding;
    readonly specifier?: string;
    readonly diagnostics: readonly Diagnostic[];
    readonly revision: string;
}
/** Infer a code target only from an unambiguous package entrypoint or canonical source entrypoint. */
export declare function discoverModuleBinding(catalogRoot: string, specDirectory: string, specSource: string): Promise<ModuleBindingDiscovery>;
