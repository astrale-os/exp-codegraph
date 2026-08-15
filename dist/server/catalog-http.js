import { CATALOG_SOURCE_ENDPOINT, CATALOG_SPEC_ENDPOINT } from '../viewer-host/catalog.js';
/** Serve immutable catalog payloads by exact content revision. */
export function handleCatalogPayloadHttp(request, response, lookup) {
    if (!request.url)
        return false;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== CATALOG_SPEC_ENDPOINT && url.pathname !== CATALOG_SOURCE_ENDPOINT) {
        return false;
    }
    if (request.method !== 'GET') {
        response.setHeader('allow', 'GET');
        reject(response, 405, 'Method not allowed.');
        return true;
    }
    if (url.pathname === CATALOG_SPEC_ENDPOINT) {
        const source = one(url, 'source');
        const revision = digest(url, 'revision');
        if (!source || !revision || unsupported(url, ['source', 'revision'])) {
            reject(response, 400, 'Exactly one specification source and revision are required.');
            return true;
        }
        const payload = lookup.spec(source, revision);
        if (!payload) {
            reject(response, 404, 'Specification payload not found.');
            return true;
        }
        sendImmutable(request, response, revision, payload);
        return true;
    }
    const key = digest(url, 'key');
    if (!key || unsupported(url, ['key'])) {
        reject(response, 400, 'Exactly one declaration source key is required.');
        return true;
    }
    const payload = lookup.source(key);
    if (!payload) {
        reject(response, 404, 'Declaration source payload not found.');
        return true;
    }
    sendImmutable(request, response, key, payload);
    return true;
}
function one(url, name) {
    const values = url.searchParams.getAll(name);
    const value = values.length === 1 ? values[0] : undefined;
    return value && !value.includes('\0') ? value : undefined;
}
function digest(url, name) {
    const value = one(url, name);
    return value && /^[a-f\d]{64}$/.test(value) ? value : undefined;
}
function unsupported(url, supported) {
    const allowed = new Set(supported);
    return [...url.searchParams.keys()].some((key) => !allowed.has(key));
}
function sendImmutable(request, response, revision, value) {
    const etag = `"${revision}"`;
    response.setHeader('etag', etag);
    response.setHeader('cache-control', 'private, max-age=31536000, immutable');
    response.setHeader('x-content-type-options', 'nosniff');
    if (request.headers['if-none-match'] === etag) {
        response.statusCode = 304;
        response.end();
        return;
    }
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(value));
}
function reject(response, status, message) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(JSON.stringify({ status: 'error', message }));
}
//# sourceMappingURL=catalog-http.js.map