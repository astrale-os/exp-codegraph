import type { ComponentChildren } from 'preact'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

export function SourceToolbar({
  name,
  state,
  message,
  copied,
  onCopy,
  children,
}: {
  name: string
  state: SaveState
  message: string
  copied: boolean
  onCopy(): void
  children?: ComponentChildren
}) {
  return (
    <header class="source-toolbar">
      <div class="source-identity">
        <FileIcon />
        <strong>{name}</strong>
        <span class="source-state" data-state={state}>
          <i aria-hidden="true" />
          {message}
        </span>
      </div>
      <div class="source-actions">
        <button class="source-action source-action-secondary" type="button" onClick={onCopy}>
          <CopyIcon />
          {copied ? 'Copied' : 'Copy'}
        </button>
        {children}
      </div>
    </header>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.8h6l4 4V17H5z" />
      <path d="M11 2.8V7h4" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />
    </svg>
  )
}

export function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 3.5h11l2 2V16.5h-13z" />
      <path d="M6.5 3.5v5h7v-5M6.5 16.5v-5h7v5" />
    </svg>
  )
}

export function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 7.5V3.8M4.5 3.8h3.7" />
      <path d="M5.2 5.2a6 6 0 1 1-1 6.1" />
    </svg>
  )
}
