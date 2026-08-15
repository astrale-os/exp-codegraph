import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const CACHE_SUFFIX = '.bin';
const TEMPORARY_SUFFIX = '.tmp';
const STALE_TEMPORARY_AGE_MS = 24 * 60 * 60 * 1_000;
/** Store one atomic cache value while bounding the entire shared cache directory. */
export function createBoundedFileCacheStore(options) {
    if (!/^[a-z0-9-]+$/u.test(options.key))
        throw new Error('Cache keys must be lowercase safe names.');
    const directory = resolve(options.directory);
    const target = join(directory, `${options.key}${CACHE_SUFFIX}`);
    return {
        async load() {
            try {
                const metadata = await stat(target);
                if (!metadata.isFile() || metadata.size > options.maxEntryBytes) {
                    await removeFile(target);
                    return;
                }
                const value = await readFile(target);
                if (value.byteLength > options.maxEntryBytes) {
                    await removeFile(target);
                    return;
                }
                return value;
            }
            catch {
                return;
            }
        },
        async save(value) {
            if (value.byteLength > options.maxEntryBytes)
                return;
            const temporary = join(directory, `.${options.key}.${process.pid}.${randomUUID()}${TEMPORARY_SUFFIX}`);
            try {
                await mkdir(directory, { recursive: true, mode: 0o700 });
                await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
                await replaceFile(temporary, target);
                await prune(directory, options);
            }
            catch {
                // Evidence persistence is an optimization. Read-only homes, races, and quota failures
                // must never prevent a catalog command from starting or completing.
            }
            finally {
                await removeFile(temporary);
            }
        },
        async remove() {
            await removeFile(target);
        },
    };
}
async function replaceFile(source, target) {
    try {
        await rename(source, target);
    }
    catch (error) {
        if (!replaceRequiresRemoval(error))
            throw error;
        // Windows cannot atomically rename over an existing file. A missing cache between these two
        // operations is safe: readers simply take the ordinary cold path.
        await removeFile(target);
        await rename(source, target);
    }
}
function replaceRequiresRemoval(error) {
    if (typeof error !== 'object' || error === null || !('code' in error))
        return false;
    return error.code === 'EEXIST' || error.code === 'EPERM';
}
export function defaultTypeSpecCacheDirectory(environment = process.env, platform = process.platform, home = homedir()) {
    if (environment.ASTRALE_TYPESPEC_CACHE_DIR)
        return resolve(environment.ASTRALE_TYPESPEC_CACHE_DIR);
    if (environment.XDG_CACHE_HOME)
        return resolve(environment.XDG_CACHE_HOME, 'astrale-typespec', 'v2');
    if (platform === 'darwin')
        return join(home, 'Library', 'Caches', 'astrale-typespec', 'v2');
    if (platform === 'win32')
        return join(environment.LOCALAPPDATA ? resolve(environment.LOCALAPPDATA) : join(home, 'AppData', 'Local'), 'astrale-typespec', 'v2');
    return join(home, '.cache', 'astrale-typespec', 'v2');
}
async function prune(directory, options) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
        return;
    }
    const now = Date.now();
    await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(TEMPORARY_SUFFIX))
        .map(async (entry) => {
        const file = join(directory, entry.name);
        try {
            if (now - (await stat(file)).mtimeMs >= STALE_TEMPORARY_AGE_MS)
                await removeFile(file);
        }
        catch {
            // Another process may already have completed or removed the temporary file.
        }
    }));
    const files = (await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(CACHE_SUFFIX))
        .map(async (entry) => {
        const file = join(directory, entry.name);
        try {
            const metadata = await stat(file);
            return { file, name: entry.name, size: metadata.size, modified: metadata.mtimeMs };
        }
        catch {
            return;
        }
    })))
        .filter((entry) => Boolean(entry))
        .sort((left, right) => left.modified - right.modified || left.name.localeCompare(right.name));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    while (files.length > options.maxEntries || total > options.maxTotalBytes) {
        const oldest = files.shift();
        if (!oldest)
            return;
        await removeFile(oldest.file);
        total -= oldest.size;
    }
}
async function removeFile(file) {
    try {
        await rm(file, { force: true });
    }
    catch {
        // Cache cleanup is always best effort.
    }
}
//# sourceMappingURL=file-store.js.map