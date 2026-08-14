import type {
  ViewerCodeAnalysis as CodeAnalysis,
  ViewerCodeFile as CodeFile,
} from '../../viewer-host/code.ts'
import type { ImplementationBinding } from '../../specification/binding.ts'

import { exitTargetSummary, fileExitTargets, moduleExitTargets } from './exits.ts'
import { codeArea, codeAreaTones, CodeDependencyGraph } from './graph.tsx'

interface CodeViewProps {
  readonly binding: ImplementationBinding
  readonly analysis?: CodeAnalysis
  readonly showDependencyGraph?: boolean
}

export function CodeView({ binding, analysis, showDependencyGraph = true }: CodeViewProps) {
  if (!analysis) {
    return (
      <section class="code-view">
        <header class="code-hero">
          <div>
            <p class="eyebrow">TypeScript source boundary</p>
            <h2>Code</h2>
            <p>The declared project has not been analyzed yet.</p>
          </div>
          <span class="code-status code-status-unavailable">Unavailable</span>
        </header>
        <Scope binding={binding} />
      </section>
    )
  }

  const { summary } = analysis
  const largest = [...analysis.files]
    .sort(
      (left, right) => right.lines.code - left.lines.code || left.path.localeCompare(right.path),
    )
    .slice(0, 6)
  const detached = analysis.files.filter((file) => !file.reachable)

  return (
    <section class="code-view">
      <header class="code-hero">
        <div>
          <p class="eyebrow">Observed source architecture</p>
          <h2>Code</h2>
          <p>
            Compiler-resolved facts for this module boundary. No filesystem globs or inferred
            quality scores.
          </p>
        </div>
        <span class={`code-status code-status-${analysis.status}`}>
          <span aria-hidden="true">
            {analysis.status === 'complete' ? '✓' : analysis.status === 'partial' ? '!' : '·'}
          </span>
          {analysis.status}
        </span>
      </header>

      <Scope binding={analysis.scope} />

      {analysis.status !== 'unavailable' && (
        <>
          <div class="code-metrics" aria-label="Code metrics">
            <Metric
              label="Source files"
              value={format(summary.files)}
              detail={`${summary.reachableFiles} reachable · ${summary.detachedFiles} detached`}
              tone="blue"
            />
            <Metric
              label="Code lines"
              value={format(summary.lines.code)}
              detail={`${summary.averageCodeLines} average · ${summary.medianCodeLines} median`}
              tone="green"
            />
            <Metric
              label="Internal modules"
              value={format(summary.modules)}
              detail={`${summary.internalDependencies} internal · ${summary.externalDependencies} external edges`}
              tone="amber"
            />
            <Metric
              label="Dependency cycles"
              value={format(summary.runtimeCycles)}
              detail={`${summary.runtimeCycles} runtime · ${summary.typeCycles} type-only`}
              tone={summary.runtimeCycles ? 'red' : 'slate'}
            />
          </div>

          {showDependencyGraph && hasImplementationDependencyGraph(analysis) && (
            <CodeDependencyGraph analysis={analysis} />
          )}

          <div class="code-detail-grid">
            <section class="code-panel code-distribution">
              <header class="code-panel-header">
                <div>
                  <p class="eyebrow">Physical composition</p>
                  <h3>Line distribution</h3>
                </div>
              </header>
              <LineBar
                label="Code"
                value={summary.lines.code}
                total={summary.lines.total}
                tone="code"
              />
              <LineBar
                label="Comments"
                value={summary.lines.comment}
                total={summary.lines.total}
                tone="comment"
              />
              <LineBar
                label="Blank"
                value={summary.lines.blank}
                total={summary.lines.total}
                tone="blank"
              />
              {(summary.lines.unclassified ?? 0) > 0 && (
                <LineBar
                  label="Unclassified"
                  value={summary.lines.unclassified ?? 0}
                  total={summary.lines.total}
                  tone="blank"
                />
              )}
              <dl class="code-stat-list">
                <div>
                  <dt>Total physical lines</dt>
                  <dd>{format(summary.lines.total)}</dd>
                </div>
                <div>
                  <dt>95th percentile file</dt>
                  <dd>{format(summary.p95CodeLines)} LOC</dd>
                </div>
              </dl>
            </section>

            <section class="code-panel code-largest">
              <header class="code-panel-header">
                <div>
                  <p class="eyebrow">Size distribution</p>
                  <h3>Largest files</h3>
                </div>
              </header>
              <ol>
                {largest.map((file) => (
                  <li key={file.path}>
                    <span title={file.path}>{relativeFile(file, analysis.scope.root)}</span>
                    <strong>{format(file.lines.code)}</strong>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {detached.length > 0 && (
            <section class="code-panel code-detached">
              <header class="code-panel-header">
                <div>
                  <p class="eyebrow">Reachability</p>
                  <h3>Detached files</h3>
                  <p>
                    Owned by the code root but not statically reachable from a public entrypoint.
                  </p>
                </div>
                <span>{detached.length}</span>
              </header>
              <div class="code-chip-list">
                {detached.map((file) => (
                  <code key={file.path}>{relativeFile(file, analysis.scope.root)}</code>
                ))}
              </div>
            </section>
          )}

          <FileInventory analysis={analysis} />
        </>
      )}

      {analysis.issues.length > 0 && (
        <section class="code-panel code-issues">
          <header class="code-panel-header">
            <div>
              <p class="eyebrow">Analysis completeness</p>
              <h3>
                {analysis.issues.length} {analysis.issues.length === 1 ? 'issue' : 'issues'}
              </h3>
              <p>Metrics remain visible, but affected conclusions must be treated as partial.</p>
            </div>
          </header>
          <ul>
            {analysis.issues.map((issue, index) => (
              <li
                key={`${issue.code}:${issue.location?.file ?? ''}:${issue.location?.line ?? index}`}
              >
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
                {issue.location?.file && (
                  <code>
                    {issue.location.file}
                    {issue.location.line ? `:${issue.location.line}` : ''}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

export function hasImplementationDependencyGraph(analysis: CodeAnalysis): boolean {
  return analysis.dependencies.some(
    (dependency) => !dependency.external && dependency.sourceModule !== dependency.targetModule,
  )
}

function Scope({ binding }: { binding: ImplementationBinding | CodeAnalysis['scope'] }) {
  return (
    <dl class="code-scope">
      <div>
        <dt>Project</dt>
        <dd>
          <code>{binding.project}</code>
        </dd>
      </div>
      <div>
        <dt>Root</dt>
        <dd>
          <code>{binding.root}</code>
        </dd>
      </div>
      <div>
        <dt>Entrypoint</dt>
        <dd>
          <code>{binding.entrypoint}</code>
        </dd>
      </div>
      {'aliases' in binding && binding.aliases?.length ? (
        <div>
          <dt>Aliases</dt>
          <dd>
            <code>{binding.aliases.join(', ')}</code>
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: 'blue' | 'green' | 'amber' | 'red' | 'slate'
}) {
  return (
    <article class={`code-metric code-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function LineBar({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone: string
}) {
  const percentage = total ? Math.round((value / total) * 100) : 0
  return (
    <div class="code-line-bar">
      <div>
        <span>{label}</span>
        <strong>
          {format(value)} <small>{percentage}%</small>
        </strong>
      </div>
      <i>
        <b class={`code-line-${tone}`} style={{ width: `${percentage}%` }} />
      </i>
    </div>
  )
}

function FileInventory({ analysis }: { analysis: CodeAnalysis }) {
  const { files, modules } = analysis
  const root = analysis.scope.root
  const tones = codeAreaTones(modules.map((module) => module.path))
  const groups = modules.map((module) => ({
    module,
    files: files.filter((file) => file.module === module.path),
  }))
  return (
    <section class="code-panel code-files">
      <header class="code-panel-header">
        <div>
          <p class="eyebrow">Owned source set</p>
          <h3>Files</h3>
          <p>
            Every non-declaration source file assigned to this boundary by the TypeScript project.
          </p>
        </div>
        <span>{files.length}</span>
      </header>
      <div class="code-file-groups">
        {groups.map(({ module, files: moduleFiles }) => {
          const tone = tones.get(codeArea(module.path)) ?? 0
          const external = moduleExitTargets(module.path, analysis.dependencies)
          const initiallyOpen = files.length <= 32 || module.path === '.'
          return (
            <details
              class={`code-file-group code-area-${tone}`}
              open={initiallyOpen}
              key={module.path}
            >
              <summary>
                <span class="code-file-group-swatch" aria-hidden="true" />
                <span class="code-file-group-identity">
                  <strong>{module.path === '.' ? 'root' : module.path}</strong>
                  <small>
                    {module.files} {module.files === 1 ? 'file' : 'files'}
                  </small>
                </span>
                <span class="code-file-group-stats">
                  <span class="code-file-group-loc">
                    <small>code</small>
                    <strong>{format(module.lines.code)}</strong>
                  </span>
                  <Flow value={module.inbound} direction="in" />
                  <Flow value={module.outbound} direction="out" />
                  {external.length > 0 && (
                    <Flow
                      value={external.length}
                      direction="external"
                      title={exitTargetSummary(external)}
                    />
                  )}
                </span>
              </summary>
              <div class="code-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Reachability</th>
                      <th>Code</th>
                      <th>Comments</th>
                      <th>Traffic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moduleFiles.map((file) => {
                      const exits = fileExitTargets(file.path, analysis.dependencies)
                      return (
                        <tr key={file.path}>
                          <td>
                            <code title={file.path}>{moduleFile(file, root)}</code>
                            {file.entrypoint && <span class="code-entrypoint">entry</span>}
                            {exits.length > 0 && (
                              <span class="code-exit" title={exitTargetSummary(exits)}>
                                exit{exits.length > 1 ? ` ${exits.length}` : ''}
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              class={`code-reachability ${file.reachable ? 'reachable' : 'detached'}`}
                            >
                              {file.reachable ? 'reachable' : 'detached'}
                            </span>
                          </td>
                          <td>
                            <span class="code-cell-number code-cell-code">
                              {format(file.lines.code)}
                            </span>
                          </td>
                          <td>
                            <span class="code-cell-number code-cell-comment">
                              {format(file.lines.comment)}
                            </span>
                          </td>
                          <td>
                            <span class="code-file-flow">
                              <Flow value={file.inbound} direction="in" />
                              <Flow value={file.outbound} direction="out" />
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

function Flow({
  value,
  direction,
  title,
}: {
  value: number
  direction: 'in' | 'out' | 'external'
  title?: string
}) {
  const label =
    direction === 'in'
      ? 'inbound dependencies'
      : direction === 'out'
        ? 'outbound dependencies'
        : 'external targets'
  const symbol = direction === 'in' ? '←' : direction === 'out' ? '→' : '↗'
  return (
    <span class={`code-flow code-flow-${direction}`} aria-label={`${value} ${label}`} title={title}>
      <i aria-hidden="true">{symbol}</i>
      <strong>{format(value)}</strong>
    </span>
  )
}

function moduleFile(file: CodeFile, root: string): string {
  const relative = relativeFile(file, root)
  const prefix = file.module === '.' ? '' : `${file.module}/`
  return prefix && relative.startsWith(prefix) ? relative.slice(prefix.length) : relative
}

function relativeFile(file: CodeFile, root: string): string {
  return file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path
}

function format(value: number): string {
  return new Intl.NumberFormat('en').format(value)
}
