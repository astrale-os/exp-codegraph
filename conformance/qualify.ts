import { createHash } from 'node:crypto'

import type { AnalysisQuery, Completeness, ProjectUniverseId } from '../analysis/index.ts'
import type {
  ConformanceDiagnostic,
  ConformanceProfile,
  ConformanceRuleResult,
  ConformanceStatus,
  QualificationProfileResult,
  QualificationSnapshot,
  QualificationSnapshotId,
  QualifySpecificationOptions,
  QualifySpecificationsOptions,
} from './model.ts'
import type { AnalysisSnapshotSet } from '../analysis/index.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'

import { planConformance } from './plan.ts'

/** Compare one immutable specification with one exact, generation-pinned analysis snapshot set. */
export async function qualifySpecification(
  options: QualifySpecificationOptions,
): Promise<QualificationSnapshot> {
  const [qualification] = await qualifySpecifications({
    specifications: [options.specification],
    analysis: options.analysis,
    profiles: options.profiles,
    ...(options.requestedProfiles ? { requestedProfiles: options.requestedProfiles } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!qualification) throw new Error('Single-specification qualification returned no result.')
  return qualification
}

/** Qualify one corpus while leasing every pinned universe and capability view exactly once. */
export async function qualifySpecifications(
  options: QualifySpecificationsOptions,
): Promise<readonly QualificationSnapshot[]> {
  options.signal?.throwIfAborted()
  const plan = planConformance(options.profiles, options.requestedProfiles)
  const queries = new Map<ProjectUniverseId, AnalysisQuery>()
  try {
    for (const universe of options.analysis.universes) {
      options.signal?.throwIfAborted()
      queries.set(universe, await options.analysis.query(universe))
    }
    const capabilityByUniverse = new Map<ProjectUniverseId, ReadonlyMap<string, Completeness>>()
    for (const [universe, query] of queries) {
      capabilityByUniverse.set(
        universe,
        new Map(
          (await query.capabilities()).map((entry) => [entry.capability, entry.completeness]),
        ),
      )
    }
    const qualifications: QualificationSnapshot[] = []
    for (const specification of options.specifications) {
      options.signal?.throwIfAborted()
      qualifications.push(
        await qualifyPreparedSpecification(
          specification,
          options,
          plan,
          queries,
          capabilityByUniverse,
        ),
      )
    }
    return qualifications
  } finally {
    await Promise.all([...queries.values()].map((query) => query.dispose()))
  }
}

/**
 * Bind already-proven specification-local profile results to a newer exact analysis snapshot.
 * The caller owns the proof that every profile input is unchanged; universe-scoped profiles must
 * never use this helper after a generation change.
 */
export function rebindQualificationSnapshot(
  qualification: QualificationSnapshot,
  specification: SpecificationSnapshot,
  analysis: AnalysisSnapshotSet,
): QualificationSnapshot {
  if (
    qualification.specification.id !== specification.id ||
    qualification.specification.source !== specification.source
  ) {
    throw new Error('A qualification can only be rebound to the same specification identity.')
  }
  const compiled = {
    format: qualification.format,
    version: qualification.version,
    specification: {
      id: specification.id,
      revision: specification.revision,
      source: specification.source,
    },
    analysis: { id: analysis.id, universes: [...analysis.universes] },
    scope: qualification.scope,
    status: qualification.status,
    profiles: qualification.profiles,
  }
  return immutable({ ...compiled, id: qualificationIdentity(compiled) })
}

async function qualifyPreparedSpecification(
  specification: QualifySpecificationOptions['specification'],
  options: QualifySpecificationsOptions,
  plan: ReturnType<typeof planConformance>,
  queries: ReadonlyMap<ProjectUniverseId, AnalysisQuery>,
  capabilityByUniverse: ReadonlyMap<ProjectUniverseId, ReadonlyMap<string, Completeness>>,
): Promise<QualificationSnapshot> {
  const results = new Map<string, QualificationProfileResult>()
  for (const profile of plan.ordered) {
    options.signal?.throwIfAborted()
    const evidenceCompleteness = await requiredEvidence(
      profile,
      specification.module.id,
      options.analysis.universes,
      capabilityByUniverse,
      queries,
    )
    const unavailable = evidenceCompleteness.filter((entry) => !evidenceSatisfies(entry))
    let rules: readonly ConformanceRuleResult[]
    if (unavailable.length) {
      rules = profile.manifest.rules.map((rule) => ({
        rule,
        status: 'indeterminate',
        diagnostics: unavailable.map((entry) => unavailableDiagnostic(profile, rule, entry)),
        coverage: emptyCoverage(),
      }))
    } else {
      try {
        rules = normalizeRules(
          profile,
          await profile.evaluate({
            specification,
            analysis: options.analysis,
            queries,
            dependencyResults: results,
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        )
        options.signal?.throwIfAborted()
      } catch (error) {
        if (options.signal?.aborted) options.signal.throwIfAborted()
        rules = profile.manifest.rules.map((rule) => ({
          rule,
          status: 'error',
          diagnostics: [
            {
              code: 'CONFORMANCE_PROFILE_FAILED',
              severity: 'error',
              message: error instanceof Error ? error.message : String(error),
              profile: profile.manifest.id,
              rule,
              evidence: [],
              inputs: [],
            },
          ],
          coverage: emptyCoverage(),
        }))
      }
    }
    results.set(profile.manifest.id, {
      id: profile.manifest.id,
      version: profile.manifest.version,
      status: aggregate(rules.map((rule) => rule.status)),
      rules,
      coverage: aggregateCoverage(rules),
      evidenceCompleteness,
    })
  }

  const profiles = plan.ordered.map((profile) => results.get(profile.manifest.id)!)
  const compiled = {
    format: 'astrale.typespec.qualification' as const,
    version: 2 as const,
    specification: {
      id: specification.id,
      revision: specification.revision,
      source: specification.source,
    },
    analysis: {
      id: options.analysis.id,
      universes: [...options.analysis.universes],
    },
    scope: plan.scope,
    status: aggregate(profiles.map((profile) => profile.status)),
    profiles,
  }
  const id = qualificationIdentity(compiled)
  return immutable({ ...compiled, id })
}

async function requiredEvidence(
  profile: ConformanceProfile,
  specificationModule: string,
  universes: readonly ProjectUniverseId[],
  capabilities: ReadonlyMap<ProjectUniverseId, ReadonlyMap<string, Completeness>>,
  queries: ReadonlyMap<ProjectUniverseId, AnalysisQuery>,
): Promise<QualificationProfileResult['evidenceCompleteness']> {
  const values = (
    await Promise.all(
      profile.manifest.requiresCapabilities.map((requirement) =>
        requirementEvidence(
          requirement,
          specificationModule,
          universes,
          capabilities,
          queries,
        ),
      ),
    )
  ).flat()
  return values.sort((left, right) =>
    `${left.universe}\0${left.capability}`.localeCompare(`${right.universe}\0${right.capability}`),
  )
}

async function requirementEvidence(
  requirement: ConformanceProfile['manifest']['requiresCapabilities'][number],
  specificationModule: string,
  universes: readonly ProjectUniverseId[],
  capabilities: ReadonlyMap<ProjectUniverseId, ReadonlyMap<string, Completeness>>,
  queries: ReadonlyMap<ProjectUniverseId, AnalysisQuery>,
): Promise<QualificationProfileResult['evidenceCompleteness']> {
  const targets = requirement.universes ?? universes
  if ((requirement.scope ?? 'universe') === 'universe') {
    return targets.map((universe) =>
      evidenceEntry(
        universe,
        requirement,
        capabilities.get(universe)?.get(requirement.capability) ??
          capabilityMissing(requirement.capability, universe),
      ),
    )
  }
  const candidates = await Promise.all(
    targets.map(async (universe) => {
      const query = queries.get(universe)
      const facts = query
        ? (
            await query.facts(
              { namespaces: [requirement.capability], subjects: [specificationModule] },
              { limit: 10_000 },
            )
          ).facts
        : []
      return { universe, facts }
    }),
  )
  const present = candidates
    .filter((candidate) => candidate.facts.length)
    .map((candidate) =>
      evidenceEntry(
        candidate.universe,
        requirement,
        combineCompleteness(candidate.facts.map((fact) => fact.completeness)),
      ),
    )
  if (requirement.universes) {
    return candidates.map((candidate) =>
      candidate.facts.length
        ? present.find((entry) => entry.universe === candidate.universe)!
        : evidenceEntry(
            candidate.universe,
            requirement,
            capabilities.get(candidate.universe)?.get(requirement.capability) ??
              capabilityMissing(requirement.capability, candidate.universe),
          ),
    )
  }
  if (present.length) return present
  if (!targets.length) throw new Error('Conformance requires at least one analysis universe.')
  return targets.map((universe) =>
    evidenceEntry(
      universe,
      requirement,
      capabilities.get(universe)?.get(requirement.capability) ??
        capabilityMissing(requirement.capability, universe),
    ),
  )
}

function evidenceEntry(
  universe: ProjectUniverseId,
  requirement: ConformanceProfile['manifest']['requiresCapabilities'][number],
  completeness: Completeness,
): QualificationProfileResult['evidenceCompleteness'][number] {
  return {
    universe,
    capability: requirement.capability,
    completeness,
    minimumCompleteness: requirement.minimumCompleteness ?? 'complete',
    ...(requirement.acceptedPartialReasonCodes
      ? { acceptedPartialReasonCodes: [...requirement.acceptedPartialReasonCodes] }
      : {}),
  }
}

function evidenceSatisfies(
  entry: QualificationProfileResult['evidenceCompleteness'][number],
): boolean {
  if (entry.completeness.kind === 'complete') return true
  if (entry.completeness.kind === 'unavailable' || entry.minimumCompleteness === 'complete') {
    return false
  }
  const accepted = entry.acceptedPartialReasonCodes
  return accepted === undefined || entry.completeness.reasons.every((reason) => accepted.includes(reason.code))
}

function capabilityMissing(capability: string, universe: ProjectUniverseId): Completeness {
  return {
    kind: 'unavailable',
    reasons: [
      {
        code: 'CONFORMANCE_CAPABILITY_MISSING',
        message: `Required capability ${capability} is missing from ${universe}.`,
        retryable: false,
      },
    ],
  }
}

function combineCompleteness(values: readonly Completeness[]): Completeness {
  const unavailable = values.filter(
    (value): value is Extract<Completeness, { readonly kind: 'unavailable' }> =>
      value.kind === 'unavailable',
  )
  if (unavailable.length) {
    return { kind: 'unavailable', reasons: unavailable.flatMap((value) => value.reasons) }
  }
  const partial = values.filter(
    (value): value is Extract<Completeness, { readonly kind: 'partial' }> =>
      value.kind === 'partial',
  )
  return partial.length
    ? { kind: 'partial', reasons: partial.flatMap((value) => value.reasons) }
    : { kind: 'complete' }
}

function unavailableDiagnostic(
  profile: ConformanceProfile,
  rule: string,
  entry: QualificationProfileResult['evidenceCompleteness'][number],
): ConformanceDiagnostic {
  return {
    code: 'CONFORMANCE_EVIDENCE_UNAVAILABLE',
    severity: 'error',
    message: `Required capability ${entry.capability} in ${entry.universe} is ${entry.completeness.kind}, below or outside its accepted completeness contract.`,
    profile: profile.manifest.id,
    rule,
    evidence: [],
    inputs: [],
    actual: entry.completeness,
  }
}

function normalizeRules(
  profile: ConformanceProfile,
  values: readonly ConformanceRuleResult[],
): readonly ConformanceRuleResult[] {
  const expected = profile.manifest.rules
  const byRule = new Map(values.map((value) => [value.rule, value]))
  if (
    byRule.size !== values.length ||
    expected.some((rule) => !byRule.has(rule)) ||
    values.some((value) => !expected.includes(value.rule))
  ) {
    throw new Error(`Conformance profile ${profile.manifest.id} returned an undeclared rule set.`)
  }
  return expected.map((rule) => {
    const result = byRule.get(rule)!
    if (
      !validCoverage(result.coverage) ||
      result.diagnostics.some(
        (diagnostic) => diagnostic.profile !== profile.manifest.id || diagnostic.rule !== rule,
      )
    ) {
      throw new Error(`Conformance rule ${profile.manifest.id}/${rule} returned invalid evidence.`)
    }
    return {
      ...result,
      diagnostics: [...result.diagnostics].sort((left, right) =>
        `${left.code}\0${left.subject ?? ''}\0${left.message}`.localeCompare(
          `${right.code}\0${right.subject ?? ''}\0${right.message}`,
        ),
      ),
    }
  })
}

function validCoverage(value: ConformanceRuleResult['coverage']): boolean {
  return [value.forward, value.inverse].every(
    (side) =>
      Number.isSafeInteger(side.matched) &&
      Number.isSafeInteger(side.total) &&
      side.matched >= 0 &&
      side.total >= side.matched,
  )
}

function emptyCoverage(): ConformanceRuleResult['coverage'] {
  return {
    forward: { matched: 0, total: 0 },
    inverse: { matched: 0, total: 0 },
  }
}

function aggregateCoverage(
  rules: readonly ConformanceRuleResult[],
): QualificationProfileResult['coverage'] {
  return rules.reduce(
    (coverage, rule) => ({
      forward: {
        matched: coverage.forward.matched + rule.coverage.forward.matched,
        total: coverage.forward.total + rule.coverage.forward.total,
      },
      inverse: {
        matched: coverage.inverse.matched + rule.coverage.inverse.matched,
        total: coverage.inverse.total + rule.coverage.inverse.total,
      },
    }),
    emptyCoverage(),
  )
}

function aggregate(values: readonly ConformanceStatus[]): ConformanceStatus {
  if (values.includes('error')) return 'error'
  if (values.includes('fail')) return 'fail'
  if (values.includes('indeterminate')) return 'indeterminate'
  return 'pass'
}

function qualificationIdentity(
  snapshot: Omit<QualificationSnapshot, 'id'>,
): QualificationSnapshotId {
  const digest = createHash('sha256')
    .update('astrale.typespec.qualification\0')
    .update(stableJson(snapshot))
    .digest('hex')
  return `qualification:${digest}`
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
  return Object.freeze(value)
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === undefined) return { $undefined: true }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}
