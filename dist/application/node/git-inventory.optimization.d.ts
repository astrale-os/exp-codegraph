import type { RepositoryInventory, RepositoryInventoryOptions, SourceProof } from '../../repository/index.ts';
import type { GitExecutable } from './source-proof.ts';
interface GitSourceText {
    readonly path: string;
    readonly text: string;
    readonly bytes: number;
    readonly digest: string;
}
/** Materialize an exact canonical inventory from one already-admitted immutable Git tree. */
export declare function inventoryGitTree(git: GitExecutable, root: string, proof: Pick<SourceProof, 'headTree' | 'overlay'>, request: RepositoryInventoryOptions, inventory: (options: RepositoryInventoryOptions) => Promise<RepositoryInventory>): Promise<{
    readonly inventory: RepositoryInventory;
    readonly treeMs: number;
    readonly blobsMs: number;
    readonly projectionMs: number;
    readonly filesTraversed: number;
    readonly bytesTraversed: number;
    readonly bytesRead: number;
    readonly bytesHashed: number;
    readonly sourceTexts: readonly GitSourceText[];
}>;
/** Resolve and materialize one immutable HEAD tree while clean-worktree admission runs. */
export declare function inventoryGitHead(git: GitExecutable, root: string, request: RepositoryInventoryOptions, inventory: (options: RepositoryInventoryOptions) => Promise<RepositoryInventory>): Promise<Awaited<ReturnType<typeof inventoryGitTree>> & {
    readonly headTree: string;
}>;
export {};
