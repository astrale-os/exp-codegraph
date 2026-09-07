import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SourceEditRequest, SourceEditResponse } from '../editing.ts';
export declare function handleSourceEditHttp(request: IncomingMessage, response: ServerResponse, execute: (request: SourceEditRequest, snapshot: `application:${string}`) => Promise<SourceEditResponse>): Promise<boolean>;
