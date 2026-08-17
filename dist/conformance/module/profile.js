import { TYPESCRIPT_MODULE_FACT_NAMESPACE, createTypeScriptFactReader, } from '../../analysis/typescript/index.js';
import { SPECIFICATION_VALIDITY_PROFILE_ID, createSpecificationValidityConformanceProfile, } from '../specification/index.js';
import { createComparisonContext, indexComparisonObservation, } from './comparison/context.js';
import { ModuleEvaluator } from './comparison/evaluator.js';
import { compileModuleContract } from './contract/compiler.js';
import { createModuleLayoutConformanceProfile, } from './layout.js';
import { createModuleTestEvidenceConformanceProfile } from './test-evidence.js';
import { createModuleSchemaConformanceProfile } from './schema.js';
export const MODULE_STRUCTURE_PROFILE_ID = 'contract.module.structure';
export const MODULE_SURFACE_PROFILE_ID = 'contract.module.surface';
export const MODULE_DEPENDENCIES_PROFILE_ID = 'contract.module.dependencies';
const structureRules = ['MODULE-TARGET-PRESENT'];
const surfaceRules = ['MODULE-SURFACE-CONFORMS', 'MODULE-SURFACE-OBSERVABLE'];
const dependencyRules = ['MODULE-DEPENDENCIES-CONFORM'];
/** Establish one unambiguous implementation target before semantic profiles run. */
export function createModuleStructureConformanceProfile() {
    return moduleStructureConformanceProfile(new ModuleEvaluationCache());
}
function moduleStructureConformanceProfile(cache) {
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
            const facts = await cache.collect(context);
            return [targetRule(facts.candidates)];
        },
    };
}
/** Prove the authored API with identity-aware, fine-grained semantic obligations. */
export function createModuleSurfaceConformanceProfile() {
    return moduleSurfaceConformanceProfile(new ModuleEvaluationCache());
}
function moduleSurfaceConformanceProfile(cache) {
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
            const prepared = await cache.prepare(context);
            if (!prepared)
                return surfaceRules.map((rule) => blocked(MODULE_SURFACE_PROFILE_ID, rule));
            if (prepared.compilation.diagnostics.length) {
                return [
                    compilationRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[0], prepared.compilation),
                    emptyRule(surfaceRules[1]),
                ];
            }
            const rules = prepared.evaluator.rules.filter((rule) => profileOf(rule.id, prepared.obligations) === MODULE_SURFACE_PROFILE_ID);
            const relevantIssues = observableIssues(prepared).filter((issue) => !dependencyIssue(issue.code));
            return [
                aggregateRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[0], rules, prepared),
                issueRule(MODULE_SURFACE_PROFILE_ID, surfaceRules[1], relevantIssues, prepared),
            ];
        },
    };
}
/** Prove declared package intent and each portable inbound/outbound dependency occurrence. */
export function createModuleDependenciesConformanceProfile() {
    return moduleDependenciesConformanceProfile(new ModuleEvaluationCache());
}
function moduleDependenciesConformanceProfile(cache) {
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
            const prepared = await cache.prepare(context);
            if (!prepared) {
                return dependencyRules.map((rule) => blocked(MODULE_DEPENDENCIES_PROFILE_ID, rule));
            }
            if (prepared.compilation.diagnostics.length) {
                return [
                    compilationRule(MODULE_DEPENDENCIES_PROFILE_ID, dependencyRules[0], prepared.compilation),
                ];
            }
            const rules = prepared.evaluator.rules.filter((rule) => profileOf(rule.id, prepared.obligations) === MODULE_DEPENDENCIES_PROFILE_ID);
            const issues = observableIssues(prepared).filter((issue) => dependencyIssue(issue.code));
            return [
                aggregateRule(MODULE_DEPENDENCIES_PROFILE_ID, dependencyRules[0], rules, prepared, issues),
            ];
        },
    };
}
export function createModuleConformanceProfiles() {
    const cache = new ModuleEvaluationCache();
    return [
        createSpecificationValidityConformanceProfile(),
        moduleStructureConformanceProfile(cache),
        moduleSurfaceConformanceProfile(cache),
        moduleDependenciesConformanceProfile(cache),
    ];
}
/** Install the complete TypeSpec application profile DAG, including repository observations. */
export function createTypeSpecConformanceProfiles(options = {}) {
    return [
        ...createModuleConformanceProfiles(),
        createModuleLayoutConformanceProfile(options),
        createModuleSchemaConformanceProfile(),
        createModuleTestEvidenceConformanceProfile(),
    ];
}
async function collectModuleFacts(context) {
    const facts = new Map();
    for (const query of context.queries.values()) {
        for await (const fact of createTypeScriptFactReader(query).export('module', {
            kinds: ['module'],
        })) {
            facts.set(fact.id, fact);
        }
    }
    const values = [...facts.values()].sort((left, right) => compare(left.id, right.id));
    return values;
}
async function prepareEvaluation(context, collected) {
    if (collected.candidates.length !== 1)
        return;
    const compilation = compileModuleContract(context.specification);
    const observed = normalizeModule(collected.candidates[0].payload);
    if (!compilation.module) {
        return {
            compilation,
            evaluator: unavailableEvaluator(),
            observed,
            obligations: [],
            evidence: collected.candidates.flatMap((fact) => fact.provenance.evidence),
            inputs: collected.candidates.map((fact) => fact.id),
        };
    }
    const evaluator = new ModuleEvaluator(createComparisonContext(compilation.module, compilation, collected.catalog, collected.comparison), compilation.module, observed);
    evaluator.evaluate();
    return {
        compilation,
        evaluator,
        observed,
        obligations: compilation.module.obligations,
        evidence: collected.candidates.flatMap((fact) => fact.provenance.evidence),
        inputs: collected.candidates.map((fact) => fact.id),
    };
}
class ModuleEvaluationCache {
    #facts = new WeakMap();
    #evaluations = new WeakMap();
    async collect(context) {
        const current = this.#facts.get(context.analysis);
        const collected = current ??
            collectModuleFacts(context).then((facts) => {
                const catalog = {
                    knownModuleIds: [...new Set(facts.map((fact) => fact.subject))].sort(compare),
                    modules: facts.map((fact) => normalizeModule(fact.payload)),
                };
                return { facts, catalog, comparison: indexComparisonObservation(catalog) };
            });
        if (!current)
            this.#facts.set(context.analysis, collected);
        const { facts, catalog, comparison } = await collected;
        return {
            facts,
            catalog,
            comparison,
            candidates: facts.filter((fact) => fact.subject === context.specification.module.id),
        };
    }
    prepare(context) {
        let evaluations = this.#evaluations.get(context.analysis);
        if (!evaluations) {
            evaluations = new Map();
            this.#evaluations.set(context.analysis, evaluations);
        }
        const current = evaluations.get(context.specification.id);
        if (current)
            return current;
        const pending = this.collect(context).then((facts) => prepareEvaluation(context, facts));
        evaluations.set(context.specification.id, pending);
        return pending;
    }
}
function unavailableEvaluator() {
    return { rules: [], identityCoveredDeclarations: new Set() };
}
function normalizeModule(module) {
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
    };
}
function normalizeDependencies(dependencies) {
    return dependencies.flatMap((edge) => {
        const occurrences = [...edge.occurrences].sort((left, right) => compare(left.id, right.id));
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
            : [];
    });
}
function observableIssues(prepared) {
    return prepared.observed.issues.filter((issue) => !issue.declaration || !prepared.evaluator.identityCoveredDeclarations.has(issue.declaration));
}
function targetRule(candidates) {
    const present = candidates.length === 1;
    const absent = candidates.length === 0;
    const issues = candidates.flatMap((fact) => fact.payload.issues.filter((issue) => structureIssue(issue.code)));
    const evidence = candidates.flatMap((fact) => fact.provenance.evidence);
    const inputs = candidates.map((fact) => fact.id);
    const diagnostics = [];
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
        });
    }
    diagnostics.push(...issues.map((issue) => diagnostic(MODULE_STRUCTURE_PROFILE_ID, structureRules[0], issue.code, issue.message, {
        evidence,
        inputs,
        actual: issue,
    })));
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
    };
}
function aggregateRule(profile, rule, values, prepared, issues = []) {
    const forward = values.filter((value) => !value.id.startsWith('observed.') && !value.id.startsWith('typescript.'));
    const inverse = values.filter((value) => value.id.startsWith('observed.'));
    const diagnostics = [
        ...values.flatMap((value) => value.diagnostics.map((entry) => evaluationDiagnostic(profile, rule, value.id, entry, prepared))),
        ...issues.map((issue) => diagnostic(profile, rule, issue.code, issue.message, {
            evidence: prepared.evidence,
            inputs: prepared.inputs,
            subject: issue.declaration,
            actual: issue,
        })),
    ];
    const statuses = [...values.map((value) => value.status), ...(issues.length ? ['error'] : [])];
    return {
        rule,
        status: aggregateStatus(statuses),
        diagnostics,
        coverage: {
            forward: { matched: passing(forward), total: forward.length },
            inverse: { matched: passing(inverse), total: inverse.length },
        },
    };
}
function issueRule(profile, rule, issues, prepared) {
    return {
        rule,
        status: issues.length ? 'error' : 'pass',
        diagnostics: issues.map((issue) => diagnostic(profile, rule, issue.code, issue.message, {
            evidence: prepared.evidence,
            inputs: prepared.inputs,
            subject: issue.declaration,
            actual: issue,
        })),
        coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
    };
}
function compilationRule(profile, rule, compilation) {
    return {
        rule,
        status: 'error',
        diagnostics: compilation.diagnostics.map((entry) => diagnostic(profile, rule, entry.code, entry.message, {
            evidence: [],
            inputs: [],
            specificationPointer: entry.pointer,
            actual: entry,
        })),
        coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
    };
}
function evaluationDiagnostic(profile, rule, obligation, entry, prepared) {
    const location = entry.location;
    return diagnostic(profile, rule, entry.code ?? 'MODULE_CONFORMANCE_FAILED', entry.message, {
        evidence: prepared.evidence,
        inputs: prepared.inputs,
        subject: obligation,
        specificationPointer: location?.pointer,
        expected: entry.expected,
        actual: entry.actual,
        hint: entry.hint,
    });
}
function diagnostic(profile, rule, code, message, details) {
    return { code, severity: 'error', message, profile, rule, ...defined(details) };
}
function blocked(profile, rule) {
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
    };
}
function emptyRule(rule) {
    return {
        rule,
        status: 'error',
        diagnostics: [],
        coverage: { forward: { matched: 0, total: 0 }, inverse: { matched: 0, total: 0 } },
    };
}
function moduleCapability() {
    return {
        capability: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        scope: 'specification-module',
        minimumCompleteness: 'partial',
        acceptedPartialReasonCodes: ['TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL'],
    };
}
function profileOf(id, obligations) {
    if (id.startsWith('observed.dependency.') || id.startsWith('observed.import.')) {
        return MODULE_DEPENDENCIES_PROFILE_ID;
    }
    if (id.startsWith('observed.module.'))
        return MODULE_STRUCTURE_PROFILE_ID;
    if (id.startsWith('observed.'))
        return MODULE_SURFACE_PROFILE_ID;
    const obligation = obligations.find((item) => item.id === id);
    if (obligation?.kind === 'module')
        return MODULE_STRUCTURE_PROFILE_ID;
    if (obligation?.kind === 'package' || obligation?.kind === 'import') {
        return MODULE_DEPENDENCIES_PROFILE_ID;
    }
    return MODULE_SURFACE_PROFILE_ID;
}
function aggregateStatus(statuses) {
    if (statuses.includes('error'))
        return 'error';
    if (statuses.includes('fail'))
        return 'fail';
    if (statuses.includes('idle'))
        return 'indeterminate';
    return 'pass';
}
function passing(rules) {
    return rules.filter((rule) => rule.status === 'pass').length;
}
function dependencyIssue(code) {
    return code.includes('IMPORT') || code.includes('REQUIRE') || code.includes('PACKAGE');
}
function structureIssue(code) {
    return code.includes('ENTRYPOINT') || code.includes('PROJECT') || code.includes('TARGET');
}
function defined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=profile.js.map