import type { RepositoryInventory } from '../model.ts';
import type { RepositorySourceService, RepositorySourceServiceOptions } from './model.ts';
export declare const DEFAULT_REPOSITORY_SOURCE_MAXIMUM_TEXT_BYTES: number;
/** Read text only when its bytes still match one immutable repository inventory. */
export declare function createRepositorySourceService(root: string, inventory: RepositoryInventory, options?: RepositorySourceServiceOptions): RepositorySourceService;
