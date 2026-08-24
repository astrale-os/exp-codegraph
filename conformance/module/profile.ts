import type {
  ApplicationModuleBindingDiagnostic,
  ApplicationModuleBindingFact,
  Fact,
} from '../../analysis/index.ts'
import type {
  ConformanceDiagnostic,
  ConformanceProfile,
  ConformanceProfileContext,
  ConformanceRuleResult,
  ConformanceStatus,
} from '../model.ts'

import { APPLICATION_BINDING_FACT_NAMESPACE } from '../../analysis/index.ts'
import {
  SPECIFICATION_VALIDITY_PROFILE_ID,
  createSpecificationValidityConformanceProfile,
} from '../specification/index.ts'
import {
  createModuleLayoutConformanceProfile,
  type ModuleLayoutConformanceOptions,
} from './layout.ts'
import { createModuleSchemaConformanceProfile } from './schema.ts'
import { createModuleTestEvidenceConformanceProfile } from './test-evidence.ts'

export const MODULE_STRUCTURE_PROFILE_ID = 'contract.module.structure'
export const MODULE_SURFACE_PROFILE_ID = 'contract.module.surface'
export const MODULE_DEPENDENCIES_PROFILE_ID = 'contract.module.dependencies'

const structureRule = 'MODULE-TARGET-PRESENT'
const surfaceRules = ['MODULE-SURFACE-CONFORMS', 'MODULE-SURFACE-OBSERVABLE'] as const
const dependencyRule = 'MODULE-DEPENDENCIES-CONFORM'

type BindingFact = Fact<ApplicationModuleBindingFact>

/** Establish one unambiguous explicit implementation binding. */
export function createModuleStructureConformanceProfile(): ConformanceProfile {
  return moduleStructureConformanceProfile(new BindingFactCache())
}

function moduleStructureConformanceProfile(cache: BindingFactCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_STRUCTURE_PROFILE_ID,
      version: '3.0.0',
      dependsOn: [SPECIFICATION_VALIDITY_PROFILE_ID],
      requiresCapabilities: [bindingCapability()],
      rules: [structureRule],
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      return [structureResult((await cache.collect(context)).candidates)]
    },
  }
}

/** Prove exact exports and compiler assignability through the explicit binding. */
export function createModuleSurfaceConformanceProfile(): ConformanceProfile {
  return moduleSurfaceConformanceProfile(new BindingFactCache())
}

function moduleSurfaceConformanceProfile(cache: BindingFactCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_SURFACE_PROFILE_ID,
      version: '3.0.0',
      dependsOn: [MODULE_STRUCTURE_PROFILE_ID],
      requiresCapabilities: [bindingCapability()],
      rules: surfaceRules,
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      const candidate = one((await cache.collect(context)).candidates)
      if (!candidate) return surfaceRules.map((rule) => blocked(MODULE_SURFACE_PROFILE_ID, rule))
      const fact = candidate.payload
      const diagnostics = [
        ...fact.diagnostics.filter(
          (diagnostic) => !dependencyDiagnostic(diagnostic.code) && !structureDiagnostic(diagnostic.code),
        ),
        ...missingErrorCodes(context, fact),
      ]
      const authored = fact.exports.filter((entry) => entry.contract.type || entry.contract.value)
      const observed = fact.exports.filter(
        (entry) => entry.implementation.type || entry.implementation.value,
      )
      return [
        result(
          surfaceRules[0],
          diagnostics.length ? statusOf(diagnostics) : 'pass',
          diagnostics.map((diagnostic) => conformanceDiagnostic(
            MODULE_SURFACE_PROFILE_ID,
            surfaceRules[0],
            diagnostic,
            candidate,
          )),
          {
            forward: { matched: authored.filter((entry) => entry.status === 'pass').length, total: authored.length },
            inverse: { matched: observed.filter((entry) => entry.status === 'pass').length, total: observed.length },
          },
        ),
        result(surfaceRules[1], 'pass', [], emptyCoverage()),
      ]
    },
  }
}

/** Prove package intent and every direct compiler-resolved dependency occurrence. */
export function createModuleDependenciesConformanceProfile(): ConformanceProfile {
  return moduleDependenciesConformanceProfile(new BindingFactCache())
}

function moduleDependenciesConformanceProfile(cache: BindingFactCache): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_DEPENDENCIES_PROFILE_ID,
      version: '3.0.0',
      dependsOn: [MODULE_STRUCTURE_PROFILE_ID],
      requiresCapabilities: [bindingCapability()],
      rules: [dependencyRule],
      evaluationScope: 'universe',
    },
    async evaluate(context) {
      const collected = await cache.collect(context)
      const candidate = one(collected.candidates)
      if (!candidate) return [blocked(MODULE_DEPENDENCIES_PROFILE_ID, dependencyRule)]
      const diagnostics = dependencyDiagnostics(context, candidate.payload, collected.facts)
      const expectedPackages = context.specification.module.packageAuthority.packages
      const packageMatches = expectedPackages.filter((expected) =>
        candidate.payload.declaredPackages.includes(expected.package),
      ).length
      const rejectedDependencies = diagnostics.filter(
        (diagnostic) => diagnostic.exportPath?.startsWith('dependency:'),
      ).length
      return [
        result(
          dependencyRule,
          diagnostics.length ? statusOf(diagnostics) : 'pass',
          diagnostics.map((diagnostic) => conformanceDiagnostic(
            MODULE_DEPENDENCIES_PROFILE_ID,
            dependencyRule,
            diagnostic,
            candidate,
          )),
          {
            forward: { matched: packageMatches, total: expectedPackages.length },
            inverse: {
              matched: Math.max(0, candidate.payload.dependencies.length - rejectedDependencies),
              total: candidate.payload.dependencies.length,
            },
          },
        ),
      ]
    },
  }
}

export function createModuleConformanceProfiles(): readonly ConformanceProfile[] {
  const cache = new BindingFactCache()
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

class BindingFactCache {
  readonly #facts = new WeakMap<ConformanceProfileContext['analysis'], Promise<readonly BindingFact[]>>()

  async collect(context: ConformanceProfileContext): Promise<{
    readonly facts: readonly BindingFact[]
    readonly candidates: readonly BindingFact[]
  }> {
    let pending = this.#facts.get(context.analysis)
    if (!pending) {
      pending = collectBindingFacts(context)
      this.#facts.set(context.analysis, pending)
    }
    const facts = await pending
    return {
      facts,
      candidates: facts.filter((fact) => fact.subject === context.specification.module.id),
    }
  }
}

async function collectBindingFacts(
  context: ConformanceProfileContext,
): Promise<readonly BindingFact[]> {
  const facts = new Map<string, BindingFact>()
  for (const query of context.queries.values()) {
    for await (const fact of query.export({ namespaces: [APPLICATION_BINDING_FACT_NAMESPACE] })) {
      if (fact.namespace !== APPLICATION_BINDING_FACT_NAMESPACE || fact.kind !== 'module-binding') continue
      if (!bindingPayload(fact.payload)) continue
      facts.set(fact.id, fact as BindingFact)
    }
  }
  return [...facts.values()].sort((left, right) => compare(left.id, right.id))
}

function bindingPayload(value: unknown): value is ApplicationModuleBindingFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ApplicationModuleBindingFact>
  return Boolean(
    typeof record.specification === 'string' &&
    record.target &&
    typeof record.target.id === 'string' &&
    Array.isArray(record.exports) &&
    Array.isArray(record.dependencies) &&
    Array.isArray(record.declaredPackages) &&
    Array.isArray(record.developmentPackages) &&
    Array.isArray(record.errorCodes) &&
    Array.isArray(record.expectedErrorCodes) &&
    Array.isArray(record.files) &&
    Array.isArray(record.diagnostics),
  )
}

function structureResult(candidates: readonly BindingFact[]): ConformanceRuleResult {
  const present = candidates.length === 1
  const diagnostics = candidates.flatMap((candidate) =>
    candidate.payload.diagnostics
      .filter((diagnostic) => structureDiagnostic(diagnostic.code))
      .map((diagnostic) => conformanceDiagnostic(
        MODULE_STRUCTURE_PROFILE_ID,
        structureRule,
        diagnostic,
        candidate,
      )),
  )
  if (!present) {
    diagnostics.unshift({
      code: candidates.length ? 'MODULE_TARGET_AMBIGUOUS' : 'MODULE_TARGET_MISSING',
      severity: 'error',
      message: candidates.length
        ? `Expected one explicit module binding, found ${candidates.length}.`
        : 'No explicit implementation binding exists for the specification module.',
      profile: MODULE_STRUCTURE_PROFILE_ID,
      rule: structureRule,
      evidence: candidates.flatMap((candidate) => candidate.provenance.evidence),
      inputs: candidates.map((candidate) => candidate.id),
      expected: 1,
      actual: candidates.length,
    })
  }
  return result(
    structureRule,
    present ? (diagnostics.length ? 'error' : 'pass') : candidates.length ? 'fail' : 'indeterminate',
    diagnostics,
    {
      forward: { matched: present ? 1 : 0, total: 1 },
      inverse: { matched: 0, total: Math.max(0, candidates.length - 1) },
    },
  )
}

function missingErrorCodes(
  context: ConformanceProfileContext,
  fact: ApplicationModuleBindingFact,
): ApplicationModuleBindingDiagnostic[] {
  const expected = fact.expectedErrorCodes
  const observed = new Set(fact.errorCodes)
  return expected.flatMap((code) =>
    observed.has(code)
      ? []
      : [{
          code: 'ERROR_CODE_MISSING',
          message: `Error code ${code} has no TypeScript declaration.`,
          file: context.specification.source,
          line: 1,
          column: 1,
          exportPath: `error:${code}`,
          expected: code,
        }],
  )
}

function dependencyDiagnostics(
  context: ConformanceProfileContext,
  fact: ApplicationModuleBindingFact,
  allFacts: readonly BindingFact[],
): ApplicationModuleBindingDiagnostic[] {
  const diagnostics = fact.diagnostics.filter((diagnostic) => dependencyDiagnostic(diagnostic.code))
  const expected = new Set(
    context.specification.module.packageAuthority.packages.map((resource) => resource.package),
  )
  const patterns = context.specification.module.packageAuthority.packagePatterns.map(
    (resource) => resource.pattern,
  )
  const knownModules = new Set(allFacts.map((candidate) => candidate.subject))
  for (const packageName of expected) {
    if (fact.declaredPackages.includes(packageName)) continue
    diagnostics.push(dependencyDiagnosticValue(
      context.specification.source,
      'MODULE_PACKAGE_NOT_DECLARED',
      `Allowlisted package is absent from the code package.json: ${packageName}`,
      `package:${packageName}`,
    ))
  }
  for (const dependency of fact.dependencies) {
    const packageName = dependency.targetModule.startsWith('package:')
      ? dependency.targetModule.slice('package:'.length)
      : undefined
    const permittedPackage = Boolean(
      packageName &&
      (expected.has(packageName) || patterns.some((pattern) => packagePatternMatches(pattern, packageName))),
    )
    const permittedTestPackage = Boolean(
      packageName && isTestArtifact(dependency.sourceFile) && fact.developmentPackages.includes(packageName),
    )
    const permitted =
      !dependency.deep &&
      (dependency.targetModule.startsWith('platform:') ||
        knownModules.has(dependency.targetModule) ||
        permittedPackage ||
        permittedTestPackage)
    if (permitted) continue
    diagnostics.push(dependencyDiagnosticValue(
      dependency.sourceFile,
      dependency.deep
        ? 'MODULE_DEEP_IMPORT'
        : packageName
          ? 'MODULE_PACKAGE_UNDECLARED'
          : 'MODULE_DEPENDENCY_UNOWNED',
      dependency.deep
        ? `Cross-module import bypasses the target entrypoint: ${dependency.specifier}`
        : packageName
          ? `External package is not allowlisted: ${packageName}`
          : `Dependency does not resolve to a declared module, platform, or package: ${dependency.targetModule}`,
      `dependency:${dependency.sourceFile}:${dependency.line}:${dependency.column}:${dependency.specifier}`,
      dependency.line,
      dependency.column,
    ))
  }
  return deduplicateDiagnostics(diagnostics)
}

function dependencyDiagnosticValue(
  file: string,
  code: string,
  message: string,
  exportPath: string,
  line = 1,
  column = 1,
): ApplicationModuleBindingDiagnostic {
  return { code, message, file, line, column, exportPath }
}

function conformanceDiagnostic(
  profile: string,
  rule: string,
  diagnostic: ApplicationModuleBindingDiagnostic,
  fact: BindingFact,
): ConformanceDiagnostic {
  return {
    code: diagnostic.code,
    severity: 'error',
    message: diagnostic.message,
    profile,
    rule,
    ...(diagnostic.exportPath ? { subject: diagnostic.exportPath } : {}),
    evidence: fact.provenance.evidence,
    inputs: [fact.id],
    ...(diagnostic.expected !== undefined ? { expected: diagnostic.expected } : {}),
    ...(diagnostic.actual !== undefined ? { actual: diagnostic.actual } : {}),
  }
}

function blocked(profile: string, rule: string): ConformanceRuleResult {
  return result(
    rule,
    'indeterminate',
    [{
      code: 'MODULE_TARGET_UNAVAILABLE',
      severity: 'error',
      message: 'Module conformance requires one unambiguous explicit binding.',
      profile,
      rule,
      evidence: [],
      inputs: [],
    }],
    emptyCoverage(),
  )
}

function result(
  rule: string,
  status: ConformanceStatus,
  diagnostics: readonly ConformanceDiagnostic[],
  coverage: ConformanceRuleResult['coverage'],
): ConformanceRuleResult {
  return { rule, status, diagnostics, coverage }
}

function one(values: readonly BindingFact[]): BindingFact | undefined {
  return values.length === 1 ? values[0] : undefined
}

function bindingCapability() {
  return {
    capability: APPLICATION_BINDING_FACT_NAMESPACE,
    scope: 'specification-module' as const,
    minimumCompleteness: 'complete' as const,
  }
}

function statusOf(diagnostics: readonly ApplicationModuleBindingDiagnostic[]): ConformanceStatus {
  return diagnostics.some((diagnostic) => diagnostic.code.startsWith('TYPESCRIPT_')) ? 'error' : 'fail'
}

function dependencyDiagnostic(code: string): boolean {
  return code.includes('IMPORT') || code.includes('REQUIRE') || code.includes('PACKAGE') || code.includes('DEPENDENCY')
}

function structureDiagnostic(code: string): boolean {
  return code.includes('ENTRYPOINT') || code.includes('PROJECT') || code.includes('TARGET')
}

function packagePatternMatches(pattern: string, packageName: string): boolean {
  return pattern.endsWith('*') && packageName.startsWith(pattern.slice(0, -1))
}

function isTestArtifact(path: string): boolean {
  return /(?:^|\/)(?:__tests__|test|tests|fixtures?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
}

function deduplicateDiagnostics(
  values: readonly ApplicationModuleBindingDiagnostic[],
): ApplicationModuleBindingDiagnostic[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()].sort(
    (left, right) => compare(JSON.stringify(left), JSON.stringify(right)),
  )
}

function emptyCoverage(): ConformanceRuleResult['coverage'] {
  return { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
