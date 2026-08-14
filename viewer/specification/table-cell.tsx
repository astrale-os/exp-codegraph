import { MarkdownContent } from '../markdown/content.tsx'
import { renderFormalMath } from './formal.ts'

const HEADER_LABELS: Readonly<Record<string, string>> = {
  id: 'ID',
  status: 'Status',
  statement: 'Statement',
  logic: 'Formal logic',
  decision: 'Decision',
  impact: 'Impact',
  title: 'Title',
  detail: 'Rationale',
  selection: 'Resolution',
  target: 'Grounding',
}

export function tableHeaderLabel(column: string): string {
  return HEADER_LABELS[column] ?? humanize(column)
}

export function tableTabLabel(reference: string): string {
  const file = reference.split('/').at(-1) ?? reference
  return file.replace(/\.tsv$/i, '')
}

export function TableCell({ column, value }: { column: string; value: string }) {
  if (!value)
    return (
      <span class="table-empty" aria-label="Not specified">
        —
      </span>
    )

  switch (column) {
    case 'id':
      return <code class="table-identity">{value}</code>
    case 'status':
      return <StatusBadge value={value} />
    case 'impact':
      return <span class={`table-impact table-impact-${token(value)}`}>{value}</span>
    case 'statement':
      return <MarkdownContent value={value} compact />
    case 'logic':
      return <Logic value={value} />
    case 'decision':
    case 'detail':
      return <DocumentReference value={value} />
    case 'target':
      return <GroundingReference value={value} />
    case 'selection':
      return <code class="table-selection">{value}</code>
    case 'title':
      return <strong class="table-title">{value}</strong>
    default:
      return <span class="table-value">{value}</span>
  }
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span class={`table-status table-status-${token(value)}`}>
      <span aria-hidden="true" />
      {value}
    </span>
  )
}

function Logic({ value }: { value: string }) {
  const markup = renderFormalMath(value)
  if (!markup) return <code class="table-logic-fallback">{value}</code>
  return <span class="table-logic" title={value} dangerouslySetInnerHTML={{ __html: markup }} />
}

function DocumentReference({ value }: { value: string }) {
  const hash = value.lastIndexOf('#')
  const source = hash >= 0 ? value.slice(0, hash) : ''
  const identity = hash >= 0 ? value.slice(hash + 1) : value
  return (
    <span class="table-document-reference" title={value}>
      <span class="table-reference-mark" aria-hidden="true">
        §
      </span>
      <span>
        <code>{identity}</code>
        {source && <small>{source}</small>}
      </span>
    </span>
  )
}

function GroundingReference({ value }: { value: string }) {
  const separator = value.indexOf(':')
  if (separator < 0) return <code class="table-selection">{value}</code>
  const kind = value.slice(0, separator)
  const reference = value.slice(separator + 1)
  return (
    <span class="table-grounding" title={value}>
      <span class={`table-grounding-kind table-grounding-kind-${token(kind)}`}>{kind}</span>
      <code>{reference}</code>
    </span>
  )
}

function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`
}

function token(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}
