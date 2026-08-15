/** Evaluate installed policy code over one immutable pinned query without a store or commit port. */
export async function runAnalysisPolicies(options) {
    options.signal?.throwIfAborted();
    const capabilities = new Map((await options.query.capabilities()).map((status) => [status.capability, status.completeness]));
    const schemas = new Map((await options.query.manifest()).map((reference) => [reference.namespace, reference.schemaVersion]));
    const policies = [];
    const seen = new Set();
    for (const policy of [...options.policies].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))) {
        options.signal?.throwIfAborted();
        validateManifest(policy.manifest, seen);
        const unavailable = unavailableEvidence(policy, capabilities, schemas);
        let rules;
        if (unavailable.length) {
            rules = policy.manifest.rules.map((rule) => ({
                rule,
                status: 'indeterminate',
                diagnostics: unavailable.map((reason) => ({
                    code: 'POLICY_EVIDENCE_UNAVAILABLE',
                    severity: 'error',
                    message: reason,
                    rule,
                    evidence: [],
                    inputs: [],
                })),
                matched: 0,
                total: 0,
            }));
        }
        else {
            try {
                rules = normalizeRules(policy.manifest.rules, await policy.evaluate({
                    query: options.query,
                    capability: (capability) => capabilities.get(capability),
                    ...(options.signal ? { signal: options.signal } : {}),
                }), Boolean(policy.manifest.scopedCapabilities?.length));
                options.signal?.throwIfAborted();
            }
            catch (error) {
                if (options.signal?.aborted)
                    options.signal.throwIfAborted();
                rules = policy.manifest.rules.map((rule) => ({
                    rule,
                    status: 'error',
                    diagnostics: [
                        {
                            code: 'POLICY_EVALUATION_FAILED',
                            severity: 'error',
                            message: error instanceof Error ? error.message : String(error),
                            rule,
                            evidence: [],
                            inputs: [],
                        },
                    ],
                    matched: 0,
                    total: 0,
                }));
            }
        }
        policies.push({
            policy: policy.manifest.id,
            version: policy.manifest.version,
            status: aggregate(rules.map((rule) => rule.status)),
            rules,
        });
    }
    return immutable({ generation: options.query.generation, policies });
}
function unavailableEvidence(policy, capabilities, schemas) {
    const reasons = [];
    for (const capability of policy.manifest.requiresCapabilities) {
        const completeness = capabilities.get(capability);
        if (!completeness || completeness.kind !== 'complete') {
            reasons.push(`Required capability ${capability} is ${completeness?.kind ?? 'missing'}.`);
        }
    }
    for (const capability of policy.manifest.scopedCapabilities ?? []) {
        const completeness = capabilities.get(capability);
        if (!completeness || completeness.kind === 'unavailable') {
            reasons.push(`Scoped capability ${capability} is ${completeness?.kind ?? 'missing'}.`);
        }
    }
    for (const input of policy.manifest.inputs) {
        const version = schemas.get(input.namespace);
        if (version === undefined ||
            version < input.minimumVersion ||
            version > input.maximumVersion) {
            reasons.push(`Required schema ${input.namespace}@${input.minimumVersion}-${input.maximumVersion} is ${version ?? 'missing'}.`);
        }
    }
    return reasons.sort();
}
function validateManifest(manifest, seen) {
    if (seen.has(manifest.id))
        throw new Error(`Policy ${manifest.id} is installed more than once.`);
    seen.add(manifest.id);
    if (!manifest.version || !manifest.rules.length || new Set(manifest.rules).size !== manifest.rules.length) {
        throw new Error(`Policy ${manifest.id} has an invalid manifest.`);
    }
    const overlap = manifest.scopedCapabilities?.filter((capability) => manifest.requiresCapabilities.includes(capability)) ?? [];
    if (overlap.length ||
        new Set(manifest.scopedCapabilities ?? []).size !==
            (manifest.scopedCapabilities?.length ?? 0)) {
        throw new Error(`Policy ${manifest.id} has invalid scoped capability requirements.`);
    }
}
function normalizeRules(expected, actual, scopedEvidence) {
    const byRule = new Map(actual.map((result) => [result.rule, result]));
    if (byRule.size !== actual.length || expected.some((rule) => !byRule.has(rule)) || actual.some((rule) => !expected.includes(rule.rule))) {
        throw new Error('Policy output does not exactly match its declared rule set.');
    }
    return expected.map((rule) => {
        const result = byRule.get(rule);
        if (!Number.isSafeInteger(result.matched) ||
            !Number.isSafeInteger(result.total) ||
            result.matched < 0 ||
            result.total < result.matched ||
            result.diagnostics.some((diagnostic) => diagnostic.rule !== rule)) {
            throw new Error(`Policy rule ${rule} returned invalid coverage or diagnostics.`);
        }
        if (scopedEvidence) {
            if (!result.evidenceCompleteness) {
                throw new Error(`Policy rule ${rule} omitted scoped evidence completeness.`);
            }
            if (result.evidenceCompleteness.kind !== 'complete' && result.status !== 'indeterminate') {
                throw new Error(`Policy rule ${rule} claimed ${result.status} from incomplete scoped evidence.`);
            }
        }
        return {
            ...result,
            diagnostics: [...result.diagnostics].sort((left, right) => `${left.code}\0${left.subject ?? ''}\0${left.message}`.localeCompare(`${right.code}\0${right.subject ?? ''}\0${right.message}`)),
        };
    });
}
function aggregate(values) {
    if (values.includes('error'))
        return 'error';
    if (values.includes('indeterminate'))
        return 'indeterminate';
    if (values.includes('fail'))
        return 'fail';
    return 'pass';
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
//# sourceMappingURL=run.js.map