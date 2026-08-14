import { fromMarkdown } from 'mdast-util-from-markdown'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

import type { MarkdownDocument } from './model.ts'

import { highlightedSourceHtml, highlightSourceCode } from '../source/syntax.ts'

interface RenderedMarkdown {
  readonly html: string
  readonly bytes: number
  readonly inlineCode: readonly MarkdownInlineCodeSpan[]
}

export interface MarkdownInlineCodeSpan {
  readonly from: number
  readonly to: number
  readonly value: string
  readonly linked: boolean
}

const rendered = new Map<string, RenderedMarkdown>()
const documentInlineCode = new WeakMap<MarkdownDocument, readonly MarkdownInlineCodeSpan[]>()
const MAX_RENDERED_DOCUMENTS = 512
const MAX_RENDERED_BYTES = 32 * 1024 * 1024
const MAX_INLINE_CODE_SPANS = 4_096
let renderedBytes = 0

export function renderMarkdown(text: string): string {
  return renderedMarkdown(text).html
}

/** Build one catalog document while retaining analysis outside its JSON shape. */
export function renderMarkdownDocument(
  source: string,
  text: string,
  fragment?: string,
): MarkdownDocument {
  const result = renderedMarkdown(text)
  const document: MarkdownDocument = {
    source,
    ...(fragment ? { fragment } : {}),
    text,
    html: markInlineCode(result.html, result.inlineCode),
  }
  documentInlineCode.set(document, result.inlineCode)
  return document
}

function renderedMarkdown(text: string): RenderedMarkdown {
  const cached = recallRendered(text)
  if (cached !== undefined) return cached
  const analysis = analyzeMarkdown(text)
  const html = micromark(text, {
    allowDangerousHtml: false,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })
  const result = highlightCodeBlocks(html, analysis.codeBlocks)
  const bytes = utf8ByteLength(text) + utf8ByteLength(result)
  if (bytes <= MAX_RENDERED_BYTES) {
    rendered.set(text, { html: result, bytes, inlineCode: analysis.inlineCode })
    renderedBytes += bytes
  }
  while (rendered.size > MAX_RENDERED_DOCUMENTS || renderedBytes > MAX_RENDERED_BYTES) {
    const oldest = rendered.entries().next().value
    if (!oldest) break
    rendered.delete(oldest[0])
    renderedBytes -= oldest[1].bytes
  }
  return { html: result, bytes, inlineCode: analysis.inlineCode }
}

/** Reuse the Markdown render pass to expose unlinked inline-code source spans. */
export function markdownInlineCodeSpans(
  value: string | MarkdownDocument,
): readonly MarkdownInlineCodeSpan[] {
  if (typeof value !== 'string') {
    const retained = documentInlineCode.get(value)
    return retained ?? analyzeMarkdown(value.text).inlineCode
  }
  return recallRendered(value)?.inlineCode ?? analyzeMarkdown(value).inlineCode
}

function recallRendered(text: string): RenderedMarkdown | undefined {
  const cached = rendered.get(text)
  if (cached === undefined) return
  rendered.delete(text)
  rendered.set(text, cached)
  return cached
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

interface MarkdownCodeBlock {
  readonly lang?: string | null
  readonly value: string
}

interface MarkdownNode {
  readonly type: string
  readonly lang?: string | null
  readonly value?: string
  readonly children?: readonly MarkdownNode[]
  readonly position?: {
    readonly start: { readonly offset?: number }
    readonly end: { readonly offset?: number }
  }
}

interface MarkdownAnalysis {
  readonly codeBlocks: readonly MarkdownCodeBlock[]
  readonly inlineCode: readonly MarkdownInlineCodeSpan[]
}

const renderedCodeBlock = /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g
const renderedCode = /(<pre><code[^>]*>[\s\S]*?<\/code><\/pre>)|<code>([\s\S]*?)<\/code>/g

/** Pair micromark's safe HTML with the corresponding source code nodes in document order. */
function highlightCodeBlocks(html: string, blocks: readonly MarkdownCodeBlock[]): string {
  if (blocks.length === 0) return html
  let index = 0
  return html.replace(renderedCodeBlock, (rendered, attributes: string, content: string) => {
    const block = blocks[index++]
    if (!block) return rendered
    const highlighted = highlightSourceCode(block.value, block.lang)
    if (!highlighted) return rendered
    const codeAttributes = attributes.includes('class=')
      ? attributes
      : `${attributes} class="language-${highlighted.language}"`
    const trailingLine = content.endsWith('\n') ? '\n' : ''
    return `<pre><code${codeAttributes}>${highlightedSourceHtml(highlighted)}${trailingLine}</code></pre>`
  })
}

/** Pair safe inline-code HTML with source offsets; snapshot packing consumes these markers. */
function markInlineCode(html: string, spans: readonly MarkdownInlineCodeSpan[]): string {
  if (spans.length === 0) return html
  let index = 0
  const marked = html.replace(
    renderedCode,
    (match, block: string | undefined, content: string | undefined) => {
      if (block !== undefined || content === undefined) return match
      const span = spans[index]
      if (!span) return match
      index++
      return `<code data-md-from="${span.from}" data-md-to="${span.to}">${content}</code>`
    },
  )
  return index === spans.length ? marked : html
}

function analyzeMarkdown(markdown: string): MarkdownAnalysis {
  const root = fromMarkdown(markdown) as MarkdownNode
  const codeBlocks: MarkdownCodeBlock[] = []
  const inlineCode: MarkdownInlineCodeSpan[] = []
  let inlineCodeOverflow = false
  visit(root, false)
  return { codeBlocks, inlineCode: inlineCodeOverflow ? [] : inlineCode }

  function visit(node: MarkdownNode, insideLink: boolean): void {
    if (node.type === 'code' && typeof node.value === 'string') {
      codeBlocks.push({ value: node.value, lang: node.lang })
      return
    }
    if (node.type === 'inlineCode' && typeof node.value === 'string') {
      const from = node.position?.start.offset
      const to = node.position?.end.offset
      if (from !== undefined && to !== undefined && to > from) {
        if (inlineCode.length < MAX_INLINE_CODE_SPANS) {
          inlineCode.push({ from, to, value: node.value, linked: insideLink })
        } else {
          inlineCodeOverflow = true
        }
      }
      return
    }
    const linked = insideLink || node.type === 'link' || node.type === 'linkReference'
    for (const child of node.children ?? []) visit(child, linked)
  }
}
