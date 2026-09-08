import type { ApplicationCheckpointReference } from '../../application/checkpoint/index.ts';
import type { FileWorkspaceCheckpointStore } from '../../workspace/checkpoint/index.ts';
import type { SemanticPackLoad, StoredCheckCatalog, StoredCheckResult } from './model.ts';
export { semanticPackScope } from './identity.ts';
export declare function publishSemanticPack(store: FileWorkspaceCheckpointStore, scope: string, result: StoredCheckResult, family: string, sourceProof: string, options?: {
    readonly catalog?: StoredCheckCatalog;
    readonly application?: ApplicationCheckpointReference;
}): Promise<import("../acceleration.ts").CliAccelerationEvent>;
export declare function loadSemanticPack(store: FileWorkspaceCheckpointStore, scope: string, expectation: {
    readonly producerFingerprint: string;
    readonly sourceProof: string;
    readonly request: string;
    readonly family: string;
    readonly repository: string;
}, allowCatalog: boolean): Promise<SemanticPackLoad>;
export declare function portableApplicationReference(store: FileWorkspaceCheckpointStore, producerFingerprint: string, sourceProof: string, repository: string, inventory: string, exclude: readonly string[]): Promise<ApplicationCheckpointReference | undefined>;
