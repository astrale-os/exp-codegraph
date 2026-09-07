import type { AnalysisGenerationId, ProjectUniverseId } from '../../analysis/index.ts';
import type { FileWorkspaceCheckpointStore } from '../../workspace/checkpoint/index.ts';
import type { ApplicationCheckpoint, ApplicationCheckpointExpectation, ApplicationCheckpointManifestAdmission, ApplicationCheckpointManifestExpectation } from './model.ts';
import type { TypeSpecApplicationSnapshot } from '../model.ts';
interface ApplicationCheckpointOptions {
    readonly store: FileWorkspaceCheckpointStore;
    readonly producerFingerprint: string;
}
/** Bind application identities and schemas to the generic content-addressed checkpoint store. */
export declare function createApplicationCheckpoint(options: ApplicationCheckpointOptions): ApplicationCheckpoint;
export declare function applicationCheckpointCorpus(exclude: readonly string[]): string;
export declare function applicationCheckpointScope(expectation: Pick<ApplicationCheckpointExpectation, 'corpus' | 'sourceProof'>): string;
export declare function admitApplicationCheckpointManifest(options: ApplicationCheckpointOptions, expectation: ApplicationCheckpointManifestExpectation): Promise<ApplicationCheckpointManifestAdmission>;
/** Restore exact generation identities without exposing physical database identifiers. */
export declare function checkpointGenerations(snapshot: TypeSpecApplicationSnapshot): ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>;
export {};
