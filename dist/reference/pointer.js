export function pointerSegments(pointer) {
    if (!pointer)
        return [];
    if (!pointer.startsWith('/'))
        throw new Error('invalid JSON Pointer');
    return pointer
        .slice(1)
        .split('/')
        .map((segment) => {
        if (/~(?:[^01]|$)/.test(segment))
            throw new Error('invalid JSON Pointer escape');
        return segment.replaceAll('~1', '/').replaceAll('~0', '~');
    });
}
export function pointerFromPath(path) {
    if (!path.length)
        return '';
    return `/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}
export function readPointer(value, pointer) {
    let current = value;
    for (const segment of pointerSegments(pointer)) {
        if (Array.isArray(current)) {
            if (!/^(0|[1-9]\d*)$/.test(segment))
                return { found: false };
            const index = Number(segment);
            if (index >= current.length)
                return { found: false };
            current = current[index];
            continue;
        }
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
            return { found: false };
        }
        current = current[segment];
    }
    return { found: true, value: current };
}
//# sourceMappingURL=pointer.js.map