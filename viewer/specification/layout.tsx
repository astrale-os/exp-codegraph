import type { LayoutObservedKind, LayoutResource } from '../../specification/resource/index.ts'

import { RawSource } from '../source/raw.tsx'

export type LayoutTreeStatus = 'matched' | 'missing' | 'mismatch' | 'additional' | 'observed'

export interface LayoutTreeRow {
  readonly path: string
  readonly name: string
  readonly kind: LayoutObservedKind
  readonly status: LayoutTreeStatus
  readonly observedKind?: LayoutObservedKind
  readonly prefix: string
  readonly level: number
}

interface LayoutNode extends Omit<LayoutTreeRow, 'prefix' | 'level'> {
  readonly order: number
  readonly children: LayoutNode[]
}

/** Produce the compact ASCII-like tree projection used by the viewer and tests. */
export function layoutTreeRows(resource: LayoutResource): LayoutTreeRow[] {
  const status = new Map(resource.observation.entries.map((entry) => [entry.path, entry] as const))
  const nodes = new Map<string, LayoutNode>()
  resource.entries.forEach((entry, order) => {
    const observation = status.get(entry.path)
    nodes.set(stem(entry.path), {
      path: entry.path,
      name: leaf(entry.path),
      kind: entry.kind,
      status: observation?.status ?? 'missing',
      ...(observation?.observedKind ? { observedKind: observation.observedKind } : {}),
      order,
      children: [],
    })
  })
  resource.observation.additional.forEach((entry, index) => {
    nodes.set(stem(entry.path), {
      path: entry.path,
      name: leaf(entry.path),
      kind: entry.kind,
      status: resource.exact ? 'additional' : 'observed',
      order: resource.entries.length + index,
      children: [],
    })
  })

  const roots: LayoutNode[] = []
  for (const node of nodes.values()) {
    const parent = nodes.get(parentStem(node.path))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const rows: LayoutTreeRow[] = []
  appendRows(sortNodes(roots), [], rows)
  return rows
}

export function LayoutView({ resource }: { resource: LayoutResource }) {
  const rows = layoutTreeRows(resource)
  const matched = resource.observation.entries.filter((entry) => entry.status === 'matched').length
  const exact = resource.exact === true
  const ignored = resource.ignore ?? []
  return (
    <section class="module-layout-view">
      <header class="module-layout-header">
        <div>
          <p class="eyebrow">Physical ownership</p>
          <h2>Module layout</h2>
          <small>
            {matched}/{resource.entries.length} declared paths match
            {resource.observation.additional.length
              ? ` · ${resource.observation.additional.length} ${exact ? 'additional' : 'observed'}`
              : ''}
          </small>
        </div>
        <div class="module-layout-legend" aria-label="Layout status legend">
          <span data-status="matched">
            <i aria-hidden="true" />
            Matched
          </span>
          <span data-status="missing">
            <i aria-hidden="true" />
            Missing
          </span>
          <span data-status={exact ? 'additional' : 'observed'}>
            <i aria-hidden="true" />
            {exact ? 'Additional' : 'Observed'}
          </span>
        </div>
      </header>
      <div class="module-layout-tree" role="tree" aria-label="Physical module ownership tree">
        {rows.map((row) => (
          <div
            class="module-layout-row"
            data-status={row.status}
            role="treeitem"
            aria-level={row.level}
            aria-label={layoutRowLabel(row)}
            key={`${row.status}:${row.path}`}
          >
            <span class="module-layout-prefix" aria-hidden="true">
              {row.prefix}
            </span>
            <i class="module-layout-status" aria-hidden="true" />
            <code class="module-layout-path">{row.name}</code>
            {row.status !== 'matched' && (
              <small class="module-layout-state">{statusLabel(row)}</small>
            )}
          </div>
        ))}
      </div>
      {ignored.length > 0 && (
        <div class="module-layout-ignore" aria-label="Ignored layout patterns">
          {ignored.map(({ pattern, source }) => (
            <code
              title={`${source === 'default' ? 'Default' : 'Layout-authored'} ignore pattern`}
              key={`${source}:${pattern}`}
            >
              {pattern}
            </code>
          ))}
        </div>
      )}
      <details class="module-descriptor-source module-layout-source">
        <summary>Source</summary>
        <RawSource name={resource.source} text={resource.text} />
      </details>
    </section>
  )
}

function appendRows(
  nodes: readonly LayoutNode[],
  ancestors: readonly boolean[],
  rows: LayoutTreeRow[],
) {
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1
    const prefix =
      ancestors.map((ancestorLast) => (ancestorLast ? '   ' : '│  ')).join('') +
      (ancestors.length ? (last ? '└─ ' : '├─ ') : '')
    const { order: _order, children, ...row } = node
    rows.push({ ...row, prefix, level: ancestors.length + 1 })
    appendRows(sortNodes(children), [...ancestors, last], rows)
  })
}

function sortNodes(nodes: readonly LayoutNode[]): LayoutNode[] {
  return [...nodes].sort(
    (left, right) => left.order - right.order || compare(left.path, right.path),
  )
}

function layoutRowLabel(row: LayoutTreeRow): string {
  return `${row.path}: ${statusLabel(row)}`
}

function statusLabel(row: LayoutTreeRow): string {
  if (row.status === 'matched') return 'matched'
  if (row.status === 'missing') return 'missing'
  if (row.status === 'additional') return 'undeclared'
  if (row.status === 'observed') return 'observed'
  return `expected ${row.kind}, found ${row.observedKind ?? 'other'}`
}

function leaf(path: string): string {
  const value = stem(path).split('/').at(-1) ?? path
  return path.endsWith('/') ? `${value}/` : value
}

function parentStem(path: string): string {
  const parts = stem(path).split('/')
  return parts.slice(0, -1).join('/')
}

function stem(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
