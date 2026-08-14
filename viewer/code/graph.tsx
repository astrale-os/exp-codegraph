import { useMemo, useState } from 'preact/hooks'

import type {
  ViewerCodeAnalysis as CodeAnalysis,
  ViewerCodeDependency as CodeDependency,
  ViewerCodeModule as CodeModule,
} from '../../viewer-host/code.ts'

type GraphMode = 'runtime' | 'type'
type GraphLevel = 'area' | 'module'

interface Position {
  readonly x: number
  readonly y: number
}

interface GraphEntity {
  readonly id: string
  readonly label: string
  readonly area: string
  readonly tone: number
  readonly modules: number
  readonly files: number
  readonly codeLines: number
}

interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly count: number
}

const NODE_WIDTH = 214
const NODE_HEIGHT = 82

export function CodeDependencyGraph({ analysis }: { analysis: CodeAnalysis }) {
  const [mode, setMode] = useState<GraphMode>(() =>
    analysis.dependencies.some(
      (dependency) =>
        !dependency.external &&
        dependency.sourceModule !== dependency.targetModule &&
        !dependency.typeOnly,
    )
      ? 'runtime'
      : 'type',
  )
  const [level, setLevel] = useState<GraphLevel>('area')
  const [focused, setFocused] = useState<string>()
  const tones = useMemo(
    () => codeAreaTones(analysis.modules.map((module) => module.path)),
    [analysis.modules],
  )
  const entities = useMemo(
    () => graphEntities(analysis.modules, level, tones),
    [analysis.modules, level, tones],
  )
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  )
  const edges = useMemo(
    () => graphEdges(analysis.dependencies, mode, level),
    [analysis.dependencies, level, mode],
  )
  const layout = useMemo(() => graphLayout(entities), [entities])
  const cyclic = useMemo(() => {
    const modules = new Set(
      analysis.cycles.filter((cycle) => cycle.kind === mode).flatMap((cycle) => cycle.modules),
    )
    return new Set(level === 'area' ? [...modules].map(codeArea) : [...modules])
  }, [analysis.cycles, level, mode])
  const neighbors = useMemo(
    () => (focused ? graphNeighbors(focused, edges) : undefined),
    [edges, focused],
  )
  const importCount = useMemo(() => edges.reduce((sum, edge) => sum + edge.count, 0), [edges])

  return (
    <section class="code-panel code-graph-panel">
      <header class="code-panel-header code-graph-header">
        <div>
          <p class="eyebrow">Resolved architecture</p>
          <h3>Implementation dependency graph</h3>
          <p>
            {level === 'area'
              ? 'Owned source areas and compiler-resolved specification boundaries.'
              : 'Exact TypeScript imports between source directories and specified modules.'}
          </p>
        </div>
        <div class="code-graph-controls">
          <Segmented
            label="Dependency graph detail"
            value={level}
            options={[
              ['area', 'Areas'],
              ['module', 'Modules'],
            ]}
            onChange={(value) => {
              setLevel(value)
              setFocused(undefined)
            }}
          />
          <Segmented
            label="Dependency graph kind"
            value={mode}
            options={[
              ['runtime', 'Runtime'],
              ['type', 'Types'],
            ]}
            onChange={(value) => {
              setMode(value)
              setFocused(undefined)
            }}
          />
        </div>
      </header>

      {entities.length ? (
        <div class="code-graph-scroll">
          <svg
            class={`code-graph code-graph-${mode} code-graph-${level}`}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{ minWidth: `${layout.width}px` }}
            role="img"
            aria-label={`${mode === 'runtime' ? 'Runtime' : 'Type-only'} dependencies among ${entities.length} ${level === 'area' ? 'source areas' : 'internal modules'}`}
          >
            <defs>
              <marker
                id={`code-arrow-${mode}-${level}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const source = layout.positions.get(edge.source)!
              const target = layout.positions.get(edge.target)!
              const sourceEntity = entityById.get(edge.source)!
              const muted = focused && edge.source !== focused && edge.target !== focused
              return (
                <g
                  class={`code-graph-edge code-area-${sourceEntity.tone}${muted ? ' code-graph-muted' : ''}`}
                  key={`${edge.source}:${edge.target}`}
                >
                  <path
                    d={edgePath(source, target)}
                    marker-end={`url(#code-arrow-${mode}-${level})`}
                  />
                  {edge.count > 1 && (
                    <text
                      x={(source.x + target.x) / 2}
                      y={(source.y + target.y) / 2 - 8}
                      text-anchor="middle"
                    >
                      {edge.count}
                    </text>
                  )}
                </g>
              )
            })}
            {entities.map((entity) => {
              const position = layout.positions.get(entity.id)!
              const isCyclic = cyclic.has(entity.id)
              const muted = focused && !neighbors?.has(entity.id)
              return (
                <g
                  class={`code-graph-node code-area-${entity.tone}${isCyclic ? ' code-graph-node-cycle' : ''}${muted ? ' code-graph-muted' : ''}`}
                  transform={`translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT / 2})`}
                  key={entity.id}
                  role="button"
                  tabIndex={0}
                  onMouseEnter={() => setFocused(entity.id)}
                  onMouseLeave={() => setFocused(undefined)}
                  onFocus={() => setFocused(entity.id)}
                  onBlur={() => setFocused(undefined)}
                >
                  <title>{`${entity.id} — ${entity.modules} ${entity.modules === 1 ? 'module' : 'modules'}, ${entity.files} ${entity.files === 1 ? 'file' : 'files'}, ${format(entity.codeLines)} code lines`}</title>
                  <rect
                    class="code-graph-node-body"
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx="12"
                  />
                  <rect
                    class="code-graph-node-accent"
                    width="5"
                    height={NODE_HEIGHT - 16}
                    x="8"
                    y="8"
                    rx="2.5"
                  />
                  <text class="code-graph-node-name" x="22" y="29">
                    {shortPath(entity.label)}
                  </text>
                  {level === 'area' && (
                    <text class="code-graph-node-loc" x={NODE_WIDTH - 18} y="29" text-anchor="end">
                      {format(entity.codeLines)} LOC
                    </text>
                  )}
                  <text class="code-graph-node-meta" x="22" y="57">
                    <tspan class="code-graph-node-value">{format(entity.files)}</tspan>
                    <tspan> {entity.files === 1 ? 'file' : 'files'}</tspan>
                    {level === 'area' && (
                      <tspan>
                        {' · '}
                        <tspan class="code-graph-node-value">{entity.modules}</tspan>{' '}
                        {entity.modules === 1 ? 'module' : 'modules'}
                      </tspan>
                    )}
                    {level === 'module' && (
                      <tspan x={NODE_WIDTH - 18} text-anchor="end" class="code-graph-node-loc">
                        {format(entity.codeLines)} LOC
                      </tspan>
                    )}
                  </text>
                  {isCyclic && (
                    <circle class="code-graph-cycle-dot" cx={NODE_WIDTH - 17} cy="18" r="5" />
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      ) : (
        <p class="code-empty">No internal source modules were observed.</p>
      )}

      <footer class="code-graph-legend">
        <span>
          <i class={`code-legend-line code-legend-${mode}`} /> resolved dependency
        </span>
        <span>
          <i class="code-legend-cycle" /> participates in a verified cycle
        </span>
        <span class="code-graph-focus-hint">Focus a node to isolate its neighborhood</span>
        <strong>
          {edges.length} {level === 'area' ? 'area' : 'module'} relationships ·{' '}
          {format(importCount)} resolved cross-{level} imports
        </strong>
      </footer>
    </section>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange(value: T): void
}) {
  return (
    <div class="code-segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          type="button"
          class={value === option ? 'selected' : undefined}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          key={option}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function graphEntities(
  modules: readonly CodeModule[],
  level: GraphLevel,
  tones: ReadonlyMap<string, number>,
): GraphEntity[] {
  if (level === 'module') {
    return [...modules]
      .sort(
        (left, right) =>
          codeArea(left.path).localeCompare(codeArea(right.path)) ||
          left.path.localeCompare(right.path),
      )
      .map((module) => ({
        id: module.path,
        label: module.path === '.' ? 'root' : module.path,
        area: codeArea(module.path),
        tone: tones.get(codeArea(module.path)) ?? 0,
        modules: 1,
        files: module.files,
        codeLines: module.lines.code,
      }))
  }
  return areaEntities(modules, tones)
}

function graphEdges(
  dependencies: readonly CodeDependency[],
  mode: GraphMode,
  level: GraphLevel,
): GraphEdge[] {
  const grouped = new Map<string, GraphEdge>()
  for (const dependency of dependencies) {
    if (dependency.external || (mode === 'type' ? !dependency.typeOnly : dependency.typeOnly)) {
      continue
    }
    const source = level === 'area' ? codeArea(dependency.sourceModule) : dependency.sourceModule
    const target = level === 'area' ? codeArea(dependency.targetModule) : dependency.targetModule
    if (source === target) continue
    const key = `${source}\0${target}`
    const current = grouped.get(key)
    grouped.set(key, { source, target, count: (current?.count ?? 0) + 1 })
  }
  return [...grouped.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target),
  )
}

function areaEntities(
  modules: readonly CodeModule[],
  tones: ReadonlyMap<string, number>,
): GraphEntity[] {
  const grouped = new Map<string, GraphEntity>()
  for (const module of modules) {
    const area = codeArea(module.path)
    const current = grouped.get(area)
    grouped.set(area, {
      id: area,
      label: area,
      area,
      tone: tones.get(area) ?? 0,
      modules: (current?.modules ?? 0) + 1,
      files: (current?.files ?? 0) + module.files,
      codeLines: (current?.codeLines ?? 0) + module.lines.code,
    })
  }
  return [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function graphNeighbors(focused: string, edges: readonly GraphEdge[]): ReadonlySet<string> {
  const neighbors = new Set([focused])
  for (const edge of edges) {
    if (edge.source === focused) neighbors.add(edge.target)
    if (edge.target === focused) neighbors.add(edge.source)
  }
  return neighbors
}

function graphLayout(entities: readonly GraphEntity[]) {
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(entities.length * 1.35))))
  const rows = Math.max(1, Math.ceil(entities.length / columns))
  const width = Math.max(660, columns * 270 + 90)
  const height = Math.max(220, rows * 144 + 70)
  const positions = new Map<string, Position>()
  entities.forEach((entity, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    positions.set(entity.id, {
      x: 45 + NODE_WIDTH / 2 + column * ((width - 90 - NODE_WIDTH) / Math.max(1, columns - 1)),
      y: 35 + NODE_HEIGHT / 2 + row * ((height - 70 - NODE_HEIGHT) / Math.max(1, rows - 1)),
    })
  })
  return { width, height, positions }
}

function edgePath(source: Position, target: Position): string {
  const dx = target.x - source.x
  const dy = target.y - source.y
  if (Math.abs(dx) < NODE_WIDTH * 0.65) {
    const direction = dy >= 0 ? 1 : -1
    const half = NODE_HEIGHT / 2
    const distance = Math.max(54, Math.min(120, Math.abs(dy) * 0.42))
    return `M ${source.x} ${source.y + direction * half} C ${source.x} ${source.y + direction * distance}, ${target.x} ${target.y - direction * distance}, ${target.x} ${target.y - direction * (half + 6)}`
  }
  const distance = Math.max(46, Math.min(130, Math.abs(dx) * 0.4 + Math.abs(dy) * 0.16))
  const direction = dx >= 0 ? 1 : -1
  const half = NODE_WIDTH / 2
  return `M ${source.x + direction * half} ${source.y} C ${source.x + direction * distance} ${source.y}, ${target.x - direction * distance} ${target.y}, ${target.x - direction * (half + 6)} ${target.y}`
}

export function codeArea(path: string): string {
  if (path === '.') return 'root'
  const segments = path.split('/').filter(Boolean)
  return segments.length > 1 ? segments.slice(0, 2).join('/') : segments[0]!
}

export function codeAreaTones(paths: readonly string[]): ReadonlyMap<string, number> {
  return new Map(
    [...new Set(paths.map(codeArea))]
      .sort((left, right) => left.localeCompare(right))
      .map((area, index) => [area, index % 6]),
  )
}

function shortPath(path: string): string {
  return path.length > 28 ? `…/${path.split('/').slice(-2).join('/')}` : path
}

function format(value: number): string {
  return new Intl.NumberFormat('en', { notation: value >= 1_000 ? 'compact' : 'standard' }).format(
    value,
  )
}
