import { describe, expect, it } from 'vitest'

import { highlightedSourceHtml, highlightSourceCode, sourceLanguage } from '../source/syntax.ts'

describe('source syntax highlighting', () => {
  it('maps file-backed resources to their parser language', () => {
    expect(sourceLanguage('examples/accept-domain.ts')).toBe('typescript')
    expect(sourceLanguage('examples/component.tsx')).toBe('tsx')
    expect(sourceLanguage('schemas/domain.schema.json')).toBe('json')
    expect(sourceLanguage('rules/policy.yml')).toBe('yaml')
    expect(sourceLanguage('scripts/install.sh')).toBeUndefined()
  })

  it('produces reusable semantic tokens for TypeScript resources', () => {
    const highlighted = highlightSourceCode(
      'const input: unknown = JSON.parse(serializedDomainSchema)',
      sourceLanguage('accept-domain.ts'),
    )

    expect(highlighted?.language).toBe('typescript')
    expect(highlighted?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'const', classes: 'tok-keyword' }),
        expect.objectContaining({ text: 'unknown', classes: 'tok-typeName' }),
      ]),
    )
  })

  it('escapes source text when tokens are serialized for Markdown', () => {
    const highlighted = highlightSourceCode(
      'const value: string = "</code><script>alert(1)</script>"',
      'typescript',
    )!
    const html = highlightedSourceHtml(highlighted)

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;/code&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
