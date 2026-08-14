import type { Mermaid, MermaidConfig } from 'mermaid'

let mermaidEngine: Promise<Mermaid> | undefined
let mermaidRenderQueue: Promise<void> = Promise.resolve()
let diagramSequence = 0

export interface MermaidIconPack {
  readonly name: string
  readonly icons: {
    readonly prefix: string
    readonly width?: number
    readonly height?: number
    readonly icons: Readonly<Record<string, { readonly body: string }>>
  }
}

/** Upgrade inert Mermaid code fences without making Markdown itself executable. */
export function renderMermaidDiagrams(
  root: ParentNode,
  iconPacks: readonly MermaidIconPack[] = [],
): () => void {
  const controller = new AbortController()
  const blocks = root.querySelectorAll<HTMLElement>(
    'pre:not([data-mermaid-state]) > code.language-mermaid',
  )

  for (const code of blocks) {
    const source = code.parentElement
    if (!source || source.tagName !== 'PRE') continue
    source.dataset.mermaidState = 'loading'
    source.setAttribute('aria-busy', 'true')
    void enqueueMermaidRender(() =>
      renderMermaidDiagram(source, code.textContent ?? '', iconPacks, controller.signal),
    )
  }

  return () => controller.abort()
}

async function renderMermaidDiagram(
  source: HTMLElement,
  definition: string,
  iconPacks: readonly MermaidIconPack[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  try {
    const mermaid = await loadMermaid()
    if (signal.aborted) return
    mermaid.registerIconPacks([...iconPacks])
    mermaid.initialize(configuration())
    const { svg, bindFunctions } = await mermaid.render(nextDiagramId(), definition)
    if (signal.aborted) return

    const figure = document.createElement('figure')
    figure.className = 'markdown-mermaid'

    const diagram = document.createElement('div')
    diagram.className = 'markdown-mermaid-diagram'
    diagram.innerHTML = svg
    const renderedSvg = diagram.querySelector('svg')
    if (
      renderedSvg &&
      !renderedSvg.hasAttribute('aria-label') &&
      !renderedSvg.hasAttribute('aria-labelledby') &&
      !renderedSvg.querySelector('title')
    ) {
      renderedSvg.setAttribute('aria-label', 'Mermaid diagram')
    }
    bindFunctions?.(diagram)

    const details = document.createElement('details')
    details.className = 'markdown-mermaid-source'
    const summary = document.createElement('summary')
    summary.textContent = 'Mermaid source'
    source.removeAttribute('aria-busy')
    source.dataset.mermaidState = 'rendered'

    source.replaceWith(figure)
    details.append(summary, source)
    figure.append(diagram, details)
  } catch (error) {
    if (signal.aborted) return
    source.removeAttribute('aria-busy')
    source.dataset.mermaidState = 'error'
    const notice = document.createElement('p')
    notice.className = 'markdown-mermaid-error'
    notice.setAttribute('role', 'alert')
    notice.textContent = `Mermaid could not render this diagram: ${errorSummary(error)}`
    source.before(notice)
  }
}

/** Mermaid owns mutable global configuration, so rendering must remain serial. */
function enqueueMermaidRender(render: () => Promise<void>): Promise<void> {
  const queued = mermaidRenderQueue.then(render, render)
  mermaidRenderQueue = queued.catch(() => undefined)
  return queued
}

function loadMermaid(): Promise<Mermaid> {
  return (mermaidEngine ??= import('mermaid/dist/mermaid.esm.min.mjs').then(
    ({ default: mermaid }) => mermaid,
  ))
}

function configuration(): MermaidConfig {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: dark ? 'dark' : 'neutral',
  }
}

function nextDiagramId(): string {
  diagramSequence += 1
  return `astrale-spec-mermaid-${diagramSequence}`
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const summary = message
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!summary) return 'Unknown rendering error.'
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary
}
