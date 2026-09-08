import type { Plugin } from 'vite';
import type { TypeSpecApplicationReader, TypeSpecApplicationService } from '../application/index.ts';
import type { AnalysisTelemetrySink } from '../analysis/index.ts';
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts';
import type { SourceEditRequest, SourceEditResponse } from '../application/interaction/editing.ts';
import type { SpecRevealResponse } from '../application/interaction/reveal.ts';
import type { ViewerCatalog } from '../viewer-host/specification.ts';
export declare const CATALOG_INDEX_ID = "virtual:spec-catalog-index";
export interface LiveSpecsServices {
    createApplication(root: string, cache: boolean): Promise<TypeSpecApplicationService>;
    projectCatalog(root: string, reader: TypeSpecApplicationReader, options?: import('./application-catalog.ts').ApplicationCatalogProjectionOptions): Promise<ViewerCatalog>;
    editSource(root: string, reader: TypeSpecApplicationReader, request: SourceEditRequest): Promise<SourceEditResponse>;
    revealSpecification(root: string, reader: TypeSpecApplicationReader, source: string): Promise<SpecRevealResponse>;
}
export interface LiveSpecsOptions {
    root: string;
    allowedRoots: string[];
    verify: boolean;
    cache?: boolean;
    native?: CodegraphApplicationSessionOptions;
    telemetry?: AnalysisTelemetrySink;
    services?: LiveSpecsServices;
}
export declare function createLiveSpecsPlugin(options: LiveSpecsOptions): Plugin;
