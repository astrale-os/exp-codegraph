import type { ApiCatalogIndex } from '../api/ownership.ts';
import type { ViewerSpecification } from '../viewer-host/specification.ts';
import type { CatalogSemanticReference, CatalogSemanticReferences } from '../viewer-host/catalog.ts';
export interface CatalogReferenceProjection {
    readonly semanticReferences?: CatalogSemanticReferences;
    readonly documents: ReadonlyMap<object, readonly CatalogSemanticReference[]>;
}
/** Resolve one immutable catalog generation without adding browser-side analysis work. */
export declare function catalogReferenceProjection(spec: ViewerSpecification, index: ApiCatalogIndex): CatalogReferenceProjection;
