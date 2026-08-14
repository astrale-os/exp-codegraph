import type {
  ViewerQualification as Verification,
  ViewerQualificationDiagnostic as VerificationDiagnostic,
  ViewerQualificationLocation as VerificationLocation,
  ViewerQualificationProfile as VerificationProfile,
  ViewerQualificationRule as VerificationRule,
  ViewerQualificationStatus as VerificationStatus,
} from '../../viewer-host/qualification.ts'
import type { VerificationRun } from '../../application/interaction/qualification.ts'

import { VERIFICATION_PROTOCOL, VerificationAdapterError } from '../../application/interaction/qualification.ts'
import { freeze } from './freeze.ts'

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value

export function parseVerificationResponse(
  value: unknown,
  response: Pick<Response, 'ok' | 'status'>,
  request: VerificationRun,
): Verification {
  const result = record(value, 'Verification response')
  if (result.protocol !== VERIFICATION_PROTOCOL) {
    throw new VerificationAdapterError(
      'PROTOCOL_MISMATCH',
      'Verification adapter returned an unsupported protocol.',
    )
  }
  if (result.status === 'rejected') {
    exactKeys(
      result,
      new Set(['protocol', 'status', 'code', 'message', 'source', 'revision']),
      'Verification response',
    )
    throw new VerificationAdapterError(
      optionalText(result.code) ?? `HTTP_${response.status}`,
      optionalText(result.message) ?? `Verification request failed with HTTP ${response.status}.`,
    )
  }
  if (!response.ok || result.status !== 'completed') {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `Verification adapter returned an invalid HTTP ${response.status} response.`,
    )
  }
  exactKeys(
    result,
    new Set(['protocol', 'status', 'source', 'revision', 'verification']),
    'Verification response',
  )
  if (result.source !== request.source || result.revision !== request.revision) {
    throw new VerificationAdapterError(
      'RESPONSE_MISMATCH',
      'Verification adapter returned a result for a different specification revision.',
    )
  }
  return freeze(normalizeVerification(result.verification))
}

function normalizeVerification(value: unknown): Verification {
  const input = record(value, 'verification')
  exactKeys(
    input,
    new Set(['status', 'profiles', 'rules', 'dependencies', 'durationMs']),
    'verification',
  )
  const status = verificationStatus(input.status, 'verification.status')
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new VerificationAdapterError('RESPONSE_INVALID', 'verification.rules must be non-empty.')
  }
  if (!Array.isArray(input.dependencies) || !input.dependencies.every(isString)) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      'verification.dependencies must contain only strings.',
    )
  }
  if (!Number.isInteger(input.durationMs) || Number(input.durationMs) < 0) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      'verification.durationMs must be a non-negative integer.',
    )
  }
  const identifiers = new Set<string>()
  const rules = input.rules.map((value, index) => {
    const rule = normalizeRule(value, `verification.rules[${index}]`)
    if (identifiers.has(rule.id)) {
      throw new VerificationAdapterError(
        'RESPONSE_INVALID',
        `verification.rules contains duplicate id ${rule.id}.`,
      )
    }
    identifiers.add(rule.id)
    return rule
  })
  if (!Array.isArray(input.profiles)) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      'verification.profiles must be an array.',
    )
  }
  const profiles = input.profiles.map((value, index) =>
    normalizeProfile(value, `verification.profiles[${index}]`),
  )
  const profileKeys = new Set<string>()
  for (const profile of profiles) {
    const key = `${profile.id}\0${profile.target?.id ?? ''}`
    if (profileKeys.has(key)) {
      throw new VerificationAdapterError(
        'RESPONSE_INVALID',
        `verification.profiles contains duplicate profile ${profile.id}.`,
      )
    }
    profileKeys.add(key)
  }
  if (aggregate(rules.map((rule) => rule.status)) !== status) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      'verification.status does not match its rule outcomes.',
    )
  }
  if (profiles.length && aggregate(profiles.map((profile) => profile.status)) !== status) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      'verification.status does not match its profile outcomes.',
    )
  }
  return {
    status,
    profiles,
    rules,
    dependencies: [...input.dependencies] as string[],
    durationMs: Number(input.durationMs),
  }
}

function normalizeRule(value: unknown, label: string): Mutable<VerificationRule> {
  const rule = record(value, label)
  exactKeys(rule, new Set(['id', 'status', 'diagnostics']), label)
  if (typeof rule.id !== 'string' || rule.id.length === 0 || !Array.isArray(rule.diagnostics)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} is invalid.`)
  }
  return {
    id: rule.id,
    status: verificationStatus(rule.status, `${label}.status`),
    diagnostics: rule.diagnostics.map((value, index) =>
      diagnostic(value, `${label}.diagnostics[${index}]`),
    ),
  }
}

function normalizeProfile(value: unknown, label: string): Mutable<VerificationProfile> {
  const input = record(value, label)
  exactKeys(
    input,
    new Set(['id', 'provider', 'target', 'status', 'rules', 'coverage', 'evidence']),
    label,
  )
  if (!Array.isArray(input.rules)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.rules must be an array.`)
  }
  const rules = input.rules.map((rule, index) => normalizeRule(rule, `${label}.rules[${index}]`))
  const ruleIds = new Set<string>()
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) {
      throw new VerificationAdapterError(
        'RESPONSE_INVALID',
        `${label}.rules contains duplicate id ${rule.id}.`,
      )
    }
    ruleIds.add(rule.id)
  }
  const status = verificationStatus(input.status, `${label}.status`)
  if (aggregate(rules.map((rule) => rule.status)) !== status && rules.length > 0) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label}.status does not match its rules.`,
    )
  }
  if (rules.length === 0 && status !== 'pass') {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label} cannot report ${status} without an evidence rule.`,
    )
  }
  const output: Mutable<VerificationProfile> = {
    id: requiredText(input.id, `${label}.id`),
    provider: requiredText(input.provider, `${label}.provider`),
    status,
    rules,
  }
  if (input.target !== undefined) {
    const target = record(input.target, `${label}.target`)
    exactKeys(
      target,
      new Set([
        'id',
        'adapter',
        'project',
        'root',
        'entrypoint',
        'facades',
        'aliases',
        'internals',
      ]),
      `${label}.target`,
    )
    output.target = {
      id: requiredText(target.id, `${label}.target.id`),
      adapter: requiredText(target.adapter, `${label}.target.adapter`),
      project: requiredText(target.project, `${label}.target.project`),
      root: requiredText(target.root, `${label}.target.root`),
      entrypoint: requiredText(target.entrypoint, `${label}.target.entrypoint`),
    }
    if (target.facades !== undefined) {
      if (!Array.isArray(target.facades)) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.facades must be an array.`,
        )
      }
      output.target.facades = target.facades.map((facade, index) =>
        requiredText(facade, `${label}.target.facades[${index}]`),
      )
      if (
        output.target.facades.length === 0 ||
        new Set(output.target.facades).size !== output.target.facades.length ||
        output.target.facades.includes(output.target.entrypoint)
      ) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.facades must be non-empty, unique, and distinct from entrypoint.`,
        )
      }
    }
    if (target.aliases !== undefined) {
      if (!Array.isArray(target.aliases)) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.aliases must be an array.`,
        )
      }
      output.target.aliases = target.aliases.map((alias, index) =>
        requiredText(alias, `${label}.target.aliases[${index}]`),
      )
      if (
        output.target.aliases.length === 0 ||
        new Set(output.target.aliases).size !== output.target.aliases.length ||
        output.target.aliases.includes(output.target.entrypoint) ||
        output.target.aliases.some((alias) => output.target?.facades?.includes(alias))
      ) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.aliases must be non-empty, unique, and distinct from entrypoint and facades.`,
        )
      }
    }
    if (target.internals !== undefined) {
      if (!Array.isArray(target.internals)) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.internals must be an array.`,
        )
      }
      output.target.internals = target.internals.map((internal, index) =>
        requiredText(internal, `${label}.target.internals[${index}]`),
      )
      if (
        output.target.internals.length === 0 ||
        new Set(output.target.internals).size !== output.target.internals.length ||
        output.target.internals.includes(output.target.entrypoint) ||
        output.target.internals.some(
          (internal) =>
            output.target?.facades?.includes(internal) ||
            output.target?.aliases?.includes(internal),
        )
      ) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.target.internals must be non-empty, unique, and distinct from public entrypoints.`,
        )
      }
    }
  }
  if (input.coverage !== undefined)
    output.coverage = normalizeCoverage(input.coverage, `${label}.coverage`)
  if (input.evidence !== undefined)
    output.evidence = normalizeEvidence(input.evidence, `${label}.evidence`)
  if (output.coverage && output.evidence) {
    validateCoverageInventory(
      output.coverage.forward.unmatched,
      output.evidence.missingSurface,
      `${label}.evidence.missingSurface`,
    )
    validateCoverageInventory(
      output.coverage.inverse.unmatched,
      output.evidence.undeclaredSurface,
      `${label}.evidence.undeclaredSurface`,
    )
  }
  return output
}

function normalizeCoverage(
  value: unknown,
  label: string,
): Mutable<NonNullable<VerificationProfile['coverage']>> {
  const input = record(value, label)
  exactKeys(input, new Set(['forward', 'inverse']), label)
  return {
    forward: normalizeCoverageDirection(input.forward, `${label}.forward`),
    inverse: normalizeCoverageDirection(input.inverse, `${label}.inverse`),
  }
}

function normalizeCoverageDirection(
  value: unknown,
  label: string,
): Mutable<NonNullable<VerificationProfile['coverage']>['forward']> {
  const input = record(value, label)
  exactKeys(input, new Set(['matched', 'total', 'percent', 'unmatched']), label)
  if (!Array.isArray(input.unmatched)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.unmatched must be an array.`)
  }
  const matched = nonNegativeInteger(input.matched, `${label}.matched`)
  const total = nonNegativeInteger(input.total, `${label}.total`)
  if (matched > total) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.matched exceeds total.`)
  }
  const percent = input.percent === null ? null : Number(input.percent)
  const expectedPercent = total === 0 ? null : Math.round((matched / total) * 10_000) / 100
  if (percent !== expectedPercent) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.percent is invalid.`)
  }
  if (input.unmatched.length !== total - matched) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label}.unmatched does not account for every unmatched obligation.`,
    )
  }
  const unmatchedIds = new Set<string>()
  return {
    matched,
    total,
    percent,
    unmatched: input.unmatched.map((value, index) => {
      const item = record(value, `${label}.unmatched[${index}]`)
      exactKeys(item, new Set(['id', 'label', 'location']), `${label}.unmatched[${index}]`)
      const id = requiredText(item.id, `${label}.unmatched[${index}].id`)
      if (unmatchedIds.has(id)) {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.unmatched contains duplicate id ${id}.`,
        )
      }
      unmatchedIds.add(id)
      return {
        id,
        label: requiredText(item.label, `${label}.unmatched[${index}].label`),
        location:
          item.location === undefined
            ? undefined
            : location(item.location, `${label}.unmatched[${index}].location`),
      }
    }),
  }
}

function validateCoverageInventory(
  coverage: readonly { readonly id: string }[],
  evidence: readonly { readonly id: string }[] | undefined,
  label: string,
): void {
  if (evidence === undefined) return
  const expected = coverage.map((item) => item.id).sort()
  const actual = evidence.map((item) => item.id).sort()
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label} does not match the corresponding coverage inventory.`,
    )
  }
}

function normalizeEvidence(
  value: unknown,
  label: string,
): Mutable<NonNullable<VerificationProfile['evidence']>> {
  const input = record(value, label)
  exactKeys(
    input,
    new Set([
      'observedModules',
      'missingSurface',
      'undeclaredSurface',
      'outboundDependencies',
      'inboundDependencies',
      'proof',
    ]),
    label,
  )
  const output: Mutable<NonNullable<VerificationProfile['evidence']>> = {}
  if (input.observedModules !== undefined) {
    if (!Array.isArray(input.observedModules) || !input.observedModules.every(isString)) {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.observedModules is invalid.`)
    }
    output.observedModules = [...input.observedModules]
  }
  for (const key of ['missingSurface', 'undeclaredSurface'] as const) {
    if (input[key] === undefined) continue
    if (!Array.isArray(input[key])) {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.${key} must be an array.`)
    }
    output[key] = input[key].map((value, index) => {
      const item = record(value, `${label}.${key}[${index}]`)
      exactKeys(item, new Set(['id', 'label', 'location']), `${label}.${key}[${index}]`)
      return {
        id: requiredText(item.id, `${label}.${key}[${index}].id`),
        label: requiredText(item.label, `${label}.${key}[${index}].label`),
        location:
          item.location === undefined
            ? undefined
            : location(item.location, `${label}.${key}[${index}].location`),
      }
    })
  }
  for (const key of ['outboundDependencies', 'inboundDependencies'] as const) {
    if (input[key] === undefined) continue
    if (!Array.isArray(input[key])) {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.${key} must be an array.`)
    }
    output[key] = input[key].map((value, index) => {
      const edge = record(value, `${label}.${key}[${index}]`)
      exactKeys(
        edge,
        new Set(['id', 'source', 'target', 'kind', 'deep', 'location']),
        `${label}.${key}[${index}]`,
      )
      if (typeof edge.deep !== 'boolean') {
        throw new VerificationAdapterError(
          'RESPONSE_INVALID',
          `${label}.${key}[${index}].deep is invalid.`,
        )
      }
      return {
        id: requiredText(edge.id, `${label}.${key}[${index}].id`),
        source: requiredText(edge.source, `${label}.${key}[${index}].source`),
        target: requiredText(edge.target, `${label}.${key}[${index}].target`),
        kind: requiredText(edge.kind, `${label}.${key}[${index}].kind`),
        deep: edge.deep,
        location:
          edge.location === undefined
            ? undefined
            : location(edge.location, `${label}.${key}[${index}].location`),
      }
    })
  }
  if (input.proof !== undefined) {
    const proof = record(input.proof, `${label}.proof`)
    exactKeys(
      proof,
      new Set(['exactDeclarations', 'identityDeclarations', 'unprovenObservations']),
      `${label}.proof`,
    )
    output.proof = {
      exactDeclarations: normalizeCoverageItems(
        proof.exactDeclarations,
        `${label}.proof.exactDeclarations`,
      ),
      identityDeclarations: normalizeCoverageItems(
        proof.identityDeclarations,
        `${label}.proof.identityDeclarations`,
      ),
      unprovenObservations: normalizeDiagnostics(
        proof.unprovenObservations,
        `${label}.proof.unprovenObservations`,
      ),
    }
    const overlap = output.proof!.exactDeclarations.find((item) =>
      output.proof!.identityDeclarations.some((candidate) => candidate.id === item.id),
    )
    if (overlap) {
      throw new VerificationAdapterError(
        'RESPONSE_INVALID',
        `${label}.proof declaration ${overlap.id} cannot be both exact and identity-only.`,
      )
    }
  }
  return output
}

function normalizeCoverageItems(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must be an array.`)
  }
  const identifiers = new Set<string>()
  return value.map((value, index) => {
    const item = record(value, `${label}[${index}]`)
    exactKeys(item, new Set(['id', 'label', 'location']), `${label}[${index}]`)
    const id = requiredText(item.id, `${label}[${index}].id`)
    if (identifiers.has(id)) {
      throw new VerificationAdapterError(
        'RESPONSE_INVALID',
        `${label} contains duplicate id ${id}.`,
      )
    }
    identifiers.add(id)
    return {
      id,
      label: requiredText(item.label, `${label}[${index}].label`),
      location:
        item.location === undefined
          ? undefined
          : location(item.location, `${label}[${index}].location`),
    }
  })
}

function normalizeDiagnostics(value: unknown, label: string): Mutable<VerificationDiagnostic>[] {
  if (!Array.isArray(value)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must be an array.`)
  }
  return value.map((value, index) => diagnostic(value, `${label}[${index}]`))
}

function diagnostic(value: unknown, label: string): Mutable<VerificationDiagnostic> {
  const input = record(value, label)
  exactKeys(
    input,
    new Set(['code', 'message', 'severity', 'location', 'related', 'expected', 'actual', 'hint']),
    label,
  )
  if (typeof input.message !== 'string' || input.message.length === 0) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.message is invalid.`)
  }
  const output: Mutable<VerificationDiagnostic> = { message: input.message }
  if (input.code !== undefined) output.code = requiredText(input.code, `${label}.code`)
  if (input.severity !== undefined) {
    if (input.severity !== 'error' && input.severity !== 'warning' && input.severity !== 'info') {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.severity is invalid.`)
    }
    output.severity = input.severity
  }
  if (input.location !== undefined) output.location = location(input.location, `${label}.location`)
  if (input.related !== undefined) {
    if (!Array.isArray(input.related)) {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.related must be an array.`)
    }
    output.related = input.related.map((value, index) =>
      location(value, `${label}.related[${index}]`),
    )
  }
  if (Object.hasOwn(input, 'expected')) output.expected = input.expected
  if (Object.hasOwn(input, 'actual')) output.actual = input.actual
  if (input.hint !== undefined) output.hint = requiredText(input.hint, `${label}.hint`)
  return output
}

function location(value: unknown, label: string): Mutable<VerificationLocation> {
  const input = record(value, label)
  exactKeys(input, new Set(['file', 'external', 'line', 'column', 'pointer', 'label']), label)
  const output: Mutable<VerificationLocation> = {}
  if (input.file !== undefined) output.file = requiredText(input.file, `${label}.file`)
  if (input.external !== undefined) {
    output.external = requiredText(input.external, `${label}.external`)
  }
  if (output.file !== undefined && output.external !== undefined) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label} cannot contain both file and external.`,
    )
  }
  if (input.line !== undefined) output.line = positiveInteger(input.line, `${label}.line`)
  if (input.column !== undefined) output.column = positiveInteger(input.column, `${label}.column`)
  if (input.pointer !== undefined) {
    if (typeof input.pointer !== 'string') {
      throw new VerificationAdapterError('RESPONSE_INVALID', `${label}.pointer must be a string.`)
    }
    output.pointer = input.pointer
  }
  if (input.label !== undefined) output.label = requiredText(input.label, `${label}.label`)
  if (Object.keys(output).length === 0) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must not be empty.`)
  }
  return output
}

function aggregate(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('idle')) return 'idle'
  return 'pass'
}

function verificationStatus(value: unknown, label: string): VerificationStatus {
  if (value === 'pass' || value === 'fail' || value === 'idle' || value === 'error') return value
  throw new VerificationAdapterError('RESPONSE_INVALID', `${label} is invalid.`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label} contains unsupported property ${unknown}.`,
    )
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must be a non-empty string.`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new VerificationAdapterError('RESPONSE_INVALID', `${label} must be a positive integer.`)
  }
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new VerificationAdapterError(
      'RESPONSE_INVALID',
      `${label} must be a non-negative integer.`,
    )
  }
  return Number(value)
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
