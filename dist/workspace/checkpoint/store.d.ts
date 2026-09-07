import type { FileWorkspaceCheckpointStore, FileWorkspaceCheckpointStoreOptions } from './model.ts';
/** Create a generic advisory filesystem-backed checkpoint store. */
export declare function createFileWorkspaceCheckpointStore(options: FileWorkspaceCheckpointStoreOptions): FileWorkspaceCheckpointStore;
