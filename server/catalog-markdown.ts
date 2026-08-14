import type { CatalogSemanticReference } from '../viewer-host/catalog.ts'

import { semanticReferenceHref } from '../viewer-host/semantic-reference.ts'

interface CatalogMarkdownDocument {
  readonly text: string
  readonly html: string
}

const inlineCodeMarker = /<code data-md-from="(\d+)" data-md-to="(\d+)">([\s\S]*?)<\/code>/g

/** Consume internal render markers and project resolved links into ready-to-paint safe HTML. */
export function projectMarkdownHtml(
  document: CatalogMarkdownDocument,
  references: readonly CatalogSemanticReference[],
): string {
  const resolved = new Map<string, CatalogSemanticReference>(
    references
      .filter((reference) => validReference(document.text, reference))
      .map((reference) => [`${reference.from}:${reference.to}`, reference] as const),
  )
  return document.html.replace(
    inlineCodeMarker,
    (_match, fromText: string, toText: string, content: string) => {
      const reference = resolved.get(`${fromText}:${toText}`)
      const code = `<code>${content}</code>`
      if (!reference) return code
      const label = inlineCodeLabel(reference.text)
      const href = escapeAttribute(semanticReferenceHref(reference))
      const title = escapeAttribute(`Open ${label} ${reference.target.kind} declaration`)
      return `<a class="semantic-reference" href="${href}" title="${title}">${code}</a>`
    },
  )
}

function validReference(text: string, reference: CatalogSemanticReference): boolean {
  return (
    reference.from >= 0 &&
    reference.to > reference.from &&
    reference.to <= text.length &&
    text.slice(reference.from, reference.to) === reference.text
  )
}

function inlineCodeLabel(value: string): string {
  const delimiters = /^(`+)[\s\S]*\1$/u.exec(value)?.[1].length ?? 0
  return delimiters ? value.slice(delimiters, -delimiters).trim() : value
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
