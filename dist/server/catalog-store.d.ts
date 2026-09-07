import type { CatalogSourcePayload, CatalogSpecPayload } from '../viewer-host/catalog.ts';
import type { CatalogSnapshot } from './catalog-snapshot.ts';
export interface CatalogPublication {
    readonly changed: boolean;
    readonly generation: string;
    readonly changedSpecs: readonly string[];
    readonly removedSpecs: readonly string[];
}
export interface CatalogSnapshotStoreOptions {
    readonly specCapacity?: number;
    readonly sourceCapacity?: number;
}
/** Retain the current snapshot plus a bounded content-addressed payload history for HMR races. */
export declare class CatalogSnapshotStore {
    #private;
    constructor(options?: CatalogSnapshotStoreOptions);
    get current(): CatalogSnapshot | undefined;
    publish(snapshot: CatalogSnapshot): CatalogPublication;
    spec(source: string, revision: string): CatalogSpecPayload | undefined;
    source(key: string): CatalogSourcePayload | undefined;
}
