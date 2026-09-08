import type { TypeSpecApplicationReader } from '../application/index.ts';
import type { ViewerCatalog, ViewerSpecification } from '../viewer-host/specification.ts';
/**
 * Project one generation-pinned V2 application reader into the current browser presentation.
 * This adapter owns no semantic decisions: all observations come from pinned facts or verified
 * source reads, and the retired mutable catalog authority is never invoked.
 */
export declare function projectApplicationCatalog(root: string, reader: TypeSpecApplicationReader, options?: ApplicationCatalogProjectionOptions): Promise<ViewerCatalog>;
/** Project only the requested presentation records from one generation-pinned application reader. */
export declare function projectApplicationSpecifications(root: string, reader: TypeSpecApplicationReader, sources: readonly string[]): Promise<readonly ViewerSpecification[]>;
export interface ApplicationCatalogProjectionOptions {
    readonly previous?: ViewerCatalog;
    readonly refresh?: readonly string[];
}
