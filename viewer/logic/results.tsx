import type {
  ViewerQualification,
  ViewerQualificationDiagnostic,
  ViewerQualificationRule,
  ViewerQualificationStatus,
} from '../../viewer-host/qualification.ts'

import { routeHref } from '../shell/route.ts'

export function VerificationView({ verification }: { verification: ViewerQualification }) {
  const counts = countRules(verification.rules)
  const proof = verificationProofSummary(verification)
  const rules = verification.rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (left, right) =>
        priority(left.rule.status) - priority(right.rule.status) || left.index - right.index,
    )
    .map(({ rule }) => rule)
  return (
    <section class="verification-view" aria-label="Verification results">
      <header class="verification-summary">
        <div class={`verification-orbit verification-${verification.status}`}>
          <StatusIcon status={verification.status} />
        </div>
        <div class="verification-totals">
          {(['pass', 'fail', 'idle', 'error'] as const).map((status) => (
            <div key={status} data-status={status}>
              <strong>{counts[status]}</strong>
              <span>{status}</span>
            </div>
          ))}
        </div>
        <code>{verification.durationMs}ms</code>
      </header>

      {proof.total > 0 && (
        <section class="verification-proof-summary" aria-label="Verification proof strength">
          <header>
            <div>
              <span>Proof strength</span>
              <p>
                Contract conformance and declaration detail are separate: progressive identity-only
                APIs remain valid without pretending their full shape was checked.
              </p>
            </div>
          </header>
          <div class="verification-proof-metrics">
            <ProofMetric label="Exact" value={proof.exact} tone="exact" />
            <ProofMetric label="Identity-only" value={proof.identity} tone="identity" />
            <ProofMetric label="Not evaluated" value={proof.unproven} tone="unproven" />
          </div>
        </section>
      )}

      {verification.profiles.length > 0 ? (
        <div class="verification-profiles">
          {verification.profiles.map((profile, index) => (
            <ProfileResult key={`${profile.id}:${profile.target?.id ?? index}`} profile={profile} />
          ))}
        </div>
      ) : (
        <ol class="verification-rules">
          {rules.map((rule) => (
            <RuleResult key={rule.id} rule={rule} />
          ))}
        </ol>
      )}
    </section>
  )
}

function ProfileResult({ profile }: { profile: ViewerQualification['profiles'][number] }) {
  const rules = [...profile.rules].sort(
    (left, right) => priority(left.status) - priority(right.status),
  )
  return (
    <section class="verification-profile" data-status={profile.status}>
      <header class="verification-profile-header">
        <span class="rule-icon">
          <StatusIcon status={profile.status} />
        </span>
        <div>
          <code>{profile.id}</code>
          <span>{profile.provider}</span>
        </div>
        <strong>{profile.status}</strong>
      </header>
      {profile.target && (
        <dl class="verification-target">
          <div>
            <dt>Target</dt>
            <dd>
              <code>{profile.target.id}</code>
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>
              <code>{profile.target.project}</code>
            </dd>
          </div>
          <div>
            <dt>Root</dt>
            <dd>
              <code>{profile.target.root}</code>
            </dd>
          </div>
          <div>
            <dt>Entrypoint</dt>
            <dd>
              <code>{profile.target.entrypoint}</code>
            </dd>
          </div>
          {profile.target.aliases && profile.target.aliases.length > 0 && (
            <div>
              <dt>Aliases</dt>
              <dd>
                <code>{profile.target.aliases.join(', ')}</code>
              </dd>
            </div>
          )}
        </dl>
      )}
      {profile.coverage && (
        <div class="verification-coverage">
          <Coverage label="Specification realization" value={profile.coverage.forward} />
          <Coverage label="Code documentation" value={profile.coverage.inverse} />
        </div>
      )}
      {profile.evidence?.missingSurface?.length || profile.evidence?.undeclaredSurface?.length ? (
        <div class="verification-dependencies">
          <CoverageInventory
            label="Missing specified surface"
            values={profile.evidence?.missingSurface ?? []}
          />
          <CoverageInventory
            label="Undeclared code surface"
            values={profile.evidence?.undeclaredSurface ?? []}
          />
        </div>
      ) : null}
      {profile.evidence?.observedModules && profile.evidence.observedModules.length > 0 && (
        <EvidenceList label="Observed modules" values={profile.evidence.observedModules} />
      )}
      {profile.evidence?.outboundDependencies?.length ||
      profile.evidence?.inboundDependencies?.length ? (
        <div class="verification-dependencies">
          <DependencyList label="Outbound" values={profile.evidence?.outboundDependencies ?? []} />
          <DependencyList label="Inbound" values={profile.evidence?.inboundDependencies ?? []} />
        </div>
      ) : null}
      {profile.evidence?.proof && <ProofEvidence value={profile.evidence.proof} />}
      <ol class="verification-rules">
        {rules.map((rule) => (
          <RuleResult key={rule.id} rule={rule} />
        ))}
      </ol>
    </section>
  )
}

function ProofMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'exact' | 'identity' | 'unproven'
}) {
  return (
    <div data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function ProofEvidence({
  value,
}: {
  value: NonNullable<NonNullable<ViewerQualification['profiles'][number]['evidence']>['proof']>
}) {
  const groups = groupDiagnostics(value.unprovenObservations)
  return (
    <div class="verification-proof-evidence">
      <details>
        <summary>
          <span>Exact declarations</span>
          <strong>{value.exactDeclarations.length}</strong>
        </summary>
        <CoverageInventory label="Shape checked" values={value.exactDeclarations} />
      </details>
      <details>
        <summary>
          <span>Identity-only declarations</span>
          <strong>{value.identityDeclarations.length}</strong>
        </summary>
        <p>
          Name, kind, export path, canonical references, and module boundary are checked. Shape is
          intentionally outside this contract.
        </p>
        <CoverageInventory label="Identity checked" values={value.identityDeclarations} />
      </details>
      <details>
        <summary>
          <span>Observations not evaluated</span>
          <strong>{value.unprovenObservations.length}</strong>
        </summary>
        <p>
          These observations sit behind an identity-only boundary. They are retained as evidence,
          but do not fail a progressive contract.
        </p>
        <div class="verification-unproven-groups">
          {groups.map(([code, diagnostics]) => (
            <details key={code}>
              <summary>
                <code>{code}</code>
                <strong>{diagnostics.length}</strong>
              </summary>
              <ol class="rule-diagnostics">
                {diagnostics.map((diagnostic, index) => (
                  <Diagnostic key={`${code}:${index}`} value={diagnostic} />
                ))}
              </ol>
            </details>
          ))}
        </div>
      </details>
    </div>
  )
}

export function verificationProofSummary(verification?: ViewerQualification) {
  const exact =
    verification?.profiles.reduce(
      (count, profile) => count + (profile.evidence?.proof?.exactDeclarations.length ?? 0),
      0,
    ) ?? 0
  const identity =
    verification?.profiles.reduce(
      (count, profile) => count + (profile.evidence?.proof?.identityDeclarations.length ?? 0),
      0,
    ) ?? 0
  const unproven =
    verification?.profiles.reduce(
      (count, profile) => count + (profile.evidence?.proof?.unprovenObservations.length ?? 0),
      0,
    ) ?? 0
  return { exact, identity, unproven, total: exact + identity }
}

function groupDiagnostics(
  diagnostics: readonly ViewerQualificationDiagnostic[],
): [string, ViewerQualificationDiagnostic[]][] {
  const groups = new Map<string, ViewerQualificationDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    const code = diagnostic.code ?? 'OBSERVATION_UNCLASSIFIED'
    const current = groups.get(code) ?? []
    current.push(diagnostic)
    groups.set(code, current)
  }
  return [...groups].sort((left, right) => right[1].length - left[1].length)
}

function Coverage({
  label,
  value,
}: {
  label: string
  value: NonNullable<ViewerQualification['profiles'][number]['coverage']>['forward']
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value.matched}/{value.total}
      </strong>
      <code>{value.percent === null ? 'n/a' : `${value.percent}%`}</code>
    </div>
  )
}

function EvidenceList({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <div class="verification-evidence">
      <span>{label}</span>
      <ul>
        {values.map((value) => (
          <li key={value}>
            <code>{value}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CoverageInventory({
  label,
  values,
}: {
  label: string
  values: NonNullable<ViewerQualification['profiles'][number]['evidence']>['missingSurface']
}) {
  if (!values?.length) return null
  return (
    <div class="verification-evidence">
      <span>{label}</span>
      <ul>
        {values.map((value) => (
          <li key={value.id}>
            <div>
              <code>{value.id}</code>
              <span>{value.label}</span>
            </div>
            {value.location && <Location value={value.location} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DependencyList({
  label,
  values,
}: {
  label: string
  values: NonNullable<ViewerQualification['profiles'][number]['evidence']>['outboundDependencies']
}) {
  if (!values?.length) return null
  return (
    <div class="verification-evidence">
      <span>{label}</span>
      <ul>
        {values.map((value) => (
          <li key={value.id}>
            <div>
              <code>
                {value.source} → {value.target}
              </code>
              <span>
                {value.kind}
                {value.deep ? ' · deep import' : ''}
              </span>
            </div>
            {value.location && <Location value={value.location} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StatusIcon({ status }: { status: ViewerQualificationStatus }) {
  if (status === 'pass') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="m4.5 10.2 3.3 3.3 7.7-7.7" />
      </svg>
    )
  }
  if (status === 'idle') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 10h10" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 5v5.5M10 14.2v.3" />
        <circle cx="10" cy="10" r="7" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  )
}

export function RuleResult({
  rule,
  statusLabel,
}: {
  rule: ViewerQualificationRule
  statusLabel?: string
}) {
  return (
    <li class="verification-rule" data-status={rule.status}>
      <header>
        <span class="rule-icon">
          <StatusIcon status={rule.status} />
        </span>
        <code>{rule.id}</code>
        <span class="rule-status">{statusLabel ?? rule.status}</span>
      </header>
      {rule.diagnostics.length > 0 && (
        <ol class="rule-diagnostics">
          {rule.diagnostics.map((diagnostic, index) => (
            <Diagnostic key={`${diagnostic.code ?? 'diagnostic'}:${index}`} value={diagnostic} />
          ))}
        </ol>
      )}
    </li>
  )
}

function Diagnostic({ value }: { value: ViewerQualificationDiagnostic }) {
  return (
    <li>
      <div class="diagnostic-heading">
        {value.code && <strong>{value.code}</strong>}
        {value.location && <Location value={value.location} />}
      </div>
      <p>{value.message}</p>
      {(value.expected !== undefined || value.actual !== undefined) && (
        <div class="diagnostic-comparison">
          {value.expected !== undefined && (
            <div>
              <span>Expected</span>
              <pre>{display(value.expected)}</pre>
            </div>
          )}
          {value.actual !== undefined && (
            <div>
              <span>Actual</span>
              <pre>{display(value.actual)}</pre>
            </div>
          )}
        </div>
      )}
      {value.hint && <p class="diagnostic-hint">{value.hint}</p>}
      {value.related && value.related.length > 0 && (
        <ul class="related-locations">
          {value.related.map((location, index) => (
            <li key={index}>
              <Location value={location} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Location({ value }: { value: ViewerQualificationDiagnostic['location'] }) {
  if (!value) return null
  const text = [value.file ?? value.external, value.line, value.column]
    .filter((part) => part !== undefined)
    .join(':')
  const content = (
    <>
      {value.label && <span>{value.label}</span>}
      {text && <code>{text}</code>}
      {value.pointer !== undefined && <code>{value.pointer || '/'}</code>}
    </>
  )
  return value.file?.endsWith('/.spec/api.d.ts') && value.pointer !== undefined ? (
    <a class="diagnostic-location" href={routeHref(value.file, value.pointer)}>
      {content}
    </a>
  ) : (
    <span class="diagnostic-location">{content}</span>
  )
}

function countRules(rules: readonly ViewerQualificationRule[]): Record<ViewerQualificationStatus, number> {
  const counts: Record<ViewerQualificationStatus, number> = { pass: 0, fail: 0, idle: 0, error: 0 }
  for (const rule of rules) counts[rule.status]++
  return counts
}

function priority(status: ViewerQualificationStatus): number {
  return { error: 0, fail: 1, idle: 2, pass: 3 }[status]
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
