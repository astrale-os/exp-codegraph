import { MAX_FILE_BYTES } from '../../../source/file.js';
import { SOURCE_EDIT_ENDPOINT, SOURCE_EDIT_HEADER } from '../editing.js';
export async function handleSourceEditHttp(request, response, execute) {
    if (!request.url)
        return false;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== SOURCE_EDIT_ENDPOINT)
        return false;
    if (request.method !== 'PUT') {
        response.setHeader('allow', 'PUT');
        send(response, 405, { status: 'error', message: 'Method not allowed.' });
        return true;
    }
    if (request.headers[SOURCE_EDIT_HEADER] !== '1') {
        send(response, 403, { status: 'error', message: 'Edit header missing.' });
        return true;
    }
    if (!sameOrigin(request)) {
        send(response, 403, { status: 'error', message: 'Cross-origin edits are not allowed.' });
        return true;
    }
    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'text/plain') {
        send(response, 415, { status: 'error', message: 'Content-Type must be text/plain.' });
        return true;
    }
    const revision = parseRevision(request.headers['if-match']);
    if (!revision) {
        send(response, 428, { status: 'error', message: 'A quoted source revision is required.' });
        return true;
    }
    const source = url.searchParams.get('source');
    const snapshot = applicationSnapshot(url);
    if (!source || !snapshot) {
        send(response, 404, { status: 'error', message: 'Specification source not found.' });
        return true;
    }
    try {
        const result = await execute({ source, revision, text: await requestText(request) }, snapshot);
        send(response, statusOf(result), result);
    }
    catch (error) {
        send(response, 400, {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
        });
    }
    return true;
}
function statusOf(result) {
    if (result.status === 'saved')
        return 200;
    if (result.status === 'conflict')
        return 409;
    if (result.message === 'Application snapshot changed; reload the catalog.')
        return 409;
    return result.message === 'Specification source not found.' ? 404 : 400;
}
function applicationSnapshot(url) {
    const values = url.searchParams.getAll('snapshot');
    const value = values.length === 1 ? values[0] : undefined;
    return value && /^application:[a-f\d]{64}$/u.test(value)
        ? value
        : undefined;
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
function parseRevision(value) {
    if (typeof value !== 'string')
        return;
    return /^"[a-f\d]{64}"$/.test(value) ? value.slice(1, -1) : undefined;
}
async function requestText(request) {
    const chunks = [];
    let size = 0;
    for await (const value of request) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > MAX_FILE_BYTES)
            throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes.`);
        chunks.push(chunk);
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
    }
    catch (error) {
        throw new Error('File is not valid UTF-8.', { cause: error });
    }
}
function send(response, status, value) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify(value));
}
//# sourceMappingURL=editing.js.map