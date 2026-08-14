import { useState } from 'preact/hooks'

import type {
  BenchmarkResource,
  CapabilityResource,
  LawResource,
  MarkdownResource,
  ModuleCodeResource,
  PackagePatternResource,
  PackageSpecificationResource,
  StateResource,
  StateSpecification,
  TestEvidence,
  TextResource,
} from '../../specification/resource/index.ts'
import type { CatalogLawReferences, CatalogSemanticReferences } from '../../viewer-host/catalog.ts'
import type { RawSourceLink } from '../source/raw.tsx'

import { MarkdownContent } from '../markdown/content.tsx'
import { RawSource } from '../source/raw.tsx'
import { renderFormalMath } from './formal.ts'
import { resourceTitle } from './module-source-navigation.ts'
import { SemanticText, semanticReferenceHref } from './semantic-reference.tsx'

type DescriptorResource = CapabilityResource | LawResource | StateResource | BenchmarkResource

interface ResourceViewNavigation {
  readonly selectedSource?: string
  readonly sourceLinks?: (source: string) => readonly RawSourceLink[]
  readonly onSourceChange?: (source: string) => void
}

export function TextResourcesView({
  resources,
  selectedSource,
  sourceLinks,
  onSourceChange,
}: { resources: readonly TextResource[] } & ResourceViewNavigation) {
  const [selected, setSelected] = useState(resources[0]?.source)
  const requested = resources.some((candidate) => candidate.source === selectedSource)
    ? selectedSource
    : selected
  const resource = resources.find((candidate) => candidate.source === requested) ?? resources[0]
  if (!resource) return null
  const select = (source: string) => {
    setSelected(source)
    onSourceChange?.(source)
  }
  return (
    <div class="spec-resource-view">
      {resources.length > 1 && (
        <nav class="api-source-tabs module-resource-tabs" aria-label="Specification sections">
          {resources.map((candidate) => (
            <button
              type="button"
              class={candidate.source === resource.source ? 'selected' : undefined}
              title={candidate.ref}
              onClick={() => select(candidate.source)}
              key={candidate.source}
            >
              {resourceTitle(candidate.source)}
            </button>
          ))}
        </nav>
      )}
      <RawSource
        name={resource.source}
        text={resource.text}
        links={sourceLinks?.(resource.source)}
      />
    </div>
  )
}

export function DescriptorResourcesView({
  resources,
  selectedSource,
  sourceLinks,
  onSourceChange,
  lawReferences,
}: {
  resources: readonly DescriptorResource[]
  lawReferences?: CatalogSemanticReferences['laws']
} & ResourceViewNavigation) {
  const [selected, setSelected] = useState(resources[0]?.source)
  const requested = resources.some((candidate) => candidate.source === selectedSource)
    ? selectedSource
    : selected
  const resource = resources.find((candidate) => candidate.source === requested) ?? resources[0]
  if (!resource) return null
  const select = (source: string) => {
    setSelected(source)
    onSourceChange?.(source)
  }
  return (
    <div class="module-descriptor-view">
      {resources.length > 1 && (
        <nav class="api-source-tabs module-resource-tabs" aria-label="Specification sections">
          {resources.map((candidate) => (
            <button
              type="button"
              class={candidate.source === resource.source ? 'selected' : undefined}
              title={candidate.ref}
              onClick={() => select(candidate.source)}
              key={candidate.source}
            >
              {resourceTitle(candidate.source)}
            </button>
          ))}
        </nav>
      )}
      <div class={`module-descriptor-list module-descriptor-list-${resource.kind}`}>
        {resource.kind === 'state'
          ? resource.definitions.map((definition) => (
              <StateDefinitionView key={definition.exportName} definition={definition} />
            ))
          : resource.definitions.map((definition) => (
              <article class="module-descriptor" key={definition.id}>
                <header>
                  <div>
                    <code>{definition.id}</code>
                    {'testEvidence' in definition && (
                      <TestEvidenceControl
                        evidence={definition.testEvidence}
                        subject={definition.id}
                      />
                    )}
                  </div>
                  <small>{definition.exportName}</small>
                </header>
                <p>
                  <SemanticText
                    value={definition.statement}
                    references={lawReferences?.[definition.id]?.statement}
                  />
                </p>
                {'formal' in definition && definition.formal && (
                  <LawFormal
                    value={definition.formal}
                    references={lawReferences?.[definition.id]}
                  />
                )}
                {'workload' in definition && (
                  <dl>
                    <dt>Workload</dt>
                    <dd>{definition.workload}</dd>
                    <dt>Metrics</dt>
                    <dd>{definition.metrics.join(', ')}</dd>
                    {definition.capability && (
                      <>
                        <dt>Capability</dt>
                        <dd>
                          <code>{definition.capability}</code>
                        </dd>
                      </>
                    )}
                    {definition.assumptions?.length ? (
                      <>
                        <dt>Assumptions</dt>
                        <dd>{definition.assumptions.join('; ')}</dd>
                      </>
                    ) : null}
                  </dl>
                )}
              </article>
            ))}
      </div>
      <details class="module-descriptor-source">
        <summary>Source</summary>
        <RawSource
          name={resource.source}
          text={resource.text}
          links={sourceLinks?.(resource.source)}
        />
      </details>
    </div>
  )
}

function LawFormal({ value, references }: { value: string; references?: CatalogLawReferences }) {
  const markup = renderFormalMath(
    value,
    (references?.formal ?? []).map((reference) => ({
      from: reference.from,
      to: reference.to,
      href: semanticReferenceHref(reference),
    })),
  )
  return (
    <figure class="module-law-formal">
      <figcaption>Formal</figcaption>
      {markup ? (
        <div
          class="module-law-formal-expression"
          title={value}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      ) : (
        <code class="module-law-formal-fallback">{value}</code>
      )}
    </figure>
  )
}

function StateDefinitionView({ definition }: { definition: StateResource['definitions'][number] }) {
  const transitions: { from: string; event?: string; to?: string }[] = Object.entries(
    definition.transitions,
  ).flatMap(([from, events]) =>
    Object.entries(events).length
      ? Object.entries(events).map(([event, to]) => ({ from, event, to }))
      : [{ from }],
  )
  const states = Object.keys(definition.transitions)
  const terminal = states.filter(
    (state) => Object.keys(definition.transitions[state] ?? {}).length === 0,
  )
  return (
    <article class="module-descriptor module-state">
      <header>
        <div>
          <code>{definition.exportName}</code>
          <TestEvidenceControl evidence={definition.testEvidence} subject={definition.exportName} />
        </div>
        <small>
          {states.length} states · {transitions.length - terminal.length} transitions
          {definition.initial ? ` · initial: ${definition.initial}` : ''}
        </small>
      </header>
      <div class="module-state-layout">
        <section class="module-state-diagram" aria-label={`${definition.exportName} state diagram`}>
          <p class="eyebrow">Derived topology</p>
          <MarkdownContent value={`\`\`\`mermaid\n${stateMermaid(definition)}\n\`\`\``} />
          {terminal.length > 0 && (
            <p class="module-state-terminal">
              <span>Terminal</span>
              {terminal.map((state) => (
                <code key={state}>{state}</code>
              ))}
            </p>
          )}
        </section>
        <div class="module-state-table">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Event</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((transition) => (
                <tr key={`${transition.from}:${transition.event}`}>
                  <td>
                    <code>{transition.from}</code>
                  </td>
                  <td>
                    {transition.event ? <code>{transition.event}</code> : <small>terminal</small>}
                  </td>
                  <td>
                    {transition.to ? (
                      <code>{transition.to}</code>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  )
}

export function stateMermaid(definition: StateSpecification): string {
  const states = Object.keys(definition.transitions)
  const aliases = new Map(states.map((state, index) => [state, `S${index}`] as const))
  const lines = ['stateDiagram-v2', '  direction LR']
  for (const state of states) {
    lines.push(`  state "${mermaidLabel(state)}" as ${aliases.get(state)}`)
  }
  if (definition.initial) lines.push(`  [*] --> ${aliases.get(definition.initial)}`)
  for (const [from, events] of Object.entries(definition.transitions)) {
    for (const [event, to] of Object.entries(events)) {
      lines.push(`  ${aliases.get(from)} --> ${aliases.get(to)}: ${mermaidLabel(event)}`)
    }
  }
  return lines.join('\n')
}

function mermaidLabel(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', ' ')
}

function TestEvidenceControl({
  evidence,
  subject,
}: {
  evidence: readonly TestEvidence[]
  subject: string
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const active = evidence.filter((item) => item.status === 'active').length
  const label = active
    ? `${active} active test${active === 1 ? '' : 's'} attached`
    : evidence.length
      ? 'No active test attached'
      : 'No test attached'
  return (
    <>
      <button
        class={`test-evidence-badge ${active ? 'active' : evidence.length ? 'inactive' : 'missing'}`}
        type="button"
        disabled={evidence.length === 0}
        aria-label={`${subject}: ${label}`}
        onClick={() => setOpen(true)}
      >
        <i aria-hidden="true" />
        {label}
      </button>
      {open && evidence.length > 0 && (
        <div
          class="test-evidence-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        >
          <section
            class="test-evidence-popover"
            role="dialog"
            aria-modal="true"
            aria-label={`Test evidence for ${subject}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p class="eyebrow">Attached behavioral evidence</p>
                <h3>{subject}</h3>
                <p>
                  Static attachment only. Runner results determine whether this evidence passes.
                </p>
              </div>
              <button
                class="test-evidence-close"
                type="button"
                aria-label="Close test evidence"
                autofocus
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            {evidence.length > 1 && (
              <nav class="test-evidence-tabs" aria-label="Attached tests">
                {evidence.map((item, index) => (
                  <button
                    type="button"
                    class={index === selected ? 'selected' : undefined}
                    onClick={() => setSelected(index)}
                    key={item.reference}
                  >
                    <i data-status={item.status} aria-hidden="true" />
                    {index + 1}
                  </button>
                ))}
              </nav>
            )}
            <TestEvidenceSource evidence={evidence[selected] ?? evidence[0]!} />
          </section>
        </div>
      )}
    </>
  )
}

function TestEvidenceSource({ evidence }: { evidence: TestEvidence }) {
  return (
    <div class="test-evidence-source">
      <dl>
        <div>
          <dt>Status</dt>
          <dd data-status={evidence.status}>{evidence.status}</dd>
        </div>
        <div>
          <dt>Declaration</dt>
          <dd>{evidence.title}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            <code>
              {evidence.source}:{evidence.line}
            </code>
          </dd>
        </div>
      </dl>
      <RawSource
        name={evidence.source}
        label={`${evidence.source}:${evidence.line}`}
        message={`${evidence.status} test`}
        text={evidence.code}
      />
    </div>
  )
}

export function ModulePackagesView({
  resources,
  patterns,
}: {
  resources: readonly PackageSpecificationResource[]
  patterns: readonly PackagePatternResource[]
}) {
  return (
    <section class="spec-field-view">
      <p class="eyebrow">Package manifest authority</p>
      <h2>External packages</h2>
      <dl class="module-package-list">
        {resources.map((resource) => (
          <div key={resource.package}>
            <dt>
              <code>{resource.package}</code>
            </dt>
            <dd>{resource.purpose}</dd>
          </div>
        ))}
      </dl>
      {patterns.length > 0 && (
        <>
          <h3>Explicit exceptions</h3>
          <dl class="module-package-list">
            {patterns.map((resource) => (
              <div key={resource.pattern}>
                <dt>
                  <code>{resource.pattern}</code>
                </dt>
                <dd>{resource.reason}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

export function ArchitectureView({ resource }: { resource: MarkdownResource }) {
  return (
    <article class="context-markdown module-architecture">
      <MarkdownContent value={resource.document.text} html={resource.document.html} />
    </article>
  )
}

export type { ModuleCodeResource }
