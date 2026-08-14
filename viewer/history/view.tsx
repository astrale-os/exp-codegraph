import { useEffect, useId, useState } from 'preact/hooks'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type { HistoryResource, MarkdownResource } from '../../specification/resource/index.ts'

import { HISTORY_RESOURCE_ENDPOINT } from '../../viewer-host/catalog.ts'
import { MarkdownContent } from '../markdown/content.tsx'

export function ContextView({ documents }: { documents: readonly MarkdownResource[] }) {
  const [selectedRef, setSelectedRef] = useState(documents[0]?.ref)
  const selectedIndex = Math.max(
    0,
    documents.findIndex((resource) => resource.ref === selectedRef),
  )
  const selected = documents[selectedIndex]
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const tabsId = useId()

  useEffect(() => {
    if (!selected) return
    setSelectedRef(selected.ref)
    setMode('rendered')
  }, [selected?.ref])

  if (!selected) return null
  const identity = `${selected.document.source}${selected.document.fragment ? `#${selected.document.fragment}` : ''}`
  return (
    <div class="context-view">
      {documents.length > 1 && (
        <nav class="context-files" aria-label="Context files" role="tablist">
          {documents.map((resource, index) => (
            <button
              key={resource.ref}
              id={`${tabsId}-tab-${index}`}
              type="button"
              role="tab"
              aria-controls={`${tabsId}-panel`}
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => setSelectedRef(resource.ref)}
              onKeyDown={(event) => {
                const next = nextTabIndex(event.key, index, documents.length)
                if (next === undefined) return
                event.preventDefault()
                setSelectedRef(documents[next]!.ref)
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  )
                tabs?.[next]?.focus()
              }}
            >
              <ContextFileIcon />
              <span>
                <strong>{resource.document.source.split('/').at(-1)}</strong>
                {resource.document.fragment && <small>#{resource.document.fragment}</small>}
              </span>
            </button>
          ))}
        </nav>
      )}
      <article
        class="context-document"
        id={documents.length > 1 ? `${tabsId}-panel` : undefined}
        role={documents.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={documents.length > 1 ? `${tabsId}-tab-${selectedIndex}` : undefined}
      >
        <header class="context-document-header">
          <span class="context-document-icon" aria-hidden="true">
            <ContextFileIcon />
          </span>
          <span class="context-document-identity">
            <strong>{selected.document.source.split('/').at(-1)}</strong>
            <code title={identity}>{identity}</code>
          </span>
          <span class="context-format">MD</span>
          <span class="context-modes" aria-label="Markdown presentation">
            <button
              type="button"
              aria-pressed={mode === 'rendered'}
              onClick={() => setMode('rendered')}
            >
              Rendered
            </button>
            <button
              type="button"
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              Source
            </button>
          </span>
        </header>
        {mode === 'rendered' ? (
          <div class="context-markdown">
            <MarkdownContent value={selected.document.text} html={selected.document.html} />
          </div>
        ) : (
          <pre class="context-source" tabindex={0}>
            <code>{selected.document.text}</code>
          </pre>
        )}
      </article>
    </div>
  )
}

export function ModuleHistoryView({
  resources,
  diagnostics,
}: {
  resources: readonly HistoryResource[]
  diagnostics: readonly Diagnostic[]
}) {
  const [selectedRef, setSelectedRef] = useState(resources[0]?.ref)
  const selectedIndex = Math.max(
    0,
    resources.findIndex((resource) => resource.ref === selectedRef),
  )
  const selected = resources[selectedIndex]
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const tabsId = useId()

  useEffect(() => {
    if (!selected) return
    setSelectedRef(selected.ref)
    setMode('rendered')
  }, [selected?.ref])

  return (
    <div class="context-view">
      {diagnostics.length > 0 && (
        <aside class="context-diagnostics" role="status">
          <strong>Some optional history could not be loaded.</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.file}:${diagnostic.code}:${index}`}>
                <code>{diagnostic.file}</code> {diagnostic.message}
              </li>
            ))}
          </ul>
        </aside>
      )}
      {selected && (
        <>
          {resources.length > 1 && (
            <nav class="context-files" aria-label="Context files" role="tablist">
              {resources.map((resource, index) => (
                <button
                  key={resource.ref}
                  id={`${tabsId}-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-controls={`${tabsId}-panel`}
                  aria-selected={index === selectedIndex}
                  tabIndex={index === selectedIndex ? 0 : -1}
                  onClick={() => setSelectedRef(resource.ref)}
                  onKeyDown={(event) => {
                    const next = nextTabIndex(event.key, index, resources.length)
                    if (next === undefined) return
                    event.preventDefault()
                    setSelectedRef(resources[next]!.ref)
                  }}
                >
                  <ContextFileIcon />
                  <span>
                    <strong>{resource.name}</strong>
                    <small>{formatBytes(resource.size)}</small>
                  </span>
                </button>
              ))}
            </nav>
          )}
          <article
            class="context-document"
            id={resources.length > 1 ? `${tabsId}-panel` : undefined}
            role={resources.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={resources.length > 1 ? `${tabsId}-tab-${selectedIndex}` : undefined}
          >
            <header class="context-document-header">
              <span class="context-document-icon" aria-hidden="true">
                <ContextFileIcon />
              </span>
              <span class="context-document-identity">
                <strong>{selected.name}</strong>
                <code title={selected.source}>{selected.source}</code>
              </span>
              <span class="context-format">{contextFormat(selected)}</span>
              {selected.document && (
                <span class="context-modes" aria-label="Markdown presentation">
                  <button
                    type="button"
                    aria-pressed={mode === 'rendered'}
                    onClick={() => setMode('rendered')}
                  >
                    Rendered
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'source'}
                    onClick={() => setMode('source')}
                  >
                    Source
                  </button>
                </span>
              )}
            </header>
            <HistoryResourceBody resource={selected} mode={mode} />
          </article>
        </>
      )}
    </div>
  )
}

function HistoryResourceBody({
  resource,
  mode,
}: {
  resource: HistoryResource
  mode: 'rendered' | 'source'
}) {
  const url = historyResourceUrl(resource)
  if (resource.document && mode === 'rendered') {
    return (
      <div class="context-markdown">
        <MarkdownContent value={resource.document.text} html={resource.document.html} />
      </div>
    )
  }
  if (resource.text !== undefined) {
    return (
      <pre class="context-source" tabindex={0}>
        <code>{resource.text}</code>
      </pre>
    )
  }
  if (resource.presentation === 'image') {
    return <img class="context-image" src={url} alt={resource.name} />
  }
  if (resource.presentation === 'pdf') {
    return (
      <iframe
        class="context-pdf"
        src={url}
        title={resource.name}
        sandbox=""
        referrerpolicy="no-referrer"
      />
    )
  }
  return (
    <div class="context-download">
      <p>This file is available as inert history and has no inline text presentation.</p>
      <a href={url} download={resource.name}>
        Download {resource.name}
      </a>
    </div>
  )
}

export function historyResourceUrl(resource: Pick<HistoryResource, 'source' | 'revision'>): string {
  return `${HISTORY_RESOURCE_ENDPOINT}?${new URLSearchParams({
    source: resource.source,
    revision: resource.revision,
  })}`
}

function contextFormat(resource: HistoryResource): string {
  if (resource.presentation === 'markdown') return 'MD'
  if (resource.presentation === 'pdf') return 'PDF'
  if (resource.presentation === 'image')
    return resource.mediaType.split('/')[1]?.toUpperCase() ?? 'IMG'
  if (resource.presentation === 'text') return 'TEXT'
  return 'FILE'
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${Math.round(value / 1_024)} KiB`
  return `${Math.round((value / (1_024 * 1_024)) * 10) / 10} MiB`
}

function nextTabIndex(key: string, current: number, length: number): number | undefined {
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  if (key === 'ArrowLeft') return (current - 1 + length) % length
  if (key === 'ArrowRight') return (current + 1) % length
  return undefined
}

function ContextFileIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 5h15v10h-15z" />
      <path d="M5 12.5v-5l2.4 2.7 2.4-2.7v5M12 10l1.6 2.2L15.2 10M13.6 7.5v4.7" />
    </svg>
  )
}
