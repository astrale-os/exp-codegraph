import { useMemo, useState } from 'preact/hooks'

import type { SourceSyntaxToken } from '../../source/syntax.ts'

import { highlightSourceCode, sourceLanguage } from '../../source/syntax.ts'
import { copyText } from './clipboard.ts'
import { SourceToolbar } from './toolbar.tsx'

export interface RawSourceLink {
  readonly from: number
  readonly to: number
  readonly href: string
  readonly title: string
}

export function RawSource({
  name,
  label = name,
  message = 'Read only',
  text,
  links = [],
}: {
  name: string
  label?: string
  message?: string
  text: string
  links?: readonly RawSourceLink[]
}) {
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => highlightSourceCode(text, sourceLanguage(name)), [name, text])
  const copy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
    void copyText(text)
  }
  return (
    <section class="source-file raw-source" aria-label={`${label} source`}>
      <SourceToolbar name={label} state="saved" message={message} copied={copied} onCopy={copy} />
      <pre tabindex={0}>
        <code class={highlighted ? `language-${highlighted.language}` : undefined}>
          {renderSource(highlighted?.tokens ?? [{ text }], links, text.length)}
        </code>
      </pre>
    </section>
  )
}

function renderSource(
  tokens: readonly SourceSyntaxToken[],
  values: readonly RawSourceLink[],
  length: number,
) {
  const links = [...values]
    .filter((link) => link.from >= 0 && link.from < link.to && link.to <= length)
    .sort((left, right) => left.from - right.from || left.to - right.to)
  let offset = 0
  let key = 0
  return tokens.flatMap((token) => {
    const start = offset
    const end = start + token.text.length
    offset = end
    const overlapping = links.filter((link) => link.from < end && link.to > start)
    if (!overlapping.length) {
      return [sourceSpan(token.text, token.classes, key++)]
    }
    const output = []
    let cursor = start
    for (const link of overlapping) {
      const from = Math.max(cursor, link.from, start)
      const to = Math.min(link.to, end)
      if (from > cursor) {
        output.push(
          sourceSpan(token.text.slice(cursor - start, from - start), token.classes, key++),
        )
      }
      if (to > from) {
        output.push(
          <a class="source-reference" href={link.href} title={link.title} key={key++}>
            {sourceSpan(token.text.slice(from - start, to - start), token.classes, key++)}
          </a>,
        )
      }
      cursor = Math.max(cursor, to)
    }
    if (cursor < end) {
      output.push(sourceSpan(token.text.slice(cursor - start), token.classes, key++))
    }
    return output
  })
}

function sourceSpan(text: string, classes: string | undefined, key: number) {
  return (
    <span class={classes} key={key}>
      {text}
    </span>
  )
}
