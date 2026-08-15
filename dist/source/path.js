import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
export function absoluteSourcePath(root, source) {
    return resolve(root, ...source.split('/'));
}
export function normalizeSourcePath(root, path, label) {
    if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0')) {
        throw new Error(`${label} must be a relative POSIX path inside the catalog root.`);
    }
    const normalized = posix.normalize(path);
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new Error(`${label} escapes the catalog root: ${path}`);
    }
    const target = resolve(root, ...normalized.split('/'));
    const fromRoot = relative(resolve(root), target);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error(`${label} escapes the catalog root: ${path}`);
    }
    return sep === '/' ? fromRoot || '.' : (fromRoot || '.').split(sep).join('/');
}
//# sourceMappingURL=path.js.map