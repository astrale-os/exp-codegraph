import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HistoryResource } from '../specification/resource/index.ts';
export interface HistoryResourceLookup {
    resource(source: string, revision: string): HistoryResource | undefined;
}
/** Serve only a currently catalogued inert history resource at its expected content revision. */
export declare function handleHistoryResourceHttp(request: IncomingMessage, response: ServerResponse, root: string, lookup: HistoryResourceLookup): Promise<boolean>;
