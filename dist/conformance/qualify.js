import { createHash } from 'node:crypto';
import { planConformance } from './plan.js';
/** Compare one immutable specification with one exact, generation-pinned analysis snapshot set. */
export async function qualifySpecification(options) {
    const [qualification] = await qualifySpecifications({
        specifications: [options.specification],
        analysis: options.analysis,
        profiles: options.profiles,
        ...(options.requestedProfiles ? { requestedProfiles: options.requestedProfiles } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!qualification)
        throw new Error('Single-specification qualification returned no result.');
    return qualification;
}
/** Qualify one corpus while leasing every pinned universe and capability view exactly once. */
export async function qualifySpecifications(options) {
    options.signal?.throwIfAborted();
    const plan = planConformance(options.profiles, options.requestedProfiles);
    const queries = new Map();
    try {
        for (const universe of options.analysis.universes) {
            options.signal?.throwIfAborted();
            queries.set(universe, await options.analysis.query(universe));
        }
        const capabilityByUniverse = new Map();
        for (const [universe, query] of queries) {
            capabilityByUniverse.set(universe, new Map((await query.capabilities()).map((entry) => [entry.capability, entry.completeness])));
        }
        const qualifications = [];
        for (const specification of options.specifications) {
            options.signal?.throwIfAborted();
            qualifications.push(await qualifyPreparedSpecification(specification, options, plan, queries, capabilityByUniverse));
        }
        return qualifications;
    }
    finally {
        await Promise.all([...queries.values()].map((query) => query.dispose()));
    }
}
async function qualifyPreparedSpecification(specification, options, plan, queries, capabilityByUniverse) {
    const results = new Map();
    for (const profile of plan.ordered) {
        options.signal?.throwIfAborted();
        const evidenceCompleteness = await requiredEvidence(profile, specification.module.id, options.analysis.universes, capabilityByUniverse, queries);
        const unavailable = evidenceCompleteness.filter((entry) => !evidenceSatisfies(entry));
        let rules;
        if (unavailable.length) {
            rules = profile.manifest.rules.map((rule) => ({
                rule,
                status: 'indeterminate',
                diagnostics: unavailable.map((entry) => unavailableDiagnostic(profile, rule, entry)),
                coverage: emptyCoverage(),
            }));
        }
        else {
            try {
                rules = normalizeRules(profile, await profile.evaluate({
                    specification,
                    analysis: options.analysis,
                    queries,
                    dependencyResults: results,
                    ...(options.signal ? { signal: options.signal } : {}),
                }));
                options.signal?.throwIfAborted();
            }
            catch (error) {
                if (options.signal?.aborted)
                    options.signal.throwIfAborted();
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
                }));
            }
        }
        results.set(profile.manifest.id, {
            id: profile.manifest.id,
            version: profile.manifest.version,
            status: aggregate(rules.map((rule) => rule.status)),
            rules,
            coverage: aggregateCoverage(rules),
            evidenceCompleteness,
        });
    }
    const profiles = plan.ordered.map((profile) => results.get(profile.manifest.id));
    const compiled = {
        format: 'astrale.typespec.qualification',
        version: 2,
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
    };
    const id = qualificationIdentity(compiled);
    return immutable({ ...compiled, id });
}
async function requiredEvidence(profile, specificationModule, universes, capabilities, queries) {
    const values = (await Promise.all(profile.manifest.requiresCapabilities.map((requirement) => requirementEvidence(requirement, specificationModule, universes, capabilities, queries)))).flat();
    return values.sort((left, right) => `${left.universe}\0${left.capability}`.localeCompare(`${right.universe}\0${right.capability}`));
}
async function requirementEvidence(requirement, specificationModule, universes, capabilities, queries) {
    const targets = requirement.universes ?? universes;
    if ((requirement.scope ?? 'universe') === 'universe') {
        return targets.map((universe) => evidenceEntry(universe, requirement, capabilities.get(universe)?.get(requirement.capability) ??
            capabilityMissing(requirement.capability, universe)));
    }
    const candidates = await Promise.all(targets.map(async (universe) => {
        const query = queries.get(universe);
        const facts = query
            ? (await query.facts({ namespaces: [requirement.capability], subjects: [specificationModule] }, { limit: 10_000 })).facts
            : [];
        return { universe, facts };
    }));
    const present = candidates
        .filter((candidate) => candidate.facts.length)
        .map((candidate) => evidenceEntry(candidate.universe, requirement, combineCompleteness(candidate.facts.map((fact) => fact.completeness))));
    if (requirement.universes) {
        return candidates.map((candidate) => candidate.facts.length
            ? present.find((entry) => entry.universe === candidate.universe)
            : evidenceEntry(candidate.universe, requirement, capabilities.get(candidate.universe)?.get(requirement.capability) ??
                capabilityMissing(requirement.capability, candidate.universe)));
    }
    if (present.length)
        return present;
    if (!targets.length)
        throw new Error('Conformance requires at least one analysis universe.');
    return targets.map((universe) => evidenceEntry(universe, requirement, capabilities.get(universe)?.get(requirement.capability) ??
        capabilityMissing(requirement.capability, universe)));
}
function evidenceEntry(universe, requirement, completeness) {
    return {
        universe,
        capability: requirement.capability,
        completeness,
        minimumCompleteness: requirement.minimumCompleteness ?? 'complete',
        ...(requirement.acceptedPartialReasonCodes
            ? { acceptedPartialReasonCodes: [...requirement.acceptedPartialReasonCodes] }
            : {}),
    };
}
function evidenceSatisfies(entry) {
    if (entry.completeness.kind === 'complete')
        return true;
    if (entry.completeness.kind === 'unavailable' || entry.minimumCompleteness === 'complete') {
        return false;
    }
    const accepted = entry.acceptedPartialReasonCodes;
    return accepted === undefined || entry.completeness.reasons.every((reason) => accepted.includes(reason.code));
}
function capabilityMissing(capability, universe) {
    return {
        kind: 'unavailable',
        reasons: [
            {
                code: 'CONFORMANCE_CAPABILITY_MISSING',
                message: `Required capability ${capability} is missing from ${universe}.`,
                retryable: false,
            },
        ],
    };
}
function combineCompleteness(values) {
    const unavailable = values.filter((value) => value.kind === 'unavailable');
    if (unavailable.length) {
        return { kind: 'unavailable', reasons: unavailable.flatMap((value) => value.reasons) };
    }
    const partial = values.filter((value) => value.kind === 'partial');
    return partial.length
        ? { kind: 'partial', reasons: partial.flatMap((value) => value.reasons) }
        : { kind: 'complete' };
}
function unavailableDiagnostic(profile, rule, entry) {
    return {
        code: 'CONFORMANCE_EVIDENCE_UNAVAILABLE',
        severity: 'error',
        message: `Required capability ${entry.capability} in ${entry.universe} is ${entry.completeness.kind}, below or outside its accepted completeness contract.`,
        profile: profile.manifest.id,
        rule,
        evidence: [],
        inputs: [],
        actual: entry.completeness,
    };
}
function normalizeRules(profile, values) {
    const expected = profile.manifest.rules;
    const byRule = new Map(values.map((value) => [value.rule, value]));
    if (byRule.size !== values.length ||
        expected.some((rule) => !byRule.has(rule)) ||
        values.some((value) => !expected.includes(value.rule))) {
        throw new Error(`Conformance profile ${profile.manifest.id} returned an undeclared rule set.`);
    }
    return expected.map((rule) => {
        const result = byRule.get(rule);
        if (!validCoverage(result.coverage) ||
            result.diagnostics.some((diagnostic) => diagnostic.profile !== profile.manifest.id || diagnostic.rule !== rule)) {
            throw new Error(`Conformance rule ${profile.manifest.id}/${rule} returned invalid evidence.`);
        }
        return {
            ...result,
            diagnostics: [...result.diagnostics].sort((left, right) => `${left.code}\0${left.subject ?? ''}\0${left.message}`.localeCompare(`${right.code}\0${right.subject ?? ''}\0${right.message}`)),
        };
    });
}
function validCoverage(value) {
    return [value.forward, value.inverse].every((side) => Number.isSafeInteger(side.matched) &&
        Number.isSafeInteger(side.total) &&
        side.matched >= 0 &&
        side.total >= side.matched);
}
function emptyCoverage() {
    return {
        forward: { matched: 0, total: 0 },
        inverse: { matched: 0, total: 0 },
    };
}
function aggregateCoverage(rules) {
    return rules.reduce((coverage, rule) => ({
        forward: {
            matched: coverage.forward.matched + rule.coverage.forward.matched,
            total: coverage.forward.total + rule.coverage.forward.total,
        },
        inverse: {
            matched: coverage.inverse.matched + rule.coverage.inverse.matched,
            total: coverage.inverse.total + rule.coverage.inverse.total,
        },
    }), emptyCoverage());
}
function aggregate(values) {
    if (values.includes('error'))
        return 'error';
    if (values.includes('fail'))
        return 'fail';
    if (values.includes('indeterminate'))
        return 'indeterminate';
    return 'pass';
}
function qualificationIdentity(snapshot) {
    const digest = createHash('sha256')
        .update('astrale.typespec.qualification\0')
        .update(stableJson(snapshot))
        .digest('hex');
    return `qualification:${digest}`;
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
function stableJson(value) {
    return JSON.stringify(canonical(value));
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value === undefined)
        return { $undefined: true };
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
//# sourceMappingURL=qualify.js.map