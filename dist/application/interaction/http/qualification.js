import { VERIFICATION_ENDPOINT, VERIFICATION_HEADER, VERIFICATION_PROTOCOL } from '../qualification.js';
const MAX_REQUEST_BYTES = 16 * 1024;
export async function handleVerificationHttp(request, response, execute) {
    if (!request.url)
        return false;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== VERIFICATION_ENDPOINT)
        return false;
    if (request.method !== 'POST') {
        response.setHeader('allow', 'POST');
        reject(response, 405, 'REQUEST_INVALID', 'Method not allowed.');
        return true;
    }
    if (request.headers[VERIFICATION_HEADER] !== '1') {
        reject(response, 403, 'REQUEST_INVALID', 'Verification header missing.');
        return true;
    }
    if (!sameOrigin(request)) {
        reject(response, 403, 'REQUEST_INVALID', 'Cross-origin verification is not allowed.');
        return true;
    }
    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
        reject(response, 415, 'REQUEST_INVALID', 'Content-Type must be application/json.');
        return true;
    }
    let input;
    const snapshots = url.searchParams.getAll('snapshot');
    if (snapshots.length !== 1 || !/^application:[a-f\d]{64}$/u.test(snapshots[0])) {
        reject(response, 400, 'REQUEST_INVALID', 'One application snapshot is required.');
        return true;
    }
    try {
        input = parseRequest(await requestJson(request));
    }
    catch (error) {
        reject(response, 400, 'REQUEST_INVALID', error instanceof Error ? error.message : String(error));
        return true;
    }
    try {
        const result = await execute(input, snapshots[0]);
        send(response, result.status === 'completed' ? 200 : rejectionStatus(result.code), result);
    }
    catch (error) {
        reject(response, 500, 'EXECUTION_FAILED', error instanceof Error ? error.message : String(error));
    }
    return true;
}
function parseRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Verification request must be an object.');
    }
    const input = value;
    const unknown = Object.keys(input).find((key) => key !== 'protocol' && key !== 'source' && key !== 'revision');
    if (unknown)
        throw new Error(`Verification request contains unsupported property ${unknown}.`);
    if (input.protocol !== VERIFICATION_PROTOCOL) {
        throw new Error('Verification protocol is not supported.');
    }
    if (typeof input.source !== 'string' ||
        input.source.length === 0 ||
        input.source.includes('\0')) {
        throw new Error('Verification source must be a non-empty string.');
    }
    if (typeof input.revision !== 'string' || !/^[a-f\d]{64}$/.test(input.revision)) {
        throw new Error('Verification revision must be a SHA-256 digest.');
    }
    return { protocol: VERIFICATION_PROTOCOL, source: input.source, revision: input.revision };
}
async function requestJson(request) {
    const chunks = [];
    let size = 0;
    for await (const value of request) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES)
            throw new Error('Verification request is too large.');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    }
    catch (error) {
        throw new Error('Verification request must be valid UTF-8 JSON.', { cause: error });
    }
}
function sameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin)
        return true;
    try {
        return new URL(origin).host === request.headers.host;
    }
    catch {
        return false;
    }
}
function rejectionStatus(code) {
    if (code === 'SOURCE_CHANGED')
        return 409;
    if (code === 'SOURCE_NOT_FOUND' || code === 'VERIFIER_MISSING')
        return 404;
    if (code === 'SPEC_INVALID')
        return 422;
    return 500;
}
function reject(response, status, code, message) {
    send(response, status, { protocol: VERIFICATION_PROTOCOL, status: 'rejected', code, message });
}
function send(response, status, value) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify(value));
}
//# sourceMappingURL=qualification.js.map