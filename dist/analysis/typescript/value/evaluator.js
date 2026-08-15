import { createTypeScriptFactReader } from '../facts/index.js';
import { resolveBoundedValueLimits } from './limits.js';
export async function createBoundedValueEvaluator(options) {
    const limits = resolveBoundedValueLimits(options.limits);
    const facts = [];
    for await (const fact of createTypeScriptFactReader(options.query).export('body')) {
        facts.push(fact);
    }
    return new PortableBoundedValueEvaluator(indexFacts(facts), limits);
}
class PortableBoundedValueEvaluator {
    #index;
    #limits;
    constructor(index, limits) {
        this.#index = index;
        this.#limits = limits;
    }
    async evaluate(occurrence, options = {}) {
        options.signal?.throwIfAborted();
        const state = { steps: 0, memo: new Map() };
        const result = this.visit(occurrence, 0, new Set(), state, options.signal, new Map());
        return { ...result, limits: this.#limits };
    }
    visit(occurrence, depth, active, state, signal, environment = new Map()) {
        signal?.throwIfAborted();
        const cacheable = environment.size === 0;
        const cached = cacheable ? state.memo.get(occurrence) : undefined;
        if (cached)
            return cached;
        if (++state.steps > this.#limits.maximumSteps) {
            return unknown('VALUE_STEP_LIMIT', 'Bounded value evaluation exceeded its step limit.', [], {
                maximumSteps: this.#limits.maximumSteps,
            });
        }
        if (depth > this.#limits.maximumDepth) {
            return unknown('VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.', [], {
                maximumDepth: this.#limits.maximumDepth,
            });
        }
        if (active.has(occurrence)) {
            return unknown('VALUE_RECURSION', 'Value propagation encountered a recursive occurrence.', []);
        }
        const indexed = this.#index.occurrences.get(occurrence);
        if (!indexed) {
            return unknown('VALUE_OCCURRENCE_MISSING', `Occurrence ${occurrence} is unavailable.`, []);
        }
        const nextActive = new Set(active).add(occurrence);
        const evidence = [indexed.fact];
        const direct = addEvidence(this.#index.direct.get(occurrence), evidence);
        if (direct?.kind === 'known' || direct?.kind === 'ambiguous') {
            if (cacheable)
                state.memo.set(occurrence, direct);
            return direct;
        }
        const call = this.#index.calls.get(occurrence);
        if (call) {
            const result = this.evaluateCall(call, depth, nextActive, state, signal, evidence, environment);
            if (cacheable && (result.kind !== 'unknown' || direct === undefined)) {
                state.memo.set(occurrence, result);
            }
            if (result.kind !== 'unknown' || direct === undefined)
                return result;
        }
        const occurrenceValue = indexed.occurrence;
        const candidates = [];
        if (occurrenceValue.kind === 'use') {
            candidates.push(...(this.#index.definitions.get(occurrence) ?? []));
        }
        if (occurrenceValue.kind === 'definition' && occurrenceValue.symbol) {
            const bound = environment.get(occurrenceValue.symbol);
            if (bound)
                candidates.push(bound);
            else
                candidates.push(...(this.#index.incoming.get(occurrenceValue.symbol) ?? []));
        }
        for (const parent of this.#index.parents.get(occurrence) ?? []) {
            if (parent.role !== 'name')
                continue;
            candidates.push(...this.children(parent.parent, 'initializer'));
        }
        candidates.push(...this.children(occurrence, 'initializer'));
        candidates.push(...this.children(occurrence, 'expression'));
        candidates.push(...this.children(occurrence, 'right'));
        if (candidates.length) {
            const result = this.combine(unique(candidates).map((candidate) => this.visit(candidate, depth + 1, nextActive, state, signal, environment)), evidence);
            if (cacheable)
                state.memo.set(occurrence, result);
            return result;
        }
        const result = direct ??
            unknown('VALUE_NO_SEMANTIC_PATH', `No bounded value path is available for ${occurrenceValue.syntax}.`, evidence);
        if (cacheable)
            state.memo.set(occurrence, result);
        return result;
    }
    evaluateCall(call, depth, active, state, signal, evidence, environment) {
        if (call.dynamic || !call.target) {
            return unknown('VALUE_DYNAMIC_CALL', 'The call target is unresolved or dynamic.', evidence);
        }
        const target = this.#index.bodies.get(call.target);
        if (!target) {
            return {
                kind: 'unsupported',
                construct: 'external-or-bodyless-call',
                evidence: unique([...evidence]),
            };
        }
        if (target.body.summary.recursion) {
            return unknown('VALUE_RECURSION', 'The target function is recursive.', [...evidence, target.fact]);
        }
        const returned = target.body.summary.returns.flatMap((occurrence) => this.children(occurrence, 'expression'));
        if (!returned.length) {
            return unknown('VALUE_RETURN_MISSING', 'The target function has no value-bearing return occurrence.', [...evidence, target.fact]);
        }
        const bindings = new Map(environment);
        for (const binding of call.bindings) {
            if (binding.parameter)
                bindings.set(binding.parameter, binding.argument);
        }
        return this.combine(returned.map((occurrence) => this.visit(occurrence, depth + 1, active, state, signal, bindings)), [...evidence, target.fact]);
    }
    combine(results, enclosingEvidence) {
        const evidence = unique([
            ...enclosingEvidence,
            ...results.flatMap((result) => [...result.evidence]),
        ]);
        const unsupported = results.find((result) => result.kind === 'unsupported');
        if (unsupported)
            return { ...unsupported, evidence };
        const unknowns = results.filter((result) => result.kind === 'unknown');
        if (unknowns.length) {
            return { kind: 'unknown', reasons: uniqueReasons(unknowns.flatMap((value) => value.reasons)), evidence };
        }
        const values = deduplicateValues(results.flatMap((result) => result.kind === 'known' ? [result.value] : result.kind === 'ambiguous' ? result.values : []));
        if (values.length === 1)
            return { kind: 'known', value: values[0], evidence };
        const inherited = results.flatMap((result) => result.kind === 'ambiguous' ? [...result.reasons] : []);
        const truncated = values.length > this.#limits.maximumAlternatives;
        const reasons = [
            ...inherited,
            {
                code: truncated ? 'VALUE_ALTERNATIVE_LIMIT' : 'VALUE_ALTERNATIVES',
                message: truncated
                    ? 'The result has more alternatives than the configured bound.'
                    : 'Several statically reachable values remain possible.',
                effective: {
                    alternatives: values.length,
                    maximumAlternatives: this.#limits.maximumAlternatives,
                    truncated,
                },
            },
        ];
        return {
            kind: 'ambiguous',
            values: values.slice(0, this.#limits.maximumAlternatives),
            reasons,
            evidence,
        };
    }
    children(parent, role) {
        return this.#index.children.get(parent)?.get(role) ?? [];
    }
}
function indexFacts(facts) {
    const occurrences = new Map();
    const children = new Map();
    const parents = new Map();
    const definitions = new Map();
    const incoming = new Map();
    const calls = new Map();
    const bodies = new Map();
    const direct = new Map();
    for (const fact of facts) {
        const payload = fact.payload;
        const body = payload.body;
        bodies.set(body.function, { body, fact: fact.id });
        for (const occurrence of body.occurrences) {
            const existing = occurrences.get(occurrence.id);
            if (existing && existing.occurrence.owner !== occurrence.owner) {
                throw new Error(`Occurrence ${occurrence.id} has multiple function owners.`);
            }
            occurrences.set(occurrence.id, { occurrence, fact: fact.id });
        }
        for (const relation of body.relations) {
            appendNested(children, relation.parent, relation.role, relation.child);
            append(parents, relation.child, { parent: relation.parent, role: relation.role });
        }
        for (const relation of body.definitions) {
            append(definitions, relation.use, relation.definition);
        }
        for (const call of body.calls) {
            calls.set(call.occurrence, call);
            for (const binding of call.bindings) {
                if (binding.parameter)
                    append(incoming, binding.parameter, binding.argument);
            }
        }
        for (const [occurrence, value] of Object.entries(payload.values)) {
            direct.set(occurrence, value);
        }
    }
    return { occurrences, children, parents, definitions, incoming, calls, bodies, direct };
}
function addEvidence(result, evidence) {
    return result ? { ...result, evidence: unique([...result.evidence, ...evidence]) } : undefined;
}
function unknown(code, message, evidence, effective) {
    const reason = {
        code,
        message: effective ? `${message} Effective: ${JSON.stringify(effective)}.` : message,
        retryable: false,
    };
    return { kind: 'unknown', reasons: [reason], evidence: unique([...evidence]) };
}
function append(map, key, value) {
    const values = map.get(key);
    if (values)
        values.push(value);
    else
        map.set(key, [value]);
}
function appendNested(map, key, inner, value) {
    let nested = map.get(key);
    if (!nested) {
        nested = new Map();
        map.set(key, nested);
    }
    append(nested, inner, value);
}
function unique(values) {
    return [...new Set(values)];
}
function uniqueReasons(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = `${value.code}\0${value.message}\0${String(value.attributableTo)}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function deduplicateValues(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = JSON.stringify(value);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=evaluator.js.map