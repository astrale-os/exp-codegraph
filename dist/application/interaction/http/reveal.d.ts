import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SpecRevealResponse } from '../reveal.ts';
export declare function handleSpecRevealHttp(request: IncomingMessage, response: ServerResponse, execute: (source: string, snapshot: `application:${string}`) => Promise<SpecRevealResponse>): Promise<boolean>;
