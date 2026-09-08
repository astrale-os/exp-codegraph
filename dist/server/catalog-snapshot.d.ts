import type { CatalogIndex, CatalogSourcePayload, CatalogSpecPayload } from '../viewer-host/catalog.ts';
import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts';
import type { ViewerQualification } from '../viewer-host/qualification.ts';
import type { ViewerCatalog, ViewerSpecification } from '../viewer-host/specification.ts';
import { type ApiCatalogSpecification, type ApiOwnershipModel } from '../api/ownership.ts';
export interface CatalogSnapshot {
    readonly index: CatalogIndex;
    readonly indexModule: string;
    readonly specs: ReadonlyMap<string, CatalogSpecPayload>;
    readonly sources: ReadonlyMap<string, CatalogSourcePayload>;
    readonly inputs: ReadonlyMap<string, ViewerSpecification>;
    readonly projection: CatalogProjectionContext;
    readonly topology: string;
}
export interface CatalogProjectionModule {
    readonly id: string;
    readonly name: string;
    readonly declarationPointer: string;
    readonly api?: {
        readonly model: ApiOwnershipModel;
    };
    readonly imports: readonly {
        readonly key: string;
        readonly source: string;
    }[];
}
export interface CatalogProjectionSpecification extends ApiCatalogSpecification {
    readonly modules: readonly CatalogProjectionModule[];
}
/** Small global context required to project one changed Spec without hydrating the whole catalog. */
export interface CatalogProjectionContext {
    readonly specifications: readonly CatalogProjectionSpecification[];
    readonly sourceKeys: readonly {
        readonly source: string;
        readonly keys: readonly string[];
    }[];
}
/** Reconstruct the small delta-projection context from persisted immutable payloads. */
export declare function catalogProjectionFromPayloads(index: CatalogIndex, payloads: ReadonlyMap<string, CatalogSpecPayload>): CatalogProjectionContext;
/** Build the immutable browser projection of one already-coherent server Catalog. */
export declare function createCatalogSnapshot(catalog: ViewerCatalog, adapterManifest: ViewerAdapterManifest, applicationSnapshot?: `application:${string}`, previous?: CatalogSnapshot): CatalogSnapshot;
/**
 * Patch one restored transport snapshot from changed presentation records.
 * Returns undefined when global API/dependency ownership changed and a full projection is required.
 */
export declare function updateCatalogSnapshot(previous: CatalogSnapshot, changed: readonly ViewerSpecification[], sources: readonly string[], diagnostics: ViewerCatalog['diagnostics'], adapterManifest: ViewerAdapterManifest, applicationSnapshot: `application:${string}`): CatalogSnapshot | undefined;
/** Overlay independently persisted verification onto an exact restored transport snapshot. */
export declare function restoreCatalogSnapshotVerifications(previous: CatalogSnapshot, records: readonly {
    readonly source: string;
    readonly revision: string;
    readonly verification: ViewerQualification;
}[], adapterManifest: ViewerAdapterManifest): CatalogSnapshot;
export declare function catalogProjectionTopology(specifications: readonly CatalogProjectionSpecification[]): string;
export declare function specPayloadKey(source: string, revision: string): string;
export declare function createCatalogIndexModule(index: CatalogIndex, manifest: ViewerAdapterManifest): string;
