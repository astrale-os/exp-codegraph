import { createAnalysisIdentityHash } from '../identity/hash.js';
import { compareUnicodeScalars } from '../identity/model.js';
import { types } from 'node:util';
const UNSUPPORTED = Symbol('non-JSON admission value');
const ARRAY = Array;
const ARRAY_PROTOTYPE = Array.prototype;
const ARRAY_MAP = Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'map');
const ARRAY_CONSTRUCTOR = Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'constructor');
const ARRAY_SPECIES = Object.getOwnPropertyDescriptor(ARRAY, Symbol.species);
const NATIVE_ARRAYS = ARRAY_CONSTRUCTOR?.value === ARRAY && nativeFunction(ARRAY, 'Array') &&
    nativeFunction(ARRAY_MAP?.value, 'map') && nativeFunction(ARRAY_SPECIES?.get, 'get [Symbol.species]');
/** Private, owned JSON ingress only. The generic identity path remains the fallback. */
export function hashOwnedFactShard(input) {
    // These hooks would change canonical() or JSON.stringify() even for fresh
    // plain data. Leave their observation and result to the generic encoder.
    if (!NATIVE_ARRAYS || Array !== ARRAY || Array.prototype !== ARRAY_PROTOTYPE ||
        Object.getPrototypeOf(ARRAY_PROTOTYPE) !== Object.prototype ||
        !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'map'), ARRAY_MAP) ||
        !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY_PROTOTYPE, 'constructor'), ARRAY_CONSTRUCTOR) ||
        !sameDescriptor(Object.getOwnPropertyDescriptor(ARRAY, Symbol.species), ARRAY_SPECIES) ||
        Object.hasOwn(Object.prototype, 'toJSON') || Object.hasOwn(Array.prototype, 'toJSON'))
        return;
    const writer = new OwnedJSONWriter(input.namespace);
    try {
        writer.part('{');
        if (input.capabilities) {
            writer.part('"capabilities":');
            writer.value(input.capabilities);
            writer.part(',');
        }
        writer.part('"completion":');
        writer.value(input.completion);
        writer.part(',"facts":[');
        let semanticPayloadBytes = 0;
        for (let index = 0; index < input.facts.length; index++) {
            if (index)
                writer.part(',');
            const fact = input.facts[index];
            writer.part('{"completeness":');
            writer.value(fact.completeness);
            writer.part(',"id":');
            writer.value(fact.id);
            writer.part(',"kind":');
            writer.value(fact.kind);
            writer.part(',"namespace":');
            writer.value(fact.namespace);
            writer.part(',"payload":');
            const before = writer.bytes;
            writer.value(fact.payload);
            semanticPayloadBytes += writer.bytes - before;
            writer.part(',"provenance":');
            writer.value(fact.provenance);
            writer.part(',"schemaVersion":');
            writer.value(fact.schemaVersion);
            writer.part(',"subject":');
            writer.value(fact.subject);
            writer.part('}');
        }
        writer.part('],"key":');
        writer.value(input.key);
        writer.part(',"namespace":');
        writer.value(input.namespace);
        writer.part(',"schemaVersion":');
        writer.value(input.schemaVersion);
        writer.part('}');
        return { digest: writer.finish(), semanticPayloadBytes };
    }
    catch (error) {
        if (error !== UNSUPPORTED)
            throw error;
        // Reuse the already decoded semantic input. Do not invoke a decoder again,
        // publish a certificate, or change the generic path's error timing.
        return undefined;
    }
}
// Match UTF-16 code units: paired and unpaired surrogates both use the JSON
// encoder. Plain strings can be quoted directly without a temporary JSON string.
const JSON_ESCAPES = /["\\\u0000-\u001f\u2028\u2029\ud800-\udfff]/;
const UTF8 = new TextEncoder();
class OwnedJSONWriter {
    #hash;
    #strings = new Map();
    #shapes = new Map();
    #shapeCount = 0;
    #buffer = Buffer.allocUnsafe(32_768);
    #offset = 0;
    // Ordinary JSON UTF-8 bytes, before the identity-only separator escapes.
    bytes = 0;
    constructor(namespace) { this.#hash = createAnalysisIdentityHash('fact-shard-digest', namespace); }
    /** Short ASCII framing and primitive tokens; string values use string(). */
    part(value) {
        this.bytes += value.length;
        if (value.length > this.#buffer.length - this.#offset)
            this.flush();
        if (value.length === 1)
            this.#buffer[this.#offset++] = value.charCodeAt(0);
        else
            this.#offset += this.#buffer.write(value, this.#offset, value.length, 'ascii');
    }
    value(value) {
        if (value === null) {
            this.part('null');
            return;
        }
        switch (typeof value) {
            case 'string':
                this.string(value);
                return;
            case 'number':
                this.part(Number.isFinite(value) ? String(value) : 'null');
                return;
            case 'boolean':
                this.part(value ? 'true' : 'false');
                return;
            case 'object': break;
            default: throw UNSUPPORTED;
        }
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype)
                throw UNSUPPORTED;
            this.part('[');
            for (let index = 0; index < value.length; index++) {
                if (index)
                    this.part(',');
                this.value(value[index]);
            }
            this.part(']');
            return;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            throw UNSUPPORTED;
        const record = value;
        this.part('{');
        let separator = false;
        for (const key of this.keys(record)) {
            const entry = record[key];
            if (entry === undefined)
                continue;
            if (separator)
                this.part(',');
            this.string(key);
            this.part(':');
            this.value(entry);
            separator = true;
        }
        this.part('}');
    }
    finish() {
        this.flush();
        return `fact-shard-digest:${this.#hash.digest('hex')}`;
    }
    string(value) {
        const encoded = value.length <= 256 ? this.#strings.get(value) : undefined;
        if (encoded) {
            this.bytes += encoded.bytes;
            this.token(encoded.canonical);
            return;
        }
        // Both caches belong to this one admission. Bound their entry count and
        // retained key size; a giant open value must not become a cached token.
        const cache = this.#strings.size < 256 && value.length <= 256;
        if (!JSON_ESCAPES.test(value)) {
            const bytes = Buffer.byteLength(value);
            this.bytes += bytes + 2;
            if (cache) {
                const token = Buffer.allocUnsafe(bytes + 2);
                token[0] = token[bytes + 1] = 34;
                token.write(value, 1, bytes, 'utf8');
                this.#strings.set(value, { canonical: token, bytes: bytes + 2 });
                this.token(token);
            }
            else {
                this.byte(34);
                this.text(value, bytes);
                this.byte(34);
            }
            return;
        }
        const json = JSON.stringify(value);
        const canonical = json.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
        const canonicalBytes = Buffer.byteLength(canonical);
        const bytes = canonical === json ? canonicalBytes : Buffer.byteLength(json);
        this.bytes += bytes;
        if (cache) {
            const token = Buffer.from(canonical);
            this.#strings.set(value, { canonical: token, bytes });
            this.token(token);
        }
        else
            this.text(canonical, canonicalBytes);
    }
    byte(value) {
        if (this.#offset === this.#buffer.length)
            this.flush();
        this.#buffer[this.#offset++] = value;
    }
    /** Cached tokens are bounded to fit the buffer and already contain quotes. */
    token(value) {
        if (value.length > this.#buffer.length - this.#offset)
            this.flush();
        this.#offset += value.copy(this.#buffer, this.#offset);
    }
    text(value, bytes) {
        if (bytes <= this.#buffer.length) {
            if (bytes > this.#buffer.length - this.#offset)
                this.flush();
            this.#offset += this.#buffer.write(value, this.#offset, bytes, 'utf8');
            return;
        }
        let read = 0;
        while (read < value.length) {
            const result = UTF8.encodeInto(value.slice(read), this.#buffer.subarray(this.#offset));
            read += result.read;
            this.#offset += result.written;
            // encodeInto reports consumed UTF-16 units and never splits a surrogate
            // pair or writes a partial UTF-8 sequence when fewer than four bytes fit.
            if (read < value.length)
                this.flush();
        }
    }
    keys(value) {
        const keys = Object.keys(value);
        const shapes = this.#shapes.get(keys.length);
        if (shapes) {
            for (const shape of shapes) {
                let matches = true;
                for (let index = 0; index < keys.length; index++) {
                    if (keys[index] !== shape.keys[index]) {
                        matches = false;
                        break;
                    }
                }
                if (matches)
                    return shape.ordered;
            }
        }
        const ordered = [...keys].sort(compareJSONKeys);
        if (this.#shapeCount < 64 && keys.length <= 32 && keys.every(key => key.length <= 256)) {
            const shape = { keys, ordered };
            if (shapes)
                shapes.push(shape);
            else
                this.#shapes.set(keys.length, [shape]);
            this.#shapeCount++;
        }
        return ordered;
    }
    flush() {
        if (this.#offset)
            this.#hash.update(this.#buffer.subarray(0, this.#offset));
        // Hash.update consumes this view synchronously; only its filled prefix was
        // observed and the same local buffer is now free for the next chunk.
        this.#offset = 0;
    }
}
function compareJSONKeys(left, right) {
    // Object.fromEntries(canonical entries) still enumerates array-index keys
    // numerically first when JSON.stringify runs. Other keys use scalar order.
    const a = arrayIndex(left);
    const b = arrayIndex(right);
    return a !== undefined ? b !== undefined ? a - b : -1
        : b !== undefined ? 1 : compareUnicodeScalars(left, right);
}
function arrayIndex(key) {
    const value = Number(key);
    return Number.isInteger(value) && value >= 0 && value < 0xffff_ffff && String(value) === key
        ? value : undefined;
}
function nativeFunction(value, name) {
    return typeof value === 'function' && !types.isProxy(value) &&
        Function.prototype.toString.call(value).replace(/\s+/gu, ' ').trim() === `function ${name}() { [native code] }`;
}
function sameDescriptor(value, expected) {
    return value !== undefined && expected !== undefined && value.value === expected.value && value.get === expected.get &&
        value.set === expected.set && value.writable === expected.writable &&
        value.enumerable === expected.enumerable && value.configurable === expected.configurable;
}
//# sourceMappingURL=owned-admission.js.map