import type {
  TypeScriptFact,
  TypeScriptDependencyFact,
  TypeScriptModuleFact,
} from '../../analysis/typescript/index.ts'
import type {
  ConformanceDiagnostic,
  ConformanceProfile,
  ConformanceProfileContext,
  ConformanceRuleResult,
  ConformanceStatus,
} from '../model.ts'
import type {
  EvaluationDiagnostic,
  EvaluationRule,
  NormalizedDependency,
  NormalizedModule,
  NormalizedModuleCatalog,
} from './comparison/model.ts'
import type { ModuleCompilation, ProofObligation } from './contract/model.ts'

import {
  TYPESCRIPT_MODULE_FACT_NAMESPACE,
  createTypeScriptFactReader,
} from '../../analysis/typescript/index.ts'
import {
  SPECIFICATION_VALIDITY_PROFILE_ID,
  createSpecificationValidityConformanceProfile,
} from '../specification/index.ts'
import {
  createComparisonContext,
  indexComparisonObservation,
  type ObservedComparisonIndex,
} from './comparison/context.ts'
import { ModuleEvaluator } from './comparison/evaluator.ts'
import { compileModuleContract } from './contract/compiler.ts'
import {
  createModuleLayoutConformanceProfile,
  type ModuleLayoutConformanceOptions,
} from './layout.ts'
import { createModuleTestEvidenceConformanceProfile } from './test-evidence.ts'
import { createModuleSchemaConformanceProfile } from './schema.ts'

export const MODULE_STRUCTURE_PROFILE_ID = 'contract.module.structure'
export const MODULE_SURFACE_PROFILE_ID = 'contract.module.surface'
export const MODULE_DEPENDENCIES_PROFILE_ID = 'contract.module.dependencies'

const structureRules = ['MODULE-TARGET-PRESENT'] as const
const surfaceRules = ['MODULE-SURFACE-CONFORMS', 'MODULE-SURFACE-OBSERVABLE'] as const
const dependencyRules = ['MODULE-DEPENDENCIES-CONFORM'] as const

/** Establish one unambiguous implementation target before semantic profiles run. */
export function createModuleStructureConformanceProfile(): ConformanceProfile {
  return moduleStructureConformanceProfile(new ModuleEvaluationCache())
}

function moduleStructureConformanceProfile(cache: ModuleEvaluationCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_STRUCTURE_PROFILE_ID,
      version: '2.0.0',
      dependsOn: [SPECIFICATION_VALIDITY_PROFILE_ID],
      requiresCapabilities: [moduleCapability()],
      rules: structureRules,
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      const facts = await cache.collect(context)
      return [targetRule(facts.candidates)]
    },
  }
}

/** Prove the authored API with identity-aware, fine-grained semantic obligations. */
export function createModuleSurfaceConformanceProfile(): ConformanceProfile {
  return moduleSurfaceConformanceProfile(new ModuleEvaluationCache())
}

function moduleSurfaceConformanceProfile(cache: ModuleEvaluationCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_SURFACE_PROFILE_ID,
      version: '2.0.0',
      dependsOn: [MODULE_STRUCTURE_PROFILE_ID],
      requiresCapabilities: [moduleCapability()],
      rules: surfaceRules,
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      const prepared = await cache.prepare(context)
      if (!prepared) return surfaceRules.map((rule) => blocked(MODULE_SURFACE_PROFILE_ID, rule))
      if (prepared.compilation.diagnostics.length) {
        return [
          compilationRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[0], prepared.compilation),
          emptyRule(surfaceRules[1]),
        ]
      }
      const rules = prepared.evaluator.rules.filter(
        (rule) => profileOf(rule.id, prepared.obligations) === MODULE_SURFACE_PROFILE_ID,
      )
      const relevantIssues = observableIssues(prepared).filter(
        (issue) => !dependencyIssue(issue.code),
      )
      return [
        aggregateRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[0], rules, prepared),
        issueRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[1], relevantIssues, prepared),
      ]
    },
  }
}

/** Prove declared package intent and each portable inbound/outbound dependency occurrence. */
export function createModuleDependenciesConformanceProfile(): ConformanceProfile {
  return moduleDependenciesConformanceProfile(new ModuleEvaluationCache())
}

function moduleDependenciesConformanceProfile(cache: ModuleEvaluationCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_DEPENDENCIES_PROFILE_ID,
      version: '2.0.0',
      dependsOn: [MODULE_STRUCTURE_PROFILE_ID],
      requiresCapabilities: [moduleCapability()],
      rules: dependencyRules,
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      const prepared = await cache.prepare(context)
      if (!prepared) {
        return dependencyRules.map((rule) => blocked(MODULE_DEPENDENCIES_PROFILE_ID, rule))
      }
      if (prepared.compilation.diagnostics.length) {
        return [
          compilationRule(MODULE_DEPENDENCIES_PROFILE_ID, dependencyRules[0], prepared.compilation),
        ]
      }
      const rules = prepared.evaluator.rules.filter(
        (rule) => profileOf(rule.id, prepared.obligations) === MODULE_DEPENDENCIES_PROFILE_ID,
      )
      const issues = observableIssues(prepared).filter((issue) => dependencyIssue(issue.code))
      return [
        aggregateRule(MODULE_DEPENDENCIES_PROFILE_ID, dependencyRules[0], rules, prepared, issues),
      ]
    },
  }
}

export function createModuleConformanceProfiles(): readonly ConformanceProfile[] {
  const cache = new ModuleEvaluationCache()
  return [
    createSpecificationValidityConformanceProfile(),
    moduleStructureConformanceProfile(cache),
    moduleSurfaceConformanceProfile(cache),
    moduleDependenciesConformanceProfile(cache),
  ]
}

/** Install the complete TypeSpec application profile DAG, including repository observations. */
export function createTypeSpecConformanceProfiles(
  options: ModuleLayoutConformanceOptions = {},
): readonly ConformanceProfile[] {
  return [
    ...createModuleConformanceProfiles(),
    createModuleLayoutConformanceProfile(options),
    createModuleSchemaConformanceProfile(),
    createModuleTestEvidenceConformanceProfile(),
  ]
}

interface CollectedFacts {
  readonly candidates: readonly TypeScriptFact<'module'>[]
  readonly facts: readonly TypeScriptFact<'module'>[]
  readonly catalog: NormalizedModuleCatalog
  readonly comparison: ObservedComparisonIndex
}

interface CollectedCatalog {
  readonly facts: readonly TypeScriptFact<'module'>[]
  readonly catalog: NormalizedModuleCatalog
  readonly comparison: ObservedComparisonIndex
}

interface PreparedEvaluation {
  readonly compilation: ModuleCompilation
  readonly evaluator: EvaluationResult
  readonly observed: NormalizedModule
  readonly obligations: readonly ProofObligation[]
  readonly evidence: ConformanceDiagnostic['evidence']
  readonly inputs: ConformanceDiagnostic['inputs']
}

interface EvaluationResult {
  readonly rules: readonly EvaluationRule[]
  readonly identityCoveredDeclarations: ReadonlySet<string>
}

async function collectModuleFacts(
  context: ConformanceProfileContext,
): Promise<readonly TypeScriptFact<'module'>[]> {
  const facts = new Map<string, TypeScriptFact<'module'>>()
  for (const query of context.queries.values()) {
    for await (const fact of createTypeScriptFactReader(query).export('module', {
      kinds: ['module'],
    })) {
      facts.set(fact.id, fact)
    }
  }
  const values = [...facts.values()].sort((left, right) => compare(left.id, right.id))
  return values
}

async function prepareEvaluation(
  context: ConformanceProfileContext,
  collected: CollectedFacts,
): Promise<PreparedEvaluation | undefined> {
  if (collected.candidates.length !== 1) return
  const compilation = compileModuleContract(context.specification)
  const observed = normalizeModule(collected.candidates[0]!.payload)
  if (!compilation.module) {
    return {
      compilation,
      evaluator: unavailableEvaluator(),
      observed,
      obligations: [],
      evidence: collected.candidates.flatMap((fact) => fact.provenance.evidence),
      inputs: collected.candidates.map((fact) => fact.id),
    }
  }
  const evaluator = new ModuleEvaluator(
    createComparisonContext(
      compilation.module,
      compilation,
      collected.catalog,
      collected.comparison,
    ),
    compilation.module,
    observed,
  )
  evaluator.evaluate()
  return {
    compilation,
    evaluator,
    observed,
    obligations: compilation.module.obligations,
    evidence: collected.candidates.flatMap((fact) => fact.provenance.evidence),
    inputs: collected.candidates.map((fact) => fact.id),
  }
}

class ModuleEvaluationCache {
  readonly #facts = new WeakMap<ConformanceProfileContext['analysis'], Promise<CollectedCatalog>>()
  readonly #evaluations = new WeakMap<
    ConformanceProfileContext['analysis'],
    Map<string, Promise<PreparedEvaluation | undefined>>
  >()

  async collect(context: ConformanceProfileContext): Promise<CollectedFacts> {
    const current = this.#facts.get(context.analysis)
    const collected =
      current ??
      collectModuleFacts(context).then((facts) => {
        const catalog = {
          knownModuleIds: [...new Set(facts.map((fact) => fact.subject))].sort(compare),
          modules: facts.map((fact) => normalizeModule(fact.payload)),
        }
        return { facts, catalog, comparison: indexComparisonObservation(catalog) }
      })
    if (!current) this.#facts.set(context.analysis, collected)
    const { facts, catalog, comparison } = await collected
    return {
      facts,
      catalog,
      comparison,
      candidates: facts.filter((fact) => fact.subject === context.specification.module.id),
    }
  }

  prepare(context: ConformanceProfileContext): Promise<PreparedEvaluation | undefined> {
    let evaluations = this.#evaluations.get(context.analysis)
    if (!evaluations) {
      evaluations = new Map()
      this.#evaluations.set(context.analysis, evaluations)
    }
    const current = evaluations.get(context.specification.id)
    if (current) return current
    const pending = this.collect(context).then((facts) => prepareEvaluation(context, facts))
    evaluations.set(context.specification.id, pending)
    return pending
  }
}

function unavailableEvaluator(): EvaluationResult {
  return { rules: [], identityCoveredDeclarations: new Set() }
}

function normalizeModule(module: TypeScriptModuleFact): NormalizedModule {
  return {
    id: module.target.id,
    name: module.target.name,
    target: module.target,
    exports: module.exports,
    declarations: module.declarations,
    dependencies: normalizeDependencies(module.dependencies),
    inboundDependencies: normalizeDependencies(module.inboundDependencies),
    declaredPackages: module.declaredPackages,
    developmentPackages: module.developmentPackages,
    workspacePackages: module.workspacePackages,
    errorCodes: module.errorCodes,
    issues: module.issues,
  }
}

function normalizeDependencies(
  dependencies: readonly TypeScriptDependencyFact[],
): readonly NormalizedDependency[] {
  return dependencies.flatMap((edge) => {
    const occurrences = [...edge.occurrences].sort((left, right) => compare(left.id, right.id))
    return occurrences.length
      ? [
          {
            id: edge.id,
            sourceModule: edge.sourceModule,
            targetModule: edge.targetModule,
            kind: edge.kind,
            sourceFile: edge.sourceFile,
            targetFile: edge.targetFile,
            occurrences,
          },
        ]
      : []
  })
}

function observableIssues(prepared: PreparedEvaluation): TypeScriptModuleFact['issues'] {
  return prepared.observed.issues.filter(
    (issue) =>
      !issue.declaration || !prepared.evaluator.identityCoveredDeclarations.has(issue.declaration),
  )
}

function targetRule(candidates: readonly TypeScriptFact<'module'>[]): ConformanceRuleResult {
  const present = candidates.length === 1
  const absent = candidates.length === 0
  const issues = candidates.flatMap((fact) =>
    fact.payload.issues.filter((issue) => structureIssue(issue.code)),
  )
  const evidence = candidates.flatMap((fact) => fact.provenance.evidence)
  const inputs = candidates.map((fact) => fact.id)
  const diagnostics: ConformanceDiagnostic[] = []
  if (!present) {
    diagnostics.push({
      code: candidates.length ? 'MODULE_TARGET_AMBIGUOUS' : 'MODULE_TARGET_MISSING',
      severity: 'error',
      message: candidates.length
        ? `Expected one complete module observation, found ${candidates.length}.`
        : 'No complete module observation exists for the specification module.',
      profile: MODULE_STRUCTURE_PROFILE_ID,
      rule: structureRules[0],
      evidence,
      inputs,
      expected: 1,
      actual: candidates.length,
    })
  }
  diagnostics.push(
    ...issues.map((issue) =>
      diagnostic(MODULE_STRUCTURE_PROFILE_ID, structureRules[0], issue.code, issue.message, {
        evidence,
        inputs,
        actual: issue,
      }),
    ),
  )
  return {
    rule: structureRules[0],
    // A complete project capability does not prove that a convention-bound
    // implementation target exists for every authored semantic module. Private
    // leaf specifications deliberately have no barrel in some hierarchies, and
    // absence of a fact must remain epistemically unavailable rather than being
    // fabricated into a mismatch. Ambiguous positive observations are a real
    // conformance failure; no observation is indeterminate and may be elevated
    // by the invoking gate's policy.
    status: present ? (issues.length ? 'error' : 'pass') : absent ? 'indeterminate' : 'fail',
    diagnostics,
    coverage: {
      forward: { matched: present ? 1 : 0, total: 1 },
      inverse: { matched: 0, total: Math.max(0, candidates.length - 1) },
    },
  }
}

function aggregateRule(
  profile: string,
  rule: string,
  values: readonly EvaluationRule[],
  prepared: PreparedEvaluation,
  issues: TypeScriptModuleFact['issues'] = [],
): ConformanceRuleResult {
  const forward = values.filter(
    (value) => !value.id.startsWith('observed.') && !value.id.startsWith('typescript.'),
  )
  const inverse = values.filter((value) => value.id.startsWith('observed.'))
  const diagnostics = [
    ...values.flatMap((value) =>
      value.diagnostics.map((entry) =>
        evaluationDiagnostic(profile, rule, value.id, entry, prepared),
      ),
    ),
    ...issues.map((issue) =>
      diagnostic(profile, rule, issue.code, issue.message, {
        evidence: prepared.evidence,
        inputs: prepared.inputs,
        subject: issue.declaration,
        actual: issue,
      }),
    ),
  ]
  const statuses = [...values.map((value) => value.status), ...(issues.length ? ['error'] : [])]
  return {
    rule,
    status: aggregateStatus(statuses),
    diagnostics,
    coverage: {
      forward: { matched: passing(forward), total: forward.length },
      inverse: { matched: passing(inverse), total: inverse.length },
    },
  }
}

function issueRule(
  profile: string,
  rule: string,
  issues: TypeScriptModuleFact['issues'],
  prepared: PreparedEvaluation,
): ConformanceRuleResult {
  return {
    rule,
    status: issues.length ? 'error' : 'pass',
    diagnostics: issues.map((issue) =>
      diagnostic(profile, rule, issue.code, issue.message, {
        evidence: prepared.evidence,
        inputs: prepared.inputs,
        subject: issue.declaration,
        actual: issue,
      }),
    ),
    coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
  }
}

function compilationRule(
  profile: string,
  rule: string,
  compilation: ModuleCompilation,
): ConformanceRuleResult {
  return {
    rule,
    status: 'error',
    diagnostics: compilation.diagnostics.map((entry) =>
      diagnostic(profile, rule, entry.code, entry.message, {
        evidence: [],
        inputs: [],
        specificationPointer: entry.pointer,
        actual: entry,
      }),
    ),
    coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
  }
}

function evaluationDiagnostic(
  profile: string,
  rule: string,
  obligation: string,
  entry: EvaluationDiagnostic,
  prepared: PreparedEvaluation,
): ConformanceDiagnostic {
  const location = entry.location
  return diagnostic(profile, rule, entry.code ?? 'MODULE_CONFORMANCE_FAILED', entry.message, {
    evidence: prepared.evidence,
    inputs: prepared.inputs,
    subject: obligation,
    specificationPointer: location?.pointer,
    expected: entry.expected,
    actual: entry.actual,
    hint: entry.hint,
  })
}

function diagnostic(
  profile: string,
  rule: string,
  code: string,
  message: string,
  details: Pick<
    ConformanceDiagnostic,
    'evidence' | 'inputs' | 'subject' | 'specificationPointer' | 'expected' | 'actual' | 'hint'
  >,
): ConformanceDiagnostic {
  return { code, severity: 'error', message, profile, rule, ...defined(details) }
}

function blocked(profile: string, rule: string): ConformanceRuleResult {
  return {
    rule,
    status: 'indeterminate',
    diagnostics: [
      {
        code: 'MODULE_TARGET_UNAVAILABLE',
        severity: 'error',
        message: 'Module comparison requires one unambiguous observed target.',
        profile,
        rule,
        evidence: [],
        inputs: [],
      },
    ],
    coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
  }
}

function emptyRule(rule: string): ConformanceRuleResult {
  return {
    rule,
    status: 'error',
    diagnostics: [],
    coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
  }
}

function moduleCapability() {
  return {
    capability: TYPESCRIPT_MODULE_FACT_NAMESPACE,
    scope: 'specification-module' as const,
    minimumCompleteness: 'partial' as const,
    acceptedPartialReasonCodes: ['TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL'],
  }
}

function profileOf(id: string, obligations: readonly ProofObligation[]): string {
  if (id.startsWith('observed.dependency.') || id.startsWith('observed.import.')) {
    return MODULE_DEPENDENCIES_PROFILE_ID
  }
  if (id.startsWith('observed.module.')) return MODULE_STRUCTURE_PROFILE_ID
  if (id.startsWith('observed.')) return MODULE_SURFACE_PROFILE_ID
  const obligation = obligations.find((item) => item.id === id)
  if (obligation?.kind === 'module') return MODULE_STRUCTURE_PROFILE_ID
  if (obligation?.kind === 'package' || obligation?.kind === 'import') {
    return MODULE_DEPENDENCIES_PROFILE_ID
  }
  return MODULE_SURFACE_PROFILE_ID
}

function aggregateStatus(statuses: readonly string[]): ConformanceStatus {
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('idle')) return 'indeterminate'
  return 'pass'
}

function passing(rules: readonly EvaluationRule[]): number {
  return rules.filter((rule) => rule.status === 'pass').length
}

function dependencyIssue(code: string): boolean {
  return code.includes('IMPORT') || code.includes('REQUIRE') || code.includes('PACKAGE')
}

function structureIssue(code: string): boolean {
  return code.includes('ENTRYPOINT') || code.includes('PROJECT') || code.includes('TARGET')
}

function defined<Value extends Record<string, unknown>>(value: Value): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Value
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
