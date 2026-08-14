import GithubSlugger from 'github-slugger'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { MarkdownDocument } from './model.ts'

import { readBounded } from '../source/file.ts'
import { renderMarkdownDocument } from './render.ts'

export const MAX_MARKDOWN_BYTES = 512 * 1024

export async function loadMarkdown(
  root: string,
  containingFile: string,
  reference: string,
): Promise<MarkdownDocument> {
  const parsed = parseMarkdownReference(reference)
  const catalogRoot = await realpath(resolve(root))
  const containingDirectory = await realpath(dirname(containingFile))
  const candidate = resolve(containingDirectory, ...parsed.document.split('/'))
  if (!within(catalogRoot, candidate)) {
    throw new Error('Markdown reference escapes the catalog root.')
  }
  await rejectSymbolicPath(catalogRoot, candidate)
  const target = await realpath(candidate)
  const source = portable(relative(catalogRoot, target))
  if (!source.endsWith('.md')) throw new Error('Markdown references must target a .md file.')
  const text = await readBounded(target)
  if (Buffer.byteLength(text, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new Error(`Markdown file exceeds ${MAX_MARKDOWN_BYTES} bytes.`)
  }
  const selected = parsed.fragment ? markdownSection(text, parsed.fragment) : text
  return renderMarkdownDocument(source, selected, parsed.fragment)
}

async function rejectSymbolicPath(root: string, target: string): Promise<void> {
  let current = root
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('Markdown reference paths cannot contain symbolic links.')
    }
  }
}

function parseMarkdownReference(reference: string): { document: string; fragment?: string } {
  const hash = reference.indexOf('#')
  if (reference.indexOf('#', hash + 1) !== -1) {
    throw new Error('Markdown reference must contain at most one #.')
  }
  const encodedDocument = hash === -1 ? reference : reference.slice(0, hash)
  const encodedFragment = hash === -1 ? undefined : reference.slice(hash + 1)
  let document: string
  let fragment: string | undefined
  try {
    document = decodeURIComponent(encodedDocument)
    fragment = encodedFragment === undefined ? undefined : decodeURIComponent(encodedFragment)
  } catch {
    throw new Error('Markdown reference contains invalid percent encoding.')
  }
  if (!document || isAbsolute(document) || document.includes('\\')) {
    throw new Error('Markdown reference must use a relative POSIX path.')
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(document)) {
    throw new Error('Markdown reference must be local.')
  }
  if (document.includes('?')) throw new Error('Markdown reference paths cannot contain ?.')
  if ([...document].some((character) => isControl(character.codePointAt(0)!))) {
    throw new Error('Markdown reference path must not contain control characters.')
  }
  if (!document.endsWith('.md')) throw new Error('Markdown references must target a .md file.')
  if (fragment !== undefined && !fragment) {
    throw new Error('Markdown heading fragment cannot be empty.')
  }
  return { document, fragment }
}

function markdownSection(text: string, fragment: string): string {
  const root = fromMarkdown(text)
  const slugger = new GithubSlugger()
  for (let index = 0; index < root.children.length; index++) {
    const node = root.children[index]
    if (node.type !== 'heading') continue
    const slug = slugger.slug(nodeText(node))
    if (slug !== fragment) continue
    const start = node.position?.start.offset
    if (start === undefined) break
    let end = text.length
    for (let next = index + 1; next < root.children.length; next++) {
      const candidate = root.children[next]
      if (candidate.type === 'heading' && candidate.depth <= node.depth) {
        end = candidate.position?.start.offset ?? end
        break
      }
    }
    return text.slice(start, end).trimEnd()
  }
  throw new Error(`Markdown heading not found: #${fragment}`)
}

function nodeText(node: { value?: string; alt?: string; children?: unknown[] }): string {
  if (typeof node.value === 'string') return node.value
  if (typeof node.alt === 'string') return node.alt
  return (node.children ?? [])
    .map((child) =>
      child && typeof child === 'object'
        ? nodeText(child as { value?: string; alt?: string; children?: unknown[] })
        : '',
    )
    .join('')
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}
