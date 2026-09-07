import type { ApplicationCheckpoint, ApplicationCheckpointReference } from '../checkpoint/index.ts';
import type { FileWorkspaceCheckpointStore } from '../../workspace/checkpoint/index.ts';
export interface PortableNodeApplicationCheckpoint {
    readonly store: FileWorkspaceCheckpointStore;
    readonly sourceProof: string;
    readonly writable: boolean;
    readonly reference?: ApplicationCheckpointReference;
}
/** Compose worktree-local and proof-bound portable checkpoint stores behind one application port. */
export declare function createNodeApplicationCheckpoint(options: {
    readonly producerFingerprint: string;
    readonly local?: FileWorkspaceCheckpointStore;
    readonly portable?: PortableNodeApplicationCheckpoint;
}): ApplicationCheckpoint | undefined;
