import { fromMarkdown } from 'mdast-util-from-markdown';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { highlightedSourceHtml, highlightSourceCode } from '../source/syntax.js';
const rendered = new Map();
const documentInlineCode = new WeakMap();
const MAX_RENDERED_DOCUMENTS = 512;
const MAX_RENDERED_BYTES = 32 * 1024 * 1024;
const MAX_INLINE_CODE_SPANS = 4_096;
let renderedBytes = 0;
export function renderMarkdown(text) {
    return renderedMarkdown(text).html;
}
/** Build one catalog document while retaining analysis outside its JSON shape. */
export function renderMarkdownDocument(source, text, fragment) {
    const result = renderedMarkdown(text);
    const document = {
        source,
        ...(fragment ? { fragment } : {}),
        text,
        html: markInlineCode(result.html, result.inlineCode),
    };
    documentInlineCode.set(document, result.inlineCode);
    return document;
}
function renderedMarkdown(text) {
    const cached = recallRendered(text);
    if (cached !== undefined)
        return cached;
    const analysis = analyzeMarkdown(text);
    const html = micromark(text, {
        allowDangerousHtml: false,
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
    });
    const result = highlightCodeBlocks(html, analysis.codeBlocks);
    const bytes = utf8ByteLength(text) + utf8ByteLength(result);
    if (bytes <= MAX_RENDERED_BYTES) {
        rendered.set(text, { html: result, bytes, inlineCode: analysis.inlineCode });
        renderedBytes += bytes;
    }
    while (rendered.size > MAX_RENDERED_DOCUMENTS || renderedBytes > MAX_RENDERED_BYTES) {
        const oldest = rendered.entries().next().value;
        if (!oldest)
            break;
        rendered.delete(oldest[0]);
        renderedBytes -= oldest[1].bytes;
    }
    return { html: result, bytes, inlineCode: analysis.inlineCode };
}
/** Reuse the Markdown render pass to expose unlinked inline-code source spans. */
export function markdownInlineCodeSpans(value) {
    if (typeof value !== 'string') {
        const retained = documentInlineCode.get(value);
        return retained ?? analyzeMarkdown(value.text).inlineCode;
    }
    return recallRendered(value)?.inlineCode ?? analyzeMarkdown(value).inlineCode;
}
function recallRendered(text) {
    const cached = rendered.get(text);
    if (cached === undefined)
        return;
    rendered.delete(text);
    rendered.set(text, cached);
    return cached;
}
function utf8ByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}
const renderedCodeBlock = /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g;
const renderedCode = /(<pre><code[^>]*>[\s\S]*?<\/code><\/pre>)|<code>([\s\S]*?)<\/code>/g;
/** Pair micromark's safe HTML with the corresponding source code nodes in document order. */
function highlightCodeBlocks(html, blocks) {
    if (blocks.length === 0)
        return html;
    let index = 0;
    return html.replace(renderedCodeBlock, (rendered, attributes, content) => {
        const block = blocks[index++];
        if (!block)
            return rendered;
        const highlighted = highlightSourceCode(block.value, block.lang);
        if (!highlighted)
            return rendered;
        const codeAttributes = attributes.includes('class=')
            ? attributes
            : `${attributes} class="language-${highlighted.language}"`;
        const trailingLine = content.endsWith('\n') ? '\n' : '';
        return `<pre><code${codeAttributes}>${highlightedSourceHtml(highlighted)}${trailingLine}</code></pre>`;
    });
}
/** Pair safe inline-code HTML with source offsets; snapshot packing consumes these markers. */
function markInlineCode(html, spans) {
    if (spans.length === 0)
        return html;
    let index = 0;
    const marked = html.replace(renderedCode, (match, block, content) => {
        if (block !== undefined || content === undefined)
            return match;
        const span = spans[index];
        if (!span)
            return match;
        index++;
        return `<code data-md-from="${span.from}" data-md-to="${span.to}">${content}</code>`;
    });
    return index === spans.length ? marked : html;
}
function analyzeMarkdown(markdown) {
    const root = fromMarkdown(markdown);
    const codeBlocks = [];
    const inlineCode = [];
    let inlineCodeOverflow = false;
    visit(root, false);
    return { codeBlocks, inlineCode: inlineCodeOverflow ? [] : inlineCode };
    function visit(node, insideLink) {
        if (node.type === 'code' && typeof node.value === 'string') {
            codeBlocks.push({ value: node.value, lang: node.lang });
            return;
        }
        if (node.type === 'inlineCode' && typeof node.value === 'string') {
            const from = node.position?.start.offset;
            const to = node.position?.end.offset;
            if (from !== undefined && to !== undefined && to > from) {
                if (inlineCode.length < MAX_INLINE_CODE_SPANS) {
                    inlineCode.push({ from, to, value: node.value, linked: insideLink });
                }
                else {
                    inlineCodeOverflow = true;
                }
            }
            return;
        }
        const linked = insideLink || node.type === 'link' || node.type === 'linkReference';
        for (const child of node.children ?? [])
            visit(child, linked);
    }
}
//# sourceMappingURL=render.js.map