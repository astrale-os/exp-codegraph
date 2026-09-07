import type { RepositoryInventory } from '../../repository/index.ts';
type RepositoryFile = RepositoryInventory['files'][number];
export interface ApplicationObservationInventoryIndex {
    readonly byPath: ReadonlyMap<string, RepositoryFile>;
    readonly historyByRoot: ReadonlyMap<string, readonly RepositoryFile[]>;
}
/** Index immutable inventory paths once for every owner observation in the operation. */
export declare function indexApplicationObservationInventory(inventory: RepositoryInventory): ApplicationObservationInventoryIndex;
/** Schedule independent owner reads concurrently while retaining canonical input order. */
export declare function mapApplicationObservationOwners<Input, Output>(inputs: readonly Input[], operation: (input: Input) => Promise<Output>): Promise<readonly Output[]>;
export {};
