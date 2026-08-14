import type { CatalogSemanticReference } from '../../viewer-host/catalog.ts'

import { semanticReferenceHref } from '../../viewer-host/semantic-reference.ts'

export { semanticReferenceHref }

export function SemanticText({
  value,
  references = [],
}: {
  value: string
  references?: readonly CatalogSemanticReference[]
}) {
  if (references.length === 0) return <>{value}</>
  const children = []
  let cursor = 0
  for (const reference of references) {
    if (!validReference(value, reference, cursor)) continue
    if (reference.from > cursor) children.push(value.slice(cursor, reference.from))
    children.push(
      <a
        class="semantic-reference"
        href={semanticReferenceHref(reference)}
        title={`Open ${reference.text} ${reference.target.kind} declaration`}
        key={`${reference.from}:${reference.target.declaration}`}
      >
        {reference.text}
      </a>,
    )
    cursor = reference.to
  }
  if (cursor < value.length) children.push(value.slice(cursor))
  return <>{children}</>
}

export function validReference(
  value: string,
  reference: CatalogSemanticReference,
  minimum = 0,
): boolean {
  return (
    reference.from >= minimum &&
    reference.to > reference.from &&
    reference.to <= value.length &&
    value.slice(reference.from, reference.to) === reference.text
  )
}
