import type { TypeSpecApplicationSnapshotId } from '../application/index.ts';
import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts';
import type { ViewerQualification } from '../viewer-host/qualification.ts';
import type { CatalogSnapshot } from './catalog-snapshot.ts';
export interface ServerVerificationCheckpoint {
    readonly source: string;
    readonly revision: string;
    readonly inputs: string;
    readonly verification: ViewerQualification;
}
export interface ServerCatalogCheckpoint {
    load(snapshot: TypeSpecApplicationSnapshotId, adapter: ViewerAdapterManifest): Promise<CatalogSnapshot | undefined>;
    publish(snapshot: CatalogSnapshot): Promise<void>;
    loadVerifications(): Promise<readonly ServerVerificationCheckpoint[]>;
    publishVerifications(values: readonly ServerVerificationCheckpoint[]): Promise<void>;
    dispose(): Promise<void>;
}
/** Derived server transport cache; it has no authority over application or analysis state. */
export declare function createServerCatalogCheckpoint(root: string): Promise<ServerCatalogCheckpoint>;
