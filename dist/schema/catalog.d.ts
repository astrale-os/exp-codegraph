import type { Diagnostic } from '../source/diagnostic.ts';
export interface CatalogSchemaResource {
    readonly source: string;
    readonly schema: unknown;
    /** Stable compiler base used for relative references; diagnostics continue to use source. */
    readonly resolutionBase?: string;
}
/** Compile every convention-profile schema as one closed catalog-local JSON Schema set. */
export declare function validateModuleSchemaCatalog(catalogRoot: string, resources: readonly CatalogSchemaResource[]): Diagnostic[];
