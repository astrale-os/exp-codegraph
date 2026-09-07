import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VerificationRunRequest, VerificationRunResponse } from '../qualification.ts';
export declare function handleVerificationHttp(request: IncomingMessage, response: ServerResponse, execute: (request: VerificationRunRequest, snapshot: `application:${string}`) => Promise<VerificationRunResponse>): Promise<boolean>;
