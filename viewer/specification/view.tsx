import type { ComponentChildren } from 'preact'

import { useEffect, useState } from 'preact/hooks'

import type { SourceEditAdapter } from '../../application/interaction/editing.ts'
import type { SpecRevealAdapter } from '../../application/interaction/reveal.ts'
import type { ViewerQualification } from '../../viewer-host/qualification.ts'
import type { VerificationAdapter } from '../../application/interaction/qualification.ts'
import type { ViewerSpecification } from '../../viewer-host/catalog.ts'
import type { SpecTab } from '../shell/route.ts'

import { viewerSpecificationDiagnostics } from '../../viewer-host/specification.ts'
import { CodeView } from '../code/view.tsx'
import { ModuleHistoryView } from '../history/view.tsx'
import { StatusIcon } from '../logic/results.tsx'
import { LogicView } from '../logic/view.tsx'
import {
  ApiView,
  type ApiDefinitionOwner,
  type ApiDefinitionTarget,
  type ApiNavigationHistory,
  type ApiNavigationState,
} from './api.tsx'
import { ExamplesView } from './examples.tsx'
import { LayoutView } from './layout.tsx'
import { PackagesView } from './manifest-fields.tsx'
import {
  ArchitectureView,
  DescriptorResourcesView,
  ModulePackagesView,
  TextResourcesView,
} from './module-resources.tsx'
import { moduleSourceLinks } from './module-source-navigation.ts'
import { ModuleTopology } from './module-topology.tsx'
import {
  hasModuleTopology,
  type ModuleTopologyIndex,
} from './module-topology-model.ts'
import { ModuleSurface, moduleForSource } from './modules.tsx'
import { PortsView } from './ports.tsx'
import { SourceResourcesView } from './resources.tsx'
import {
  defaultSpecTab,
  diagnosticsTabState,
  type DiagnosticsTabState,
  specTabGroups,
} from './tabs.ts'

interface SpecViewProps {
  spec: ViewerSpecification
  topologyIndex: ModuleTopologyIndex
  tab: SpecTab
  pointer?: string
  revealAdapter?: SpecRevealAdapter
  sourceEditAdapter?: SourceEditAdapter
  verificationAdapter?: VerificationAdapter
  apiNavigation?: ApiNavigationState
  resourceSource?: string
  apiDefinitionOwners?: ReadonlyMap<string, ApiDefinitionOwner>
  onApiDefinitionOpen?(target: ApiDefinitionTarget): void
  onResourceChange?(tab: SpecTab, source: string): void
  onTabChange(tab: SpecTab): void
  onApiNavigationChange?(
    navigation: ApiNavigationState,
    history: ApiNavigationHistory,
    previous: ApiNavigationState,
  ): void
  onVerification?(verification: ViewerQualification): void
}

export function SpecView({
  spec,
  topologyIndex,
  tab,
  pointer,
  revealAdapter,
  verificationAdapter,
  apiNavigation,
  resourceSource,
  apiDefinitionOwners,
  onApiDefinitionOpen,
  onResourceChange,
  onTabChange,
  onApiNavigationChange,
  onVerification,
}: SpecViewProps) {
  const topologyAvailable = hasModuleTopology(topologyIndex, spec.source)
  const derivedTabs = { code: topologyAvailable }
  const { primary: primaryTabs, secondary: secondaryTabs } = specTabGroups(spec, derivedTabs)
  const tabs = [...primaryTabs, ...secondaryTabs]
  const activeTab = tabs.includes(tab) ? tab : defaultSpecTab(spec, pointer, derivedTabs)
  const valid = viewerSpecificationDiagnostics(spec).length === 0
  const diagnostics = diagnosticsTabState(spec)
  const sourceLinks = (source: string) => moduleSourceLinks(spec, source, apiDefinitionOwners)

  return (
    <article class="spec-document">
      <header class="document-header">
        <div class="document-identity">
          <span class="document-mark">
            <SpecIcon />
          </span>
          <h1>{spec.title}</h1>
          <span class="document-divider" aria-hidden="true">
            /
          </span>
          <code class="source-path" title={spec.source}>
            {spec.source}
          </code>
          {revealAdapter && <SpecRevealButton adapter={revealAdapter} source={spec.source} />}
        </div>
        <div class="document-statuses">
          <span class={`validity ${valid ? 'validity-ok' : 'validity-error'}`}>
            <span aria-hidden="true">{valid ? '✓' : '!'}</span>
            {valid ? 'Spec valid' : 'Spec invalid'}
          </span>
          {spec.modules.some((module) => module.contract) && (
            <span
              class={`validity verification-badge verification-${spec.verification?.status ?? 'pending'}`}
            >
              <span aria-hidden="true">
                {spec.verification ? <StatusIcon status={spec.verification.status} /> : '·'}
              </span>
              {spec.verification?.status ?? 'not run'}
            </span>
          )}
        </div>
      </header>

      <div class="tabs" role="tablist" aria-label="Specification views">
        <span class="tab-group tab-group-primary" role="presentation">
          {primaryTabs.map((name) =>
            tabButton(name, activeTab, onTabChange, diagnostics),
          )}
        </span>
        <span class="tab-divider" role="presentation" />
        <span class="tab-group tab-group-secondary" role="presentation">
          {secondaryTabs.map((name) =>
            tabButton(name, activeTab, onTabChange, diagnostics),
          )}
        </span>
      </div>

      {(spec.history.length > 0 || spec.historyDiagnostics.length > 0) && (
        <Panel active={activeTab === 'history'}>
          <ModuleHistoryView resources={spec.history} diagnostics={spec.historyDiagnostics} />
        </Panel>
      )}
      {spec.modules.some((module) => module.api) && (
        <Panel active={activeTab === 'api'}>
          <ModuleSurface
            modules={spec.modules.filter((module) => module.api)}
            initialId={moduleForSource(spec.modules, apiNavigation?.source)?.id}
            render={(module) => (
              <ApiView
                api={module.api!.model}
                source={module.api!.source}
                text={module.api!.text}
                navigation={apiNavigation}
                definitionOwners={apiDefinitionOwners}
                moduleSource={spec.source}
                onOpenDefinition={onApiDefinitionOpen}
                onNavigationChange={onApiNavigationChange}
              />
            )}
          />
        </Panel>
      )}
      {spec.modules.some((module) => module.ports.length) && (
        <Panel active={activeTab === 'ports'}>
          <ModuleSurface
            modules={spec.modules.filter((module) => module.ports.length)}
            render={(module) => (
              <PortsView
                ports={module.ports}
                selectedSource={resourceSource}
                definitionOwners={apiDefinitionOwners}
                moduleSource={spec.source}
                onOpenDefinition={onApiDefinitionOpen}
                onSourceChange={(source) => onResourceChange?.('ports', source)}
              />
            )}
          />
        </Panel>
      )}
      {spec.internal && (
        <Panel active={activeTab === 'internal'}>
          <TextResourcesView
            resources={[spec.internal]}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('internal', source)}
          />
        </Panel>
      )}
      {spec.flows.length ? (
        <Panel active={activeTab === 'flows'}>
          <TextResourcesView
            resources={spec.flows}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('flows', source)}
          />
        </Panel>
      ) : null}
      {spec.laws.length ? (
        <Panel active={activeTab === 'laws'}>
          <DescriptorResourcesView
            resources={spec.laws}
            lawReferences={spec.semanticReferences?.laws}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('laws', source)}
          />
        </Panel>
      ) : null}
      {spec.states.length ? (
        <Panel active={activeTab === 'states'}>
          <DescriptorResourcesView
            resources={spec.states}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('states', source)}
          />
        </Panel>
      ) : null}
      {spec.limits && (
        <Panel active={activeTab === 'limits'}>
          <TextResourcesView
            resources={[spec.limits]}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('limits', source)}
          />
        </Panel>
      )}
      {spec.layout && (
        <Panel active={activeTab === 'layout'}>
          <LayoutView resource={spec.layout} />
        </Panel>
      )}
      {(spec.modules.some((module) => module.binding) || topologyAvailable) && (
        <Panel active={activeTab === 'code'}>
          {topologyAvailable && <ModuleTopology index={topologyIndex} source={spec.source} />}
          {spec.modules.some((module) => module.binding) && (
            <ModuleSurface
              modules={spec.modules.filter((module) => module.binding)}
              render={(module) => (
                <CodeView
                  binding={module.binding!}
                  analysis={module.code}
                  showDependencyGraph={!topologyAvailable}
                />
              )}
            />
          )}
        </Panel>
      )}
      {spec.schemas.length > 0 && (
        <Panel active={activeTab === 'schemas'}>
          <SourceResourcesView resources={spec.schemas} />
        </Panel>
      )}
      {spec.packages.length > 0 || spec.packagePatterns.length > 0 ? (
        <Panel active={activeTab === 'packages'}>
          <ModulePackagesView resources={spec.packages} patterns={spec.packagePatterns} />
        </Panel>
      ) : spec.modules.some((module) => module.packages.length) ? (
        <Panel active={activeTab === 'packages'}>
          <ModuleSurface
            modules={spec.modules.filter((module) => module.packages.length)}
            render={(module) => <PackagesView packages={module.packages} />}
          />
        </Panel>
      ) : null}
      {spec.capabilities.length ? (
        <Panel active={activeTab === 'capabilities'}>
          <DescriptorResourcesView
            resources={spec.capabilities}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('capabilities', source)}
          />
        </Panel>
      ) : null}
      {spec.examples.length > 0 && (
        <Panel active={activeTab === 'examples'}>
          <ExamplesView resources={spec.examples} sourceLinks={sourceLinks} />
        </Panel>
      )}
      {spec.benchmarks.length ? (
        <Panel active={activeTab === 'benchmarks'}>
          <DescriptorResourcesView
            resources={spec.benchmarks}
            selectedSource={resourceSource}
            sourceLinks={sourceLinks}
            onSourceChange={(source) => onResourceChange?.('benchmarks', source)}
          />
        </Panel>
      ) : null}
      {spec.architecture && (
        <Panel active={activeTab === 'architecture'}>
          <ArchitectureView resource={spec.architecture} />
        </Panel>
      )}
      <Panel active={activeTab === 'diagnostics'}>
        <LogicView spec={spec} adapter={verificationAdapter} onVerification={onVerification} />
      </Panel>
    </article>
  )
}

function Panel({ active, children }: { active: boolean; children: ComponentChildren }) {
  const [visited, setVisited] = useState(active)
  useEffect(() => {
    if (active) setVisited(true)
  }, [active])
  if (!active && !visited) return null
  return (
    <section class="tab-panel" role="tabpanel" hidden={!active}>
      {children}
    </section>
  )
}

function capitalize(value: string): string {
  if (value === 'api') return 'API'
  return `${value[0]?.toUpperCase()}${value.slice(1)}`
}

function tabButton(
  name: SpecTab,
  active: SpecTab,
  select: (tab: SpecTab) => void,
  diagnostics: DiagnosticsTabState,
) {
  return (
    <button
      key={name}
      type="button"
      role="tab"
      aria-selected={active === name}
      class={active === name ? 'active' : ''}
      onClick={() => select(name)}
    >
      {name === 'diagnostics' ? (
        <>
          Diagnostics
          <span
            class={`tab-diagnostic-state tab-diagnostic-${diagnostics.status}`}
            title={diagnostics.title}
          >
            <span aria-hidden="true">
              {diagnostics.status === 'pass' ? '✓' : diagnostics.status === 'idle' ? '·' : '×'}
            </span>
            {diagnostics.label}
          </span>
          {diagnostics.identity > 0 && (
            <span
              class="tab-proof-identity"
              title={`${diagnostics.identity} identity-only declaration${diagnostics.identity === 1 ? '' : 's'}.`}
            >
              {diagnostics.identity} identity
            </span>
          )}
        </>
      ) : (
        capitalize(name)
      )}
    </button>
  )
}

function SpecRevealButton({ adapter, source }: { adapter: SpecRevealAdapter; source: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const reveal = async () => {
    setPending(true)
    setError(undefined)
    try {
      await adapter.reveal({ source })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not show the specification folder.')
    } finally {
      setPending(false)
    }
  }
  return (
    <span class={`spec-reveal ${error ? 'spec-reveal-failed' : ''}`}>
      <button
        type="button"
        aria-busy={pending}
        aria-label="Show specification in folder"
        disabled={pending}
        title={error ?? 'Show specification in folder'}
        onClick={() => void reveal()}
      >
        <RevealIcon />
      </button>
      {error && (
        <span class="spec-reveal-error" role="alert">
          {error}
        </span>
      )}
    </span>
  )
}

function SpecIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2.8h6l4 4V17H5z" />
      <path d="M11 2.8v4h4M7.5 10h5M7.5 13h5" />
    </svg>
  )
}

function RevealIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5.5h5l1.4 1.8H17l-1.4 7.2H4.4z" />
      <path d="M3 5.5V4h4.5l1.4 1.5H16v1.8" />
    </svg>
  )
}
