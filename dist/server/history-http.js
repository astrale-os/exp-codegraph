import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { HISTORY_RESOURCE_ENDPOINT } from '../viewer-host/catalog.js';
const READ_CHUNK_BYTES = 64 * 1_024;
/** Serve only a currently catalogued inert history resource at its expected content revision. */
export async function handleHistoryResourceHttp(request, response, root, lookup) {
    if (!request.url)
        return false;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== HISTORY_RESOURCE_ENDPOINT)
        return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('allow', 'GET, HEAD');
        reject(response, 405, 'Method not allowed.');
        return true;
    }
    const source = one(url, 'source');
    const revision = digest(url, 'revision');
    if (!source || !revision || unsupported(url, ['source', 'revision'])) {
        reject(response, 400, 'Exactly one history source and revision are required.');
        return true;
    }
    const resource = lookup.resource(source, revision);
    if (!resource) {
        reject(response, 404, 'History resource not found.');
        return true;
    }
    const target = resolve(root, source);
    if (!within(resolve(root), target)) {
        reject(response, 403, 'History resource escapes the catalog.');
        return true;
    }
    const verified = await openVerifiedHistory(target, resource);
    if (!verified) {
        reject(response, 409, 'History resource changed; reload the specification catalog.');
        return true;
    }
    const range = byteRange(request.headers.range, verified.size);
    if (range === 'invalid') {
        await verified.handle.close();
        response.statusCode = 416;
        response.setHeader('content-range', `bytes */${verified.size}`);
        response.end();
        return true;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, verified.size - 1);
    const length = verified.size ? end - start + 1 : 0;
    response.statusCode = range ? 206 : 200;
    response.setHeader('content-type', servedMediaType(resource));
    response.setHeader('content-length', String(length));
    response.setHeader('accept-ranges', 'bytes');
    response.setHeader('etag', `"${revision}"`);
    response.setHeader('cache-control', 'private, max-age=0, must-revalidate');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('cross-origin-resource-policy', 'same-origin');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-disposition', `${resource.presentation === 'binary' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(resource.name)}`);
    if (range)
        response.setHeader('content-range', `bytes ${start}-${end}/${verified.size}`);
    if (request.method === 'HEAD' || verified.size === 0) {
        await verified.handle.close();
        response.end();
        return true;
    }
    const stream = verified.handle.createReadStream({ start, end, autoClose: true });
    response.once('close', () => stream.destroy());
    stream.once('error', () => response.destroy());
    stream.pipe(response);
    return true;
}
async function openVerifiedHistory(target, resource) {
    let handle;
    try {
        handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = await handle.stat();
        if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size !== resource.size)
            throw new Error('History metadata changed.');
        const hash = createHash('sha256');
        let offset = 0;
        while (offset < before.size) {
            const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, before.size - offset));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
            if (!bytesRead)
                throw new Error('History resource ended while it was verified.');
            hash.update(chunk.subarray(0, bytesRead));
            offset += bytesRead;
        }
        const after = await handle.stat();
        if (before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            hash.digest('hex') !== resource.revision)
            throw new Error('History resource changed while it was verified.');
        return { handle, size: before.size };
    }
    catch {
        await handle?.close().catch(() => undefined);
        return;
    }
}
function servedMediaType(resource) {
    return resource.presentation === 'markdown' || resource.presentation === 'text'
        ? 'text/plain; charset=utf-8'
        : resource.mediaType;
}
function byteRange(value, size) {
    if (value === undefined)
        return;
    const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
    if (!match || size === 0)
        return 'invalid';
    const [, startText, endText] = match;
    if (!startText && !endText)
        return 'invalid';
    let start;
    let end;
    if (!startText) {
        const suffix = Number(endText);
        if (!Number.isSafeInteger(suffix) || suffix <= 0)
            return 'invalid';
        start = Math.max(0, size - suffix);
        end = size - 1;
    }
    else {
        start = Number(startText);
        end = endText ? Number(endText) : size - 1;
        if (!Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start >= size ||
            end < start) {
            return 'invalid';
        }
        end = Math.min(end, size - 1);
    }
    return { start, end };
}
function one(url, name) {
    const values = url.searchParams.getAll(name);
    const value = values.length === 1 ? values[0] : undefined;
    return value && !value.includes('\0') ? value : undefined;
}
function digest(url, name) {
    const value = one(url, name);
    return value && /^[a-f\d]{64}$/u.test(value) ? value : undefined;
}
function unsupported(url, supported) {
    const allowed = new Set(supported);
    return [...url.searchParams.keys()].some((key) => !allowed.has(key));
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function reject(response, status, message) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(JSON.stringify({ status: 'error', message }));
}
//# sourceMappingURL=history-http.js.map