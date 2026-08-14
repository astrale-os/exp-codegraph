import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { MarkdownContent } from '../markdown/content.tsx'
import { routeHref } from '../shell/route.ts'
import { ModuleIcon } from '../shell/module-icon.tsx'
import {
  moduleTopologyIconPack,
  moduleTopologyMermaid,
} from './module-topology-diagram.ts'
import {
  buildModuleTopology,
  type ModuleTopology as ModuleTopologyModel,
  type ModuleTopologyIndex,
  type ModuleTopologyMode,
  type ModuleTopologyNode,
} from './module-topology-model.ts'

export function ModuleTopology({
  index,
  source,
}: {
  index: ModuleTopologyIndex
  source: string
}) {
  const topology = useMemo(() => buildModuleTopology(index, source), [index, source])
  return topology ? <ModuleTopologyContent topology={topology} /> : null
}

function ModuleTopologyContent({ topology }: { topology: ModuleTopologyModel }) {
  const [mode, setMode] = useState<ModuleTopologyMode>(() =>
    topology.dependencies.some(({ kind }) => kind === 'contract')
      ? 'dependencies'
      : 'composition',
  )
  const [includeContext, setIncludeContext] = useState(false)
  const root = useRef<HTMLElement>(null)

  const showContext = mode === 'dependencies' && includeContext
  const nodes = useMemo(
    () => showContext ? [...topology.modules, ...topology.context] : topology.modules,
    [showContext, topology],
  )
  const diagram = useMemo(
    () => moduleTopologyMermaid(topology, mode, showContext),
    [mode, showContext, topology],
  )
  const iconPacks = useMemo(
    () => [moduleTopologyIconPack(topology, showContext)],
    [showContext, topology],
  )
  const relationships = mode === 'composition'
    ? topology.composition.length
    : topology.dependencies.length + (showContext ? topology.contextDependencies.length : 0)
  const crossModuleDependencies = topology.dependencies.filter(
    ({ kind }) => kind === 'contract',
  ).length
  const scopeImports = topology.dependencies.length - crossModuleDependencies

  useEffect(() => {
    const container = root.current
    if (!container) return
    const decorate = () => {
      if (decorateTopologyNodes(container, nodes) === nodes.length) observer.disconnect()
    }
    const observer = new MutationObserver(decorate)
    observer.observe(container, { childList: true, subtree: true })
    decorate()
    return () => observer.disconnect()
  }, [diagram, nodes])

  const activate = (event: MouseEvent | KeyboardEvent) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return
    const origin = event.target
    if (!(origin instanceof Element)) return
    const node = origin.closest<SVGElement>('[data-topology-node]')
    const id = node?.dataset.topologyNode
    if (!id) return
    if (event instanceof KeyboardEvent) event.preventDefault()
    root.current
      ?.querySelector<HTMLAnchorElement>(`[data-topology-link="${id}"]`)
      ?.click()
  }

  return (
    <section
      ref={root}
      class="module-topology"
      data-mode={mode}
      aria-labelledby="module-topology-title"
      onClick={activate}
      onKeyDown={activate}
    >
      <header class="module-topology-header">
        <div>
          <p class="eyebrow">Compiled contracts</p>
          <h2 id="module-topology-title">Declared module dependencies</h2>
          <p>
            {mode === 'composition' ? (
              <>
                Ownership only · {topology.modules.length - 1} direct module
                {topology.modules.length === 2 ? '' : 's'}
              </>
            ) : (
              <>
                Contract imports · {crossModuleDependencies} cross-module
                {scopeImports > 0 && <> · {scopeImports} scope import{scopeImports === 1 ? '' : 's'}</>}
                {showContext && <> · {relationships - topology.dependencies.length} context</>}
              </>
            )}
          </p>
        </div>
        <div class="module-topology-controls">
          <div aria-label="Module topology view">
            {(['composition', 'dependencies'] as const).map((value) => (
              <button
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === 'composition' ? 'Composition' : 'Dependencies'}
              </button>
            ))}
          </div>
          {mode === 'dependencies' && topology.context.length > 0 && (
            <button
              type="button"
              class="module-topology-context"
              aria-pressed={includeContext}
              onClick={() => setIncludeContext((current) => !current)}
            >
              {includeContext ? 'Hide context' : `Show context · ${topology.context.length}`}
            </button>
          )}
        </div>
      </header>

      <div class="module-topology-diagram" aria-label={`${mode} module topology`}>
        <MarkdownContent
          key={diagram}
          value={`\`\`\`mermaid\n${diagram}\n\`\`\``}
          compact
          mermaidIconPacks={iconPacks}
        />
      </div>

      <nav class="module-topology-links" aria-label="Modules in this topology">
        {nodes.map((node) => (
          <a
            key={node.id}
            href={routeHref(node.source)}
            data-topology-link={node.id}
            data-kind={node.kind}
            title={node.source}
          >
            <ModuleIcon icon={node.entry.icon} />
            <span translate={false}>{node.label}</span>
            {node.kind !== 'context' && (
              <span class={`status-dot status-${node.entry.metrics.status}`} />
            )}
          </a>
        ))}
      </nav>
    </section>
  )
}

function decorateTopologyNodes(root: HTMLElement, nodes: readonly ModuleTopologyNode[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let decorated = 0
  for (const element of root.querySelectorAll<SVGGElement>(
    '.markdown-mermaid-diagram g.node, .markdown-mermaid-diagram g.icon-shape',
  )) {
    const node = byId.get(mermaidNodeId(element.id))
    if (!node) continue
    element.dataset.topologyNode = node.id
    element.setAttribute('role', 'link')
    element.setAttribute('tabindex', '0')
    element.setAttribute('aria-label', `Open ${node.label} module`)
    decorated += 1
  }
  return decorated
}

function mermaidNodeId(renderedId: string): string {
  const match = /(?:^|-)flowchart-(.+)-\d+$/u.exec(renderedId)
  return match?.[1] ?? renderedId
}
