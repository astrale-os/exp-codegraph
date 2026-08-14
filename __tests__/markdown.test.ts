import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadMarkdown, renderMarkdown } from '../markdown/index.ts'
import { renderMarkdownDocument } from '../markdown/render.ts'
import { projectMarkdownHtml } from '../server/catalog-markdown.ts'
import { semanticReferenceHref } from '../viewer-host/semantic-reference.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []
afterEach(async () => Promise.all(fixtures.splice(0).map((item) => item.remove())))

describe('Markdown references', () => {
  it('loads a whole local document and keeps raw HTML inert', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export {}\n',
      'alpha/details.md': '# Details\n\n<script>alert(1)</script>\n',
    })
    fixtures.push(current)

    const document = await loadMarkdown(
      current.root,
      join(current.root, 'alpha/.spec/api.d.ts'),
      '../details.md',
    )

    expect(document.source).toBe('alpha/details.md')
    expect(document.fragment).toBeUndefined()
    expect(document.html).toContain('&lt;script&gt;')
    expect(document.html).not.toContain('<script>')
  })

  it('selects a heading section including nested headings', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export {}\n',
      'alpha/details.md': `
# First

Ignore.

## Value semantics

Keep this.

### Detail

Keep this too.

## Next

Exclude this.
`,
    })
    fixtures.push(current)

    const document = await loadMarkdown(
      current.root,
      join(current.root, 'alpha/.spec/api.d.ts'),
      '../details.md#value-semantics',
    )

    expect(document.fragment).toBe('value-semantics')
    expect(document.text).toContain('## Value semantics')
    expect(document.text).toContain('### Detail')
    expect(document.text).not.toContain('## Next')
  })

  it('reports missing headings and root escapes', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export {}\n',
      'alpha/details.md': '# Details\n',
    })
    fixtures.push(current)

    await expect(
      loadMarkdown(current.root, join(current.root, 'alpha/.spec/api.d.ts'), '../details.md#missing'),
    ).rejects.toThrow('Markdown heading not found')
    await expect(
      loadMarkdown(current.root, join(current.root, 'alpha/.spec/api.d.ts'), '../../../outside.md'),
    ).rejects.toThrow()
  })

  it('rejects symbolic links even when their target is readable', async () => {
    const external = await fixture({ 'details.md': '# External\n' })
    const current = await fixture({ 'alpha/.spec/api.d.ts': 'export {}\n' })
    fixtures.push(external, current)
    await symlink(join(external.root, 'details.md'), join(current.root, 'alpha/details.md'))

    await expect(
      loadMarkdown(current.root, join(current.root, 'alpha/.spec/api.d.ts'), '../details.md'),
    ).rejects.toThrow('symbolic links')
  })

  it('supports GFM without enabling HTML', () => {
    const html = renderMarkdown('- [x] done\n\n~~old~~\n')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<del>old</del>')
  })

  it('syntax-highlights explicitly labeled TypeScript with semantic token classes', () => {
    const html = renderMarkdown(
      '```ts\ninterface Box<T> { readonly value: T }\nconst box: Box<string> = { value: "ok" }\n```\n',
    )

    expect(html).toContain('class="language-ts"')
    expect(html).toContain('<span class="tok-keyword">interface</span>')
    expect(html).toContain('<span class="tok-typeName">Box</span>')
    expect(html).toContain('<span class="tok-string">&quot;ok&quot;</span>')
  })

  it('conservatively detects TypeScript in an unlabeled code block', () => {
    const html = renderMarkdown('```\nconst value: string = "typed"\n```\n')

    expect(html).toContain('class="language-typescript"')
    expect(html).toContain('<span class="tok-keyword">const</span>')
    expect(html).toContain('<span class="tok-typeName">string</span>')
  })

  it('respects explicit plain and unknown languages instead of guessing', () => {
    const plain = renderMarkdown('```text\ninterface Plain { value: string }\n```\n')
    const unknown = renderMarkdown('```mermaid\ntype --> interface\n```\n')

    expect(plain).toContain('interface Plain { value: string }')
    expect(plain).not.toContain('tok-keyword')
    expect(unknown).toContain('class="language-mermaid"')
    expect(unknown).toContain('type --&gt; interface')
    expect(unknown).not.toContain('tok-keyword')
    expect(unknown).not.toContain('<svg')
  })

  it('renders viewer-generated Markdown without a Node Buffer global', () => {
    const buffer = globalThis.Buffer
    vi.stubGlobal('Buffer', undefined)
    try {
      const html = renderMarkdown('```mermaid\nstateDiagram-v2\n  ready --> running\n```\n')
      expect(html).toContain('class="language-mermaid"')
      expect(html).toContain('ready --&gt; running')
    } finally {
      vi.stubGlobal('Buffer', buffer)
    }
  })

  it('keeps highlighted code HTML-escaped', () => {
    const html = renderMarkdown(
      '```typescript\nconst value: string = "</code><script>alert(1)</script>"\n```\n',
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;/code&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders catalog-resolved inline code as an exact declaration link', () => {
    const value = 'Use `prepare()` now.'
    const text = '`prepare()`'
    const from = value.indexOf(text)
    const reference = {
      from,
      to: from + text.length,
      text,
      target: {
        spec: 'module/.spec/api.d.ts',
        source: 'module/.spec/api.d.ts',
        declaration: 'module/.spec/api.d.ts:function:prepare',
        kind: 'callable' as const,
      },
    }

    const document = renderMarkdownDocument('module/.spec/architecture.md', value)
    const html = projectMarkdownHtml(document, [reference])

    expect(html).toContain('<code>prepare()</code>')
    expect(html).toContain(semanticReferenceHref(reference).replaceAll('&', '&amp;'))
    expect(html).toContain('title="Open prepare() callable declaration"')
    expect(html).not.toContain('data-md-')
  })

  it('ignores drifted Markdown reference ranges instead of changing the document', () => {
    const value = 'Use `prepare()` now.'
    const html = projectMarkdownHtml(
      renderMarkdownDocument('module/.spec/architecture.md', value),
      [
        {
          from: 4,
          to: 15,
          text: '`renamed()`',
          target: {
            spec: 'module/.spec/api.d.ts',
            source: 'module/.spec/api.d.ts',
            declaration: 'renamed',
            kind: 'callable',
          },
        },
      ],
    )
    expect(html).toContain('<code>prepare()</code>')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('data-md-')
  })
})
