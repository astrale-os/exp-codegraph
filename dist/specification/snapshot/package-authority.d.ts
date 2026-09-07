import type { Diagnostic } from '../../source/diagnostic.ts';
import type { SpecificationPackageAuthority } from './model.ts';
import type { ModuleFileInventory } from '../module/inventory.ts';
export interface LoadedPackageAuthority {
    readonly authority: SpecificationPackageAuthority;
    readonly diagnostics: readonly Diagnostic[];
}
/** Resolve the one package-root specification that governs every nested semantic module. */
export declare function loadSpecificationPackageAuthority(catalogRoot: string, moduleRoot: string, localInventory: ModuleFileInventory): Promise<LoadedPackageAuthority>;
