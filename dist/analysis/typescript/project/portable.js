import { types } from 'node:util';
import { serialize, deserialize } from 'node:v8';
/** No getters, proxies, classes or hidden references enter retained computations. */
export function capturePortable(input) {
    const seen = new Map();
    let entries = 0;
    const copy = (value, depth) => {
        if (++entries > 500_000 || depth > 128)
            throw undefined;
        if (value === null || value === undefined || ['boolean', 'number', 'string', 'bigint'].includes(typeof value))
            return value;
        if (typeof value !== 'object' || types.isProxy(value))
            throw undefined;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== Array.prototype)
            throw undefined;
        const previous = seen.get(value);
        if (previous)
            return previous;
        const array = Array.isArray(value);
        if (array && value.length > 500_000)
            throw undefined;
        const target = array ? new Array(value.length) : {};
        seen.set(value, target);
        // The callback sees this same canonical property order, including absent vs
        // undefined properties, holes, aliases, cycles, NaN and signed zero.
        for (const key of Reflect.ownKeys(value).sort((left, right) => String(left).localeCompare(String(right)))) {
            if (typeof key !== 'string')
                throw undefined;
            if (array && key === 'length')
                continue;
            const property = Object.getOwnPropertyDescriptor(value, key);
            if (!('value' in property) || !property.enumerable)
                throw undefined;
            if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
                throw undefined;
            Object.defineProperty(target, key, { value: copy(property.value, depth + 1), enumerable: true, configurable: true, writable: true });
        }
        return Object.freeze(target);
    };
    try {
        const value = copy(input, 0);
        return { value, encoded: serialize(value) };
    }
    catch {
        return undefined;
    }
}
export function restorePortable(encoded) {
    const value = deserialize(encoded);
    const seen = new Set();
    const freeze = (value) => {
        if (!value || typeof value !== 'object' || seen.has(value))
            return;
        seen.add(value);
        for (const property of Object.values(value))
            freeze(property);
        Object.freeze(value);
    };
    freeze(value);
    return value;
}
//# sourceMappingURL=portable.js.map