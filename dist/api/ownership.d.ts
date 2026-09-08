import type { ObservedDeclaration, ObservedExport } from '../analysis/typescript/surface/model.ts';
export type ApiOwnershipDeclaration = Pick<ObservedDeclaration, 'identity' | 'location'>;
export interface ApiOwnershipModel {
    readonly entrypoint: string;
    readonly surface: {
        readonly declarations: readonly ApiOwnershipDeclaration[];
        readonly exports: readonly Pick<ObservedExport, 'declaration' | 'path'>[];
    };
}
export interface ApiCatalogModule {
    readonly id: string;
    readonly name: string;
    readonly declarationPointer: string;
    readonly api?: {
        readonly model?: ApiOwnershipModel;
    };
}
export interface ApiCatalogSpecification {
    readonly source: string;
    readonly modules: readonly ApiCatalogModule[];
}
export interface ApiCatalog {
    readonly specs: readonly ApiCatalogSpecification[];
}
export interface ApiDeclarationOwner {
    readonly spec: ApiCatalogSpecification;
    readonly module: ApiCatalogModule;
    readonly declaration: ApiOwnershipDeclaration;
}
export interface ApiCatalogIndex {
    readonly owner: ReadonlyMap<string, ApiDeclarationOwner>;
    readonly declaration: ReadonlyMap<string, ApiOwnershipDeclaration>;
    readonly exportsByModule: ReadonlyMap<string, ReadonlySet<string>>;
}
/** Resolve every observed API declaration to the most specific owning module in a catalog. */
export declare function indexCatalogApis(catalog: ApiCatalog): ApiCatalogIndex;
