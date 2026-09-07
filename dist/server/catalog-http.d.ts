import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CatalogSourcePayload, CatalogSpecPayload } from '../viewer-host/catalog.ts';
export interface CatalogPayloadLookup {
    spec(source: string, revision: string): CatalogSpecPayload | undefined;
    source(key: string): CatalogSourcePayload | undefined;
}
/** Serve immutable catalog payloads by exact content revision. */
export declare function handleCatalogPayloadHttp(request: IncomingMessage, response: ServerResponse, lookup: CatalogPayloadLookup): boolean;
