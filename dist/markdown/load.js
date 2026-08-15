import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readBounded } from '../source/file.js';
import { renderMarkdownDocument } from './render.js';
export const MAX_MARKDOWN_BYTES = 512 * 1024;
export async function loadMarkdown(root, containingFile, reference) {
    const parsed = parseMarkdownReference(reference);
    const catalogRoot = await realpath(resolve(root));
    const containingDirectory = await realpath(dirname(containingFile));
    const candidate = resolve(containingDirectory, ...parsed.document.split('/'));
    if (!within(catalogRoot, candidate)) {
        throw new Error('Markdown reference escapes the catalog root.');
    }
    await rejectSymbolicPath(catalogRoot, candidate);
    const target = await realpath(candidate);
    const source = portable(relative(catalogRoot, target));
    if (!source.endsWith('.md'))
        throw new Error('Markdown references must target a .md file.');
    const text = await readBounded(target);
    if (Buffer.byteLength(text, 'utf8') > MAX_MARKDOWN_BYTES) {
        throw new Error(`Markdown file exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
    }
    const selected = parsed.fragment ? markdownSection(text, parsed.fragment) : text;
    return renderMarkdownDocument(source, selected, parsed.fragment);
}
async function rejectSymbolicPath(root, target) {
    let current = root;
    for (const segment of relative(root, target).split(sep).filter(Boolean)) {
        current = join(current, segment);
        if ((await lstat(current)).isSymbolicLink()) {
            throw new Error('Markdown reference paths cannot contain symbolic links.');
        }
    }
}
function parseMarkdownReference(reference) {
    const hash = reference.indexOf('#');
    if (reference.indexOf('#', hash + 1) !== -1) {
        throw new Error('Markdown reference must contain at most one #.');
    }
    const encodedDocument = hash === -1 ? reference : reference.slice(0, hash);
    const encodedFragment = hash === -1 ? undefined : reference.slice(hash + 1);
    let document;
    let fragment;
    try {
        document = decodeURIComponent(encodedDocument);
        fragment = encodedFragment === undefined ? undefined : decodeURIComponent(encodedFragment);
    }
    catch {
        throw new Error('Markdown reference contains invalid percent encoding.');
    }
    if (!document || isAbsolute(document) || document.includes('\\')) {
        throw new Error('Markdown reference must use a relative POSIX path.');
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(document)) {
        throw new Error('Markdown reference must be local.');
    }
    if (document.includes('?'))
        throw new Error('Markdown reference paths cannot contain ?.');
    if ([...document].some((character) => isControl(character.codePointAt(0)))) {
        throw new Error('Markdown reference path must not contain control characters.');
    }
    if (!document.endsWith('.md'))
        throw new Error('Markdown references must target a .md file.');
    if (fragment !== undefined && !fragment) {
        throw new Error('Markdown heading fragment cannot be empty.');
    }
    return { document, fragment };
}
function markdownSection(text, fragment) {
    const root = fromMarkdown(text);
    const slugger = new GithubSlugger();
    for (let index = 0; index < root.children.length; index++) {
        const node = root.children[index];
        if (node.type !== 'heading')
            continue;
        const slug = slugger.slug(nodeText(node));
        if (slug !== fragment)
            continue;
        const start = node.position?.start.offset;
        if (start === undefined)
            break;
        let end = text.length;
        for (let next = index + 1; next < root.children.length; next++) {
            const candidate = root.children[next];
            if (candidate.type === 'heading' && candidate.depth <= node.depth) {
                end = candidate.position?.start.offset ?? end;
                break;
            }
        }
        return text.slice(start, end).trimEnd();
    }
    throw new Error(`Markdown heading not found: #${fragment}`);
}
function nodeText(node) {
    if (typeof node.value === 'string')
        return node.value;
    if (typeof node.alt === 'string')
        return node.alt;
    return (node.children ?? [])
        .map((child) => child && typeof child === 'object'
        ? nodeText(child)
        : '')
        .join('');
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function isControl(code) {
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
//# sourceMappingURL=load.js.map