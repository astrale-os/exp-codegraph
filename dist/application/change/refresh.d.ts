import type { RepositoryInventory } from '../../repository/index.ts';
import type { SpecificationSnapshot } from '../../specification/index.ts';
import { compileSpecificationSnapshots } from '../../specification/index.ts';
export interface RepositoryInventoryChange {
    readonly path: string;
    readonly kind: 'change' | 'add' | 'unlink';
}
/** Prove that a partial request corpus cannot gain or lose normative owners or dependency edges. */
export declare function canRetainPartialSpecificationCorpus(previous: readonly SpecificationSnapshot[], changes: readonly RepositoryInventoryChange[]): boolean;
/** Recompile exactly the proven normative owner closure and retain every unaffected snapshot. */
export declare function refreshSpecificationCorpus(root: string, directories: readonly string[], previous: readonly SpecificationSnapshot[], inventoryChanges: readonly RepositoryInventoryChange[], changedHints: readonly string[], compile: typeof compileSpecificationSnapshots): Promise<{
    readonly specifications: readonly SpecificationSnapshot[];
    readonly refreshedOwners: readonly string[];
    readonly compiled: number;
}>;
export declare function repositoryInventoryChanges(previous: RepositoryInventory, current: RepositoryInventory): readonly RepositoryInventoryChange[];
