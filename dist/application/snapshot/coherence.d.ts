import type { RepositoryInventory } from '../../repository/index.ts';
import type { SpecificationSnapshot } from '../../specification/index.ts';
/** Refuse to publish a normative snapshot compiled from bytes outside the pinned inventory. */
export declare function assertSpecificationInventory(specifications: readonly SpecificationSnapshot[], inventory: RepositoryInventory): void;
