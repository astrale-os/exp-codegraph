import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { renderMarkdownDocument } from '../../markdown/render.js';
import { MAX_FILE_BYTES } from '../../source/file.js';
const READ_CHUNK_BYTES = 64 * 1024;
const SNIFF_BYTES = 512;
/** Read history as inert content, retaining text only when it fits the normal editable-file bound. */
export async function loadHistoryResource(file) {
    try {
        const before = await lstat(file.absolute);
        if (before.isSymbolicLink())
            throw new Error('History paths cannot be symbolic links.');
        if (!before.isFile())
            throw new Error('History resources must be regular files.');
        const handle = await open(file.absolute, 'r');
        try {
            const hash = createHash('sha256');
            const retained = [];
            let retainedBytes = 0;
            let offset = 0;
            let first = Buffer.alloc(0);
            while (true) {
                const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
                if (!bytesRead)
                    break;
                const value = chunk.subarray(0, bytesRead);
                if (offset === 0)
                    first = value.subarray(0, SNIFF_BYTES);
                hash.update(value);
                if (before.size <= MAX_FILE_BYTES) {
                    retained.push(value);
                    retainedBytes += bytesRead;
                }
                offset += bytesRead;
            }
            const after = await handle.stat();
            if (before.dev !== after.dev ||
                before.ino !== after.ino ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs) {
                throw new Error('History resource changed while it was read.');
            }
            const bytes = before.size <= MAX_FILE_BYTES ? Buffer.concat(retained, retainedBytes) : undefined;
            const detected = detectHistory(file.relative, first, bytes);
            const revision = hash.digest('hex');
            const base = {
                ref: `./${file.relative}`,
                source: file.source,
                name: basename(file.relative),
                mediaType: detected.mediaType,
                presentation: detected.presentation,
                size: before.size,
                revision,
            };
            if (detected.text === undefined)
                return { resource: base, diagnostics: [] };
            if (detected.presentation === 'markdown') {
                return {
                    resource: {
                        ...base,
                        text: detected.text,
                        document: renderMarkdownDocument(file.source, detected.text),
                    },
                    diagnostics: [],
                };
            }
            return { resource: { ...base, text: detected.text }, diagnostics: [] };
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        return {
            diagnostics: [
                {
                    code: 'HISTORY_RESOURCE_INVALID',
                    message: error instanceof Error ? error.message : String(error),
                    file: file.source,
                    line: 1,
                    column: 1,
                },
            ],
        };
    }
}
function detectHistory(relative, first, complete) {
    if (startsWith(first, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        return { mediaType: 'application/pdf', presentation: 'pdf' };
    }
    if (startsWith(first, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { mediaType: 'image/png', presentation: 'image' };
    }
    if (startsWith(first, [0xff, 0xd8, 0xff])) {
        return { mediaType: 'image/jpeg', presentation: 'image' };
    }
    if (ascii(first, 0, 6) === 'GIF87a' || ascii(first, 0, 6) === 'GIF89a') {
        return { mediaType: 'image/gif', presentation: 'image' };
    }
    if (ascii(first, 0, 4) === 'RIFF' && ascii(first, 8, 4) === 'WEBP') {
        return { mediaType: 'image/webp', presentation: 'image' };
    }
    const extension = extname(relative).toLowerCase();
    const text = complete ? utf8(complete) : undefined;
    if (extension === '.md' && (text !== undefined || complete === undefined)) {
        return {
            mediaType: 'text/markdown',
            presentation: 'markdown',
            ...(text !== undefined ? { text } : {}),
        };
    }
    if (text !== undefined) {
        return {
            mediaType: textMediaType(extension),
            presentation: 'text',
            text,
        };
    }
    if (complete === undefined && textExtension(extension)) {
        return { mediaType: textMediaType(extension), presentation: 'text' };
    }
    return { mediaType: 'application/octet-stream', presentation: 'binary' };
}
function utf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        return;
    }
}
function textMediaType(extension) {
    if (extension === '.json')
        return 'application/json';
    if (extension === '.yaml' || extension === '.yml')
        return 'application/yaml';
    if (extension === '.svg')
        return 'image/svg+xml';
    return 'text/plain';
}
function textExtension(extension) {
    return new Set([
        '.css',
        '.csv',
        '.html',
        '.js',
        '.json',
        '.jsx',
        '.md',
        '.mjs',
        '.svg',
        '.toml',
        '.ts',
        '.tsx',
        '.txt',
        '.xml',
        '.yaml',
        '.yml',
    ]).has(extension);
}
function startsWith(value, expected) {
    return expected.every((byte, index) => value[index] === byte);
}
function ascii(value, start, length) {
    return String.fromCharCode(...value.subarray(start, start + length));
}
//# sourceMappingURL=history.js.map