import { describe, expect, it } from 'vitest'

import {
  V2_DRIFT_HEADER,
  V2_GATES_HEADER,
  V2_REQUIREMENTS_HEADER,
  validateV2Governance,
} from '../qualification/v2-governance.ts'

describe('TypeSpec V2 governance', () => {
  it('accepts a traced ratified requirement in the active gate', () => {
    const result = validateV2Governance({
      requirementsText: requirements([requirement()]),
      gatesText: gates([gate()]),
      driftText: drift([]),
      adrText: '# ADR\n\n## Decision\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.requirements).toHaveLength(1)
    expect(result.gates).toHaveLength(1)
    expect(result.diagnostics).toEqual([])
  })

  it('requires concrete contract, implementation, and verification paths before qualification', () => {
    const result = validateV2Governance({
      requirementsText: requirements([
        requirement({
          state: 'qualified',
          specification: '-',
          implementation: '-',
          verification: '-',
        }),
      ]),
      gatesText: gates([gate()]),
      driftText: drift([]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V2_REQUIREMENT_EVIDENCE_MISSING',
      'V2_REQUIREMENT_EVIDENCE_MISSING',
      'V2_REQUIREMENT_EVIDENCE_MISSING',
    ])
  })

  it('does not complete a gate while one owned requirement remains unqualified', () => {
    const result = validateV2Governance({
      requirementsText: requirements([requirement()]),
      gatesText: gates([gate({ status: 'complete' })]),
      driftText: drift([]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'V2_GATE_REQUIREMENT_INCOMPLETE' }),
    ])
  })

  it('rejects an unaccepted or incorrectly scoped material revision', () => {
    const revision = 'revision.md'
    const result = validateV2Governance({
      requirementsText: requirements([requirement({ state: 'deferred', revision })]),
      gatesText: gates([gate()]),
      driftText: drift([]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md', revision]),
      revisionTexts: new Map([
        [revision, 'Status: proposed\n\nAffected requirements: V2-ARC-999\n'],
      ]),
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V2_REQUIREMENT_REVISION_NOT_ACCEPTED',
      'V2_REQUIREMENT_REVISION_SCOPE_MISSING',
    ])
  })

  it('validates every accepted revision in a semicolon-separated history', () => {
    const result = validateV2Governance({
      requirementsText: requirements([requirement({ revision: 'first.md;second.md' })]),
      gatesText: gates([gate()]),
      driftText: drift([]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md', 'first.md', 'second.md']),
      revisionTexts: new Map([
        ['first.md', 'Status: accepted\n\nAffected requirements: V2-ARC-001\n'],
        ['second.md', 'Status: accepted\n\nAffected requirements: V2-ARC-001\n'],
      ]),
    })

    expect(result.diagnostics).toEqual([])
  })

  it('requires gates to advance in order with at most one active gate', () => {
    const result = validateV2Governance({
      requirementsText: requirements([requirement()]),
      gatesText: gates([
        gate({ gateId: 'G0', status: 'in-progress' }),
        gate({ gateId: 'G1', status: 'in-progress' }),
      ]),
      driftText: drift([]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V2_GATE_ORDER_INVALID',
      'V2_GATE_ACTIVE_MULTIPLE',
    ])
  })

  it('rejects malformed rows and missing ADR ownership sections', () => {
    const malformed = `${V2_REQUIREMENTS_HEADER.join('\t')}\nV2-ARC-001\ttoo-few\n`
    const result = validateV2Governance({
      requirementsText: malformed,
      gatesText: gates([gate()]),
      driftText: drift([]),
      adrText: '## Other\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'V2_LEDGER_ROW_INVALID', source: 'requirements.tsv' }),
    ])
  })

  it('treats accepted defect corrections as reviewed semantic changes, not silent parity', () => {
    const revision = 'revision.md'
    const verification = 'regression.test.ts'
    const result = validateV2Governance({
      requirementsText: requirements([requirement()]),
      gatesText: gates([gate()]),
      driftText: drift([
        driftEntry({
          classification: 'defect-correction',
          status: 'accepted',
          revision,
          verification,
        }),
      ]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md', revision, verification]),
      revisionTexts: new Map([
        [revision, 'Status: accepted\n\nAffected requirements: V2-ARC-001\n'],
      ]),
    })

    expect(result.drift).toHaveLength(1)
    expect(result.diagnostics).toEqual([])
  })

  it('rejects accepted semantic drift without a revision and regression evidence', () => {
    const result = validateV2Governance({
      requirementsText: requirements([requirement()]),
      gatesText: gates([gate()]),
      driftText: drift([
        driftEntry({ classification: 'intentional-evolution', status: 'accepted' }),
      ]),
      adrText: '## Decision\n',
      existingPaths: new Set(['baseline.md']),
      revisionTexts: new Map(),
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'V2_DRIFT_VERIFICATION_MISSING',
      'V2_DRIFT_REVISION_MISSING',
    ])
  })
})

interface RequirementFixture {
  readonly requirementId: string
  readonly state: string
  readonly specification: string
  readonly implementation: string
  readonly verification: string
  readonly revision: string
}

function requirement(overrides: Partial<RequirementFixture> = {}): string {
  const fixture: RequirementFixture = {
    requirementId: 'V2-ARC-001',
    state: 'ratified',
    specification: '-',
    implementation: '-',
    verification: '-',
    revision: '-',
    ...overrides,
  }
  return [
    fixture.requirementId,
    'architecture',
    'The decision remains attributable.',
    'Architecture',
    'G0',
    fixture.state,
    'Decision',
    fixture.specification,
    fixture.implementation,
    fixture.verification,
    fixture.revision,
  ].join('\t')
}

interface GateFixture {
  readonly gateId: string
  readonly status: string
}

function gate(overrides: Partial<GateFixture> = {}): string {
  const fixture: GateFixture = { gateId: 'G0', status: 'in-progress', ...overrides }
  return [fixture.gateId, 'Baseline', fixture.status, 'Evidence is frozen.', 'baseline.md'].join(
    '\t',
  )
}

function requirements(rows: readonly string[]): string {
  return `${V2_REQUIREMENTS_HEADER.join('\t')}\n${rows.join('\n')}\n`
}

function gates(rows: readonly string[]): string {
  return `${V2_GATES_HEADER.join('\t')}\n${rows.join('\n')}\n`
}

interface DriftFixture {
  readonly classification: string
  readonly status: string
  readonly revision: string
  readonly verification: string
}

function driftEntry(overrides: Partial<DriftFixture> = {}): string {
  const fixture: DriftFixture = {
    classification: 'representation-only',
    status: 'proposed',
    revision: '-',
    verification: '-',
    ...overrides,
  }
  return [
    'V2-DRIFT-001',
    'V2-ARC-001',
    fixture.classification,
    'V1 observation.',
    'V2 decision.',
    'The decision is explicit.',
    fixture.status,
    fixture.revision,
    fixture.verification,
  ].join('\t')
}

function drift(rows: readonly string[]): string {
  return `${V2_DRIFT_HEADER.join('\t')}\n${rows.join('\n')}\n`
}
