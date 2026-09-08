import type { SourceProofProvider } from '../../repository/index.ts';
import { inventoryRepository } from '../../repository/index.ts';
import { type FileWorkspaceCheckpointStore } from '../../workspace/checkpoint/index.ts';
export { repositoryDirectoryTopologyFingerprint } from './topology.ts';
export interface CheckpointedRepositoryInventoryOptions {
    readonly root: string;
    readonly store: FileWorkspaceCheckpointStore;
    readonly producerFingerprint: string;
    readonly inventory?: typeof inventoryRepository;
}
export interface NodeRepositoryInventoryOptions {
    readonly root: string;
    readonly inventory?: typeof inventoryRepository;
}
export interface GitRepositoryInventoryOptions extends NodeRepositoryInventoryOptions {
    readonly proof?: SourceProofProvider;
    readonly onDecision?: (decision: {
        readonly outcome: 'used' | 'fallback';
        readonly code: string;
        readonly durationMs: number;
        readonly proofMs?: number;
        readonly treeMs?: number;
        readonly blobsMs?: number;
        readonly projectionMs?: number;
        readonly filesTraversed?: number;
        readonly bytesTraversed?: number;
        readonly bytesRead?: number;
        readonly bytesHashed?: number;
    }) => void;
}
/** Use immutable Git blobs for a clean source-cold corpus; retain the canonical scanner otherwise. */
export declare function createGitRepositoryInventory(options: GitRepositoryInventoryOptions): typeof inventoryRepository;
/** Bind Node application inventory identity to relevant directories as well as regular files. */
export declare function createNodeRepositoryInventory(options: NodeRepositoryInventoryOptions): typeof inventoryRepository;
/**
 * Reuse an exact content inventory when the filesystem proves that no ordinary write, create,
 * delete, or rename occurred. Metadata is only a preflight: any uncertainty takes the canonical
 * byte-reading inventory path.
 */
export declare function createCheckpointedRepositoryInventory(options: CheckpointedRepositoryInventoryOptions): typeof inventoryRepository;
