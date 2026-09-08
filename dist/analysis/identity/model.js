import { isAbsolute, posix } from 'node:path';
import { createAnalysisIdentityHash } from './hash.js';
const kindPattern = /^[a-z][a-z0-9-]*$/u;
const valuePattern = /^[a-z][a-z0-9-]*:[a-f0-9]{64}$/u;
export function admitAnalysisId(kind, value) {
    if (!kindPattern.test(kind))
        throw new TypeError(`Invalid analysis identity kind: ${kind}`);
    if (!valuePattern.test(value) || !value.startsWith(`${kind}:`)) {
        throw new TypeError(`Invalid ${kind} analysis identity: ${value}`);
    }
    return value;
}
export function deriveAnalysisId(kind, namespace, input) {
    const digest = createAnalysisIdentityHash(kind, namespace)
        .update(stableJson(input))
        .digest('hex');
    return `${kind}:${digest}`;
}
export function portablePath(path) {
    if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) {
        throw new TypeError(`Analysis path must be a non-empty relative POSIX path: ${path}`);
    }
    const normalized = posix.normalize(path);
    if (normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/')) {
        throw new TypeError(`Analysis path escapes its logical root: ${path}`);
    }
    return normalized;
}
export function stableJson(value) {
    // Go's encoding/json always escapes the two JSON-valid JavaScript line
    // separators for JSONP safety. Preserve that portable spelling here while
    // leaving literal backslash-u text untouched.
    return JSON.stringify(canonical(value))
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029');
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value === undefined)
        return { $undefined: true };
    if (typeof value === 'bigint')
        return { $bigint: value.toString() };
    if (!value || typeof value !== 'object')
        return value;
    if (value instanceof Date)
        return { $date: value.toISOString() };
    // Read properties once, before descending, and reuse their entry tuples.
    // This preserves accessor ordering and Object.fromEntries semantics (including
    // integer keys and __proto__) without three intermediate entry collections.
    const entries = Object.entries(value);
    let length = 0;
    for (const entry of entries) {
        if (entry[1] !== undefined)
            entries[length++] = entry;
    }
    entries.length = length;
    // Go's encoding/json orders valid UTF-8 map keys by Unicode scalar value.
    // Locale collation is machine-dependent; UTF-16 order differs for astral keys.
    entries.sort(([left], [right]) => compareUnicodeScalars(left, right));
    for (const entry of entries)
        entry[1] = canonical(entry[1]);
    return Object.fromEntries(entries);
}
function compareUnicodeScalars(left, right) {
    let a = 0;
    let b = 0;
    while (a < left.length && b < right.length) {
        const leftPoint = left.codePointAt(a);
        const rightPoint = right.codePointAt(b);
        const difference = leftPoint - rightPoint;
        if (difference)
            return difference;
        a += leftPoint > 0xffff ? 2 : 1;
        b += rightPoint > 0xffff ? 2 : 1;
    }
    return a < left.length ? 1 : b < right.length ? -1 : 0;
}
//# sourceMappingURL=model.js.map