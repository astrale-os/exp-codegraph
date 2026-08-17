import { APPLICATION_LAYOUT_FACT_NAMESPACE, } from '../../specification/observation/model.js';
import { SPECIFICATION_VALIDITY_PROFILE_ID } from '../specification/index.js';
export const MODULE_LAYOUT_PROFILE_ID = 'contract.module.layout';
const layoutRules = [
    'MODULE-LAYOUT-DECLARED',
    'MODULE-LAYOUT-EXACT',
    'MODULE-LAYOUT-CONFORMS',
];
/** Compare physical layout observations without adding them to normative specifications. */
export function createModuleLayoutConformanceProfile(options = {}) {
    return {
        manifest: {
            id: MODULE_LAYOUT_PROFILE_ID,
            version: '1.0.0',
            dependsOn: [SPECIFICATION_VALIDITY_PROFILE_ID],
            requiresCapabilities: [
                {
                    capability: APPLICATION_LAYOUT_FACT_NAMESPACE,
                    scope: 'specification-module',
                },
            ],
            rules: layoutRules,
            evaluationScope: 'specification',
        },
        async evaluate(context) {
            const fact = await oneLayoutFact(context);
            return [
                declaredRule(fact, Boolean(options.requireComplete)),
                exactRule(fact, Boolean(options.requireExact)),
                conformanceRule(fact),
            ];
        },
    };
}
async function oneLayoutFact(context) {
    const facts = [];
    for (const query of context.queries.values()) {
        const page = await query.facts({
            namespaces: [APPLICATION_LAYOUT_FACT_NAMESPACE],
            subjects: [context.specification.module.id],
        }, { limit: 10 });
        for (const fact of page.facts) {
            if (!isLayoutObservation(fact.payload)) {
                throw new TypeError(`Layout observation ${fact.id} has an invalid payload.`);
            }
            facts.push(fact);
        }
    }
    if (facts.length !== 1) {
        throw new Error(`Expected one layout observation for ${context.specification.module.id}, found ${facts.length}.`);
    }
    return facts[0];
}
function declaredRule(fact, required) {
    const diagnostics = required && !fact.payload.declared
        ? [diagnostic('MODULE_LAYOUT_REQUIRED', 'Every selected module must declare layout.ts.', layoutRules[0], fact)]
        : [];
    return result(layoutRules[0], diagnostics, required ? 1 : 0);
}
function exactRule(fact, required) {
    const diagnostics = required && (!fact.payload.declared || !fact.payload.exact)
        ? [diagnostic('MODULE_LAYOUT_EXACT_REQUIRED', 'Every selected module must declare an exact layout.', layoutRules[1], fact)]
        : [];
    return result(layoutRules[1], diagnostics, required ? 1 : 0);
}
function conformanceRule(fact) {
    const diagnostics = fact.payload.diagnostics.map((entry) => ({
        code: entry.code,
        severity: 'error',
        message: entry.message,
        profile: MODULE_LAYOUT_PROFILE_ID,
        rule: layoutRules[2],
        subject: fact.subject,
        specificationPointer: entry.pointer,
        evidence: fact.provenance.evidence,
        inputs: [fact.id],
        actual: entry,
    }));
    const total = fact.payload.declared ? fact.payload.entries.length + fact.payload.additional.length : 0;
    const matched = fact.payload.entries.filter((entry) => entry.status === 'matched').length;
    return {
        rule: layoutRules[2],
        status: diagnostics.length ? 'fail' : 'pass',
        diagnostics,
        coverage: {
            forward: { matched, total: fact.payload.entries.length },
            inverse: { matched: total - fact.payload.additional.length, total },
        },
    };
}
function diagnostic(code, message, rule, fact) {
    return {
        code,
        severity: 'error',
        message,
        profile: MODULE_LAYOUT_PROFILE_ID,
        rule,
        subject: fact.subject,
        evidence: fact.provenance.evidence,
        inputs: [fact.id],
    };
}
function result(rule, diagnostics, total) {
    const matched = diagnostics.length ? 0 : total;
    return {
        rule,
        status: diagnostics.length ? 'fail' : 'pass',
        diagnostics,
        coverage: {
            forward: { matched, total },
            inverse: { matched, total },
        },
    };
}
function isLayoutObservation(value) {
    return Boolean(value &&
        typeof value === 'object' &&
        typeof value.declared === 'boolean' &&
        Array.isArray(value.entries) &&
        Array.isArray(value.diagnostics));
}
//# sourceMappingURL=layout.js.map