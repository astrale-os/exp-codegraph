export const V2_REQUIREMENTS_HEADER = [
  'requirement_id',
  'area',
  'decision',
  'owner',
  'gate',
  'state',
  'adr_section',
  'specification',
  'implementation',
  'verification',
  'revision',
] as const

export const V2_GATES_HEADER = ['gate_id', 'name', 'status', 'exit_criteria', 'evidence'] as const

export const V2_DRIFT_HEADER = [
  'drift_id',
  'affected_requirements',
  'classification',
  'v1_observation',
  'v2_decision',
  'rationale',
  'status',
  'revision',
  'verification',
] as const

export type V2RequirementState =
  | 'ratified'
  | 'specified'
  | 'implemented'
  | 'qualified'
  | 'superseded'
  | 'deferred'

export type V2GateStatus = 'pending' | 'in-progress' | 'blocked' | 'complete'

export type V2DriftClassification =
  | 'defect-correction'
  | 'intentional-evolution'
  | 'representation-only'
  | 'environmental'

export type V2DriftStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded'

export interface V2Requirement {
  readonly requirementId: string
  readonly area: string
  readonly decision: string
  readonly owner: string
  readonly gate: string
  readonly state: V2RequirementState
  readonly adrSection: string
  readonly specification: string
  readonly implementation: string
  readonly verification: string
  readonly revision: string
  readonly line: number
}

export interface V2Gate {
  readonly gateId: string
  readonly name: string
  readonly status: V2GateStatus
  readonly exitCriteria: string
  readonly evidence: string
  readonly line: number
}

export interface V2Drift {
  readonly driftId: string
  readonly affectedRequirements: readonly string[]
  readonly classification: V2DriftClassification
  readonly v1Observation: string
  readonly v2Decision: string
  readonly rationale: string
  readonly status: V2DriftStatus
  readonly revision: string
  readonly verification: string
  readonly line: number
}

export interface V2GovernanceInput {
  readonly requirementsText: string
  readonly gatesText: string
  readonly driftText: string
  readonly adrText: string
  readonly existingPaths: ReadonlySet<string>
  readonly revisionTexts: ReadonlyMap<string, string>
}

export interface V2GovernanceDiagnostic {
  readonly code: string
  readonly source: 'requirements.tsv' | 'gates.tsv' | 'drift.tsv' | 'typespec-v2.md'
  readonly line: number
  readonly message: string
}

export interface V2GovernanceResult {
  readonly requirements: readonly V2Requirement[]
  readonly gates: readonly V2Gate[]
  readonly drift: readonly V2Drift[]
  readonly diagnostics: readonly V2GovernanceDiagnostic[]
}

const requirementStates = new Set<V2RequirementState>([
  'ratified',
  'specified',
  'implemented',
  'qualified',
  'superseded',
  'deferred',
])
const gateStatuses = new Set<V2GateStatus>(['pending', 'in-progress', 'blocked', 'complete'])
const driftClassifications = new Set<V2DriftClassification>([
  'defect-correction',
  'intentional-evolution',
  'representation-only',
  'environmental',
])
const driftStatuses = new Set<V2DriftStatus>(['proposed', 'accepted', 'rejected', 'superseded'])
const advancedRequirementStates = new Set<V2RequirementState>([
  'specified',
  'implemented',
  'qualified',
])

export function validateV2Governance(input: V2GovernanceInput): V2GovernanceResult {
  const diagnostics: V2GovernanceDiagnostic[] = []
  const requirementRows = parseTsv(
    input.requirementsText,
    V2_REQUIREMENTS_HEADER,
    'requirements.tsv',
    diagnostics,
  )
  const gateRows = parseTsv(input.gatesText, V2_GATES_HEADER, 'gates.tsv', diagnostics)
  const driftRows = parseTsv(input.driftText, V2_DRIFT_HEADER, 'drift.tsv', diagnostics)
  const requirements = requirementRows.map(toRequirement)
  const gates = gateRows.map(toGate)
  const drift = driftRows.map(toDrift)
  const gateIds = new Set(gates.map((gate) => gate.gateId))
  const requirementIds = new Set<string>()
  const adrSections = markdownSections(input.adrText)

  for (const requirement of requirements) {
    if (!/^V2-[A-Z]{2,4}-\d{3}$/u.test(requirement.requirementId)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_ID_INVALID',
        'requirements.tsv',
        requirement.line,
        `Invalid stable requirement ID ${requirement.requirementId}.`,
      )
    } else if (requirementIds.has(requirement.requirementId)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_ID_DUPLICATE',
        'requirements.tsv',
        requirement.line,
        `Duplicate requirement ID ${requirement.requirementId}.`,
      )
    }
    requirementIds.add(requirement.requirementId)

    if (!gateIds.has(requirement.gate)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_GATE_UNKNOWN',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} references unknown gate ${requirement.gate}.`,
      )
    }
    if (!requirementStates.has(requirement.state)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_STATE_INVALID',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} has invalid state ${requirement.state}.`,
      )
    }
    if (!adrSections.has(normalizeHeading(requirement.adrSection))) {
      report(
        diagnostics,
        'V2_REQUIREMENT_ADR_SECTION_MISSING',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} references missing ADR section ${requirement.adrSection}.`,
      )
    }

    if (advancedRequirementStates.has(requirement.state)) {
      requireLocators(requirement, 'specification', input.existingPaths, diagnostics)
    }
    if (requirement.state === 'implemented' || requirement.state === 'qualified') {
      requireLocators(requirement, 'implementation', input.existingPaths, diagnostics)
    }
    if (requirement.state === 'qualified') {
      requireLocators(requirement, 'verification', input.existingPaths, diagnostics)
    }
    if (requirement.state === 'superseded' || requirement.state === 'deferred') {
      validateAcceptedRevision(requirement, input, diagnostics)
    } else if (requirement.revision !== '-') {
      validateAcceptedRevision(requirement, input, diagnostics)
    }
  }

  validateDrift(drift, requirementIds, input, diagnostics)

  validateGateOrder(gates, diagnostics)
  for (const gate of gates) {
    if (!/^G[0-6]$/u.test(gate.gateId)) {
      report(
        diagnostics,
        'V2_GATE_ID_INVALID',
        'gates.tsv',
        gate.line,
        `Invalid gate ID ${gate.gateId}.`,
      )
    }
    if (!gateStatuses.has(gate.status)) {
      report(
        diagnostics,
        'V2_GATE_STATUS_INVALID',
        'gates.tsv',
        gate.line,
        `Gate ${gate.gateId} has invalid status ${gate.status}.`,
      )
    }
    if (gate.status !== 'pending') validateGateEvidence(gate, input.existingPaths, diagnostics)
    if (gate.status === 'complete') {
      for (const requirement of requirements.filter(
        (candidate) => candidate.gate === gate.gateId,
      )) {
        if (requirement.state !== 'qualified' && requirement.state !== 'deferred') {
          report(
            diagnostics,
            'V2_GATE_REQUIREMENT_INCOMPLETE',
            'gates.tsv',
            gate.line,
            `Gate ${gate.gateId} is complete while ${requirement.requirementId} is ${requirement.state}.`,
          )
        }
      }
    }
  }

  return { requirements, gates, drift, diagnostics }
}

function validateDrift(
  drift: readonly V2Drift[],
  requirementIds: ReadonlySet<string>,
  input: V2GovernanceInput,
  diagnostics: V2GovernanceDiagnostic[],
): void {
  const driftIds = new Set<string>()
  for (const entry of drift) {
    if (!/^V2-DRIFT-\d{3}$/u.test(entry.driftId)) {
      report(
        diagnostics,
        'V2_DRIFT_ID_INVALID',
        'drift.tsv',
        entry.line,
        `Invalid stable drift ID ${entry.driftId}.`,
      )
    } else if (driftIds.has(entry.driftId)) {
      report(
        diagnostics,
        'V2_DRIFT_ID_DUPLICATE',
        'drift.tsv',
        entry.line,
        `Duplicate drift ID ${entry.driftId}.`,
      )
    }
    driftIds.add(entry.driftId)

    for (const requirementId of entry.affectedRequirements) {
      if (!requirementIds.has(requirementId)) {
        report(
          diagnostics,
          'V2_DRIFT_REQUIREMENT_UNKNOWN',
          'drift.tsv',
          entry.line,
          `Drift ${entry.driftId} references unknown requirement ${requirementId}.`,
        )
      }
    }
    if (!driftClassifications.has(entry.classification)) {
      report(
        diagnostics,
        'V2_DRIFT_CLASSIFICATION_INVALID',
        'drift.tsv',
        entry.line,
        `Drift ${entry.driftId} has invalid classification ${entry.classification}.`,
      )
    }
    if (!driftStatuses.has(entry.status)) {
      report(
        diagnostics,
        'V2_DRIFT_STATUS_INVALID',
        'drift.tsv',
        entry.line,
        `Drift ${entry.driftId} has invalid status ${entry.status}.`,
      )
    }
    if (entry.status !== 'accepted') continue

    if (entry.verification === '-') {
      report(
        diagnostics,
        'V2_DRIFT_VERIFICATION_MISSING',
        'drift.tsv',
        entry.line,
        `Accepted drift ${entry.driftId} has no verification evidence.`,
      )
    } else {
      for (const path of locators(entry.verification)) {
        if (!input.existingPaths.has(path)) {
          report(
            diagnostics,
            'V2_DRIFT_VERIFICATION_NOT_FOUND',
            'drift.tsv',
            entry.line,
            `Accepted drift ${entry.driftId} references missing verification path ${path}.`,
          )
        }
      }
    }

    const material =
      entry.classification === 'defect-correction' ||
      entry.classification === 'intentional-evolution'
    if (material) validateDriftRevision(entry, input, diagnostics)
  }
}

function validateDriftRevision(
  drift: V2Drift,
  input: V2GovernanceInput,
  diagnostics: V2GovernanceDiagnostic[],
): void {
  if (drift.revision === '-') {
    report(
      diagnostics,
      'V2_DRIFT_REVISION_MISSING',
      'drift.tsv',
      drift.line,
      `Accepted semantic drift ${drift.driftId} needs an accepted revision record.`,
    )
    return
  }
  const revision = input.revisionTexts.get(drift.revision)
  if (revision === undefined) {
    report(
      diagnostics,
      'V2_DRIFT_REVISION_NOT_FOUND',
      'drift.tsv',
      drift.line,
      `Drift ${drift.driftId} references missing revision ${drift.revision}.`,
    )
    return
  }
  if (!/^Status:\s*accepted\s*$/imu.test(revision)) {
    report(
      diagnostics,
      'V2_DRIFT_REVISION_NOT_ACCEPTED',
      'drift.tsv',
      drift.line,
      `Drift ${drift.driftId} references a revision that is not accepted.`,
    )
  }
  const affected = /^Affected requirements:\s*(.+)$/imu.exec(revision)?.[1]
  const affectedIds = new Set(affected?.split(',').map((value) => value.trim()) ?? [])
  for (const requirementId of drift.affectedRequirements) {
    if (!affectedIds.has(requirementId)) {
      report(
        diagnostics,
        'V2_DRIFT_REVISION_SCOPE_MISSING',
        'drift.tsv',
        drift.line,
        `Revision ${drift.revision} does not name ${requirementId} as affected.`,
      )
    }
  }
}

type RequirementField = 'specification' | 'implementation' | 'verification'

function requireLocators(
  requirement: V2Requirement,
  field: RequirementField,
  existingPaths: ReadonlySet<string>,
  diagnostics: V2GovernanceDiagnostic[],
): void {
  const value = requirement[field]
  if (value === '-') {
    report(
      diagnostics,
      'V2_REQUIREMENT_EVIDENCE_MISSING',
      'requirements.tsv',
      requirement.line,
      `Requirement ${requirement.requirementId} is ${requirement.state} but has no ${field} locator.`,
    )
    return
  }
  for (const path of locators(value)) {
    if (!existingPaths.has(path)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_PATH_MISSING',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} references missing ${field} path ${path}.`,
      )
    }
  }
}

function validateAcceptedRevision(
  requirement: V2Requirement,
  input: V2GovernanceInput,
  diagnostics: V2GovernanceDiagnostic[],
): void {
  if (requirement.revision === '-') {
    report(
      diagnostics,
      'V2_REQUIREMENT_REVISION_MISSING',
      'requirements.tsv',
      requirement.line,
      `Requirement ${requirement.requirementId} needs an accepted revision record.`,
    )
    return
  }
  for (const path of locators(requirement.revision)) {
    const revision = input.revisionTexts.get(path)
    if (revision === undefined) {
      report(
        diagnostics,
        'V2_REQUIREMENT_REVISION_NOT_FOUND',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} references missing revision ${path}.`,
      )
      continue
    }
    if (!/^Status:\s*accepted\s*$/imu.test(revision)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_REVISION_NOT_ACCEPTED',
        'requirements.tsv',
        requirement.line,
        `Requirement ${requirement.requirementId} references revision ${path}, which is not accepted.`,
      )
    }
    const affected = /^Affected requirements:\s*(.+)$/imu.exec(revision)?.[1]
    const affectedIds = new Set(affected?.split(',').map((value) => value.trim()) ?? [])
    if (!affectedIds.has(requirement.requirementId)) {
      report(
        diagnostics,
        'V2_REQUIREMENT_REVISION_SCOPE_MISSING',
        'requirements.tsv',
        requirement.line,
        `Revision ${path} does not name ${requirement.requirementId} as affected.`,
      )
    }
  }
}

function validateGateOrder(gates: readonly V2Gate[], diagnostics: V2GovernanceDiagnostic[]): void {
  const ids = new Set<string>()
  let active = 0
  let priorIncomplete = false
  for (const gate of gates) {
    if (ids.has(gate.gateId)) {
      report(
        diagnostics,
        'V2_GATE_ID_DUPLICATE',
        'gates.tsv',
        gate.line,
        `Duplicate gate ID ${gate.gateId}.`,
      )
    }
    ids.add(gate.gateId)
    if (gate.status === 'in-progress') active += 1
    if ((gate.status === 'in-progress' || gate.status === 'complete') && priorIncomplete) {
      report(
        diagnostics,
        'V2_GATE_ORDER_INVALID',
        'gates.tsv',
        gate.line,
        `Gate ${gate.gateId} advanced before an earlier gate completed.`,
      )
    }
    if (gate.status !== 'complete') priorIncomplete = true
  }
  if (active > 1) {
    report(
      diagnostics,
      'V2_GATE_ACTIVE_MULTIPLE',
      'gates.tsv',
      1,
      `Expected at most one in-progress gate, found ${active}.`,
    )
  }
}

function validateGateEvidence(
  gate: V2Gate,
  existingPaths: ReadonlySet<string>,
  diagnostics: V2GovernanceDiagnostic[],
): void {
  if (gate.evidence === '-') {
    report(
      diagnostics,
      'V2_GATE_EVIDENCE_MISSING',
      'gates.tsv',
      gate.line,
      `Gate ${gate.gateId} is ${gate.status} but has no evidence locator.`,
    )
    return
  }
  for (const path of locators(gate.evidence)) {
    if (!existingPaths.has(path)) {
      report(
        diagnostics,
        'V2_GATE_EVIDENCE_NOT_FOUND',
        'gates.tsv',
        gate.line,
        `Gate ${gate.gateId} references missing evidence path ${path}.`,
      )
    }
  }
}

function parseTsv<Header extends readonly string[]>(
  text: string,
  header: Header,
  source: V2GovernanceDiagnostic['source'],
  diagnostics: V2GovernanceDiagnostic[],
): readonly Readonly<Record<Header[number], string>>[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const actualHeader = lines[0]?.split('\t') ?? []
  if (actualHeader.join('\t') !== header.join('\t')) {
    report(
      diagnostics,
      'V2_LEDGER_HEADER_INVALID',
      source,
      1,
      `Expected header ${header.join(', ')}.`,
    )
    return []
  }
  const rows: Readonly<Record<Header[number], string>>[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!line) continue
    const values = line.split('\t')
    if (values.length !== header.length) {
      report(
        diagnostics,
        'V2_LEDGER_ROW_INVALID',
        source,
        index + 1,
        `Expected ${header.length} columns, found ${values.length}.`,
      )
      continue
    }
    const row = Object.fromEntries(header.map((name, column) => [name, values[column]!])) as Record<
      Header[number],
      string
    >
    if (Object.values(row).some((value) => !value.trim())) {
      report(
        diagnostics,
        'V2_LEDGER_VALUE_EMPTY',
        source,
        index + 1,
        'Ledger values must be explicit; use - for not-yet-applicable locators.',
      )
    }
    Object.defineProperty(row, '__line', { value: index + 1 })
    rows.push(row)
  }
  return rows
}

function toRequirement(
  row: Readonly<Record<(typeof V2_REQUIREMENTS_HEADER)[number], string>>,
): V2Requirement {
  return {
    requirementId: row.requirement_id,
    area: row.area,
    decision: row.decision,
    owner: row.owner,
    gate: row.gate,
    state: row.state as V2RequirementState,
    adrSection: row.adr_section,
    specification: row.specification,
    implementation: row.implementation,
    verification: row.verification,
    revision: row.revision,
    line: lineOf(row),
  }
}

function toGate(row: Readonly<Record<(typeof V2_GATES_HEADER)[number], string>>): V2Gate {
  return {
    gateId: row.gate_id,
    name: row.name,
    status: row.status as V2GateStatus,
    exitCriteria: row.exit_criteria,
    evidence: row.evidence,
    line: lineOf(row),
  }
}

function toDrift(row: Readonly<Record<(typeof V2_DRIFT_HEADER)[number], string>>): V2Drift {
  return {
    driftId: row.drift_id,
    affectedRequirements: row.affected_requirements.split(';').map((value) => value.trim()),
    classification: row.classification as V2DriftClassification,
    v1Observation: row.v1_observation,
    v2Decision: row.v2_decision,
    rationale: row.rationale,
    status: row.status as V2DriftStatus,
    revision: row.revision,
    verification: row.verification,
    line: lineOf(row),
  }
}

function lineOf(row: object): number {
  return (row as { readonly __line?: number }).__line ?? 1
}

function markdownSections(markdown: string): ReadonlySet<string> {
  return new Set(
    [...markdown.matchAll(/^#{2,6}\s+(.+)$/gmu)].map((match) => normalizeHeading(match[1]!)),
  )
}

function normalizeHeading(heading: string): string {
  return heading.replace(/`/gu, '').trim().toLocaleLowerCase('en-US')
}

function locators(value: string): readonly string[] {
  return value.split(';').map((path) => path.trim())
}

function report(
  diagnostics: V2GovernanceDiagnostic[],
  code: string,
  source: V2GovernanceDiagnostic['source'],
  line: number,
  message: string,
): void {
  diagnostics.push({ code, source, line, message })
}
