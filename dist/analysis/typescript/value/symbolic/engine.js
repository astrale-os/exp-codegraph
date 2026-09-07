import { createHash } from 'node:crypto';
import { createTypeScriptFactReader } from '../../facts/index.js';
import { resolveBoundedValueLimits } from '../limits.js';
const PROOF = Symbol('Codegraph value proof');
const UNDEFINED = Object.freeze({ kind: 'literal', value: undefined });
/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
export function createValueEvaluatorFactory(query) {
    let pending;
    return async (options = {}) => {
        pending ??= indexFacts(query).catch((error) => { pending = undefined; throw error; });
        return new Evaluator(await pending, options.call, resolveBoundedValueLimits(options.limits));
    };
}
class Evaluator {
    #index;
    #model;
    #limits;
    constructor(index, model, limits) {
        this.#index = index;
        this.#model = model;
        this.#limits = limits;
    }
    value(occurrence) { return this.plan({ kind: 'value', occurrence }); }
    canReuse(proof) {
        const metadata = proof[PROOF];
        return !!metadata && metadata.model === this.#model && metadata.limits === JSON.stringify(this.#limits) &&
            [...metadata.dependencies].every(([key, fingerprint]) => this.#index.fingerprints.get(key) === fingerprint);
    }
    async evaluate(occurrence, options = {}) {
        return this.resolve({ kind: 'value', occurrence }, options, true);
    }
    plan(node) {
        const plan = Object.freeze({
            property: (name) => this.plan({ kind: 'property', input: node, name }),
            invoke: () => this.plan({ kind: 'invoke', input: node }),
            resolve: async (options = {}) => this.resolve(node, options, false),
        });
        return plan;
    }
    resolve(plan, options, scalar) {
        const state = { limits: options.limits ? resolveBoundedValueLimits({ ...this.#limits, ...options.limits }) : this.#limits,
            signal: options.signal, dependencies: new Set(), evidence: new Set(), active: new Map(), steps: 0 };
        state.signal?.throwIfAborted();
        const value = this.evaluatePlan(plan, state);
        const result = { ...this.result(state.exhausted ?? value, state, scalar), limits: state.limits };
        Object.defineProperty(result, PROOF, { value: {
                model: this.#model,
                limits: JSON.stringify(state.limits),
                dependencies: new Map([...state.dependencies].map((key) => [key, this.#index.fingerprints.get(key)])),
            } });
        return Object.freeze(result);
    }
    evaluatePlan(plan, state) {
        if (plan.kind === 'value')
            return this.visit(plan.occurrence, new Map(), state, 0);
        const input = this.evaluatePlan(plan.input, state);
        if (plan.kind === 'property')
            return this.property(input, plan.name, state, 0);
        return this.invoke(input, state, 0);
    }
    visit(id, environment, state, depth) {
        state.signal?.throwIfAborted();
        if (++state.steps > state.limits.maximumSteps)
            return exhaust(state, 'VALUE_STEP_LIMIT', 'Bounded value evaluation exceeded its step limit.');
        if (depth > state.limits.maximumDepth)
            return exhaust(state, 'VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.');
        const frames = state.active.get(id) ?? new Set();
        if (frames.has(environment))
            return uncertain('VALUE_RECURSION', 'Value propagation encountered a recursive occurrence.');
        this.depend(state, `occurrence:${id}`);
        const occurrence = this.#index.occurrences.get(id);
        if (!occurrence)
            return uncertain('VALUE_OCCURRENCE_MISSING', `Occurrence ${id} is unavailable.`);
        frames.add(environment);
        state.active.set(id, frames);
        try {
            return this.expression(occurrence, environment, state, depth);
        }
        finally {
            frames.delete(environment);
            if (!frames.size)
                state.active.delete(id);
        }
    }
    expression(occurrence, environment, state, depth) {
        const id = occurrence.id;
        const children = this.#index.children.get(id);
        const next = (child, env = environment) => child
            ? this.visit(child, env, state, depth + 1)
            : uncertain('VALUE_RELATION_MISSING', 'A required value relation is unavailable.');
        const call = this.#index.calls.get(id);
        if (call)
            return this.call(call, environment, state, depth);
        if (FUNCTION_SYNTAX.has(occurrence.syntax)) {
            if (occurrence.symbol)
                this.depend(state, `function:${occurrence.symbol}`);
            const body = occurrence.symbol && this.#index.bodies.get(occurrence.symbol);
            return body ? { kind: 'function', body, environment } : uncertain('VALUE_BODY_MISSING', 'The function body is unavailable.');
        }
        if (occurrence.syntax === 'ObjectLiteralExpression') {
            const properties = new Map();
            let incomplete = false;
            const entries = [...(children ?? [])].filter(([role]) => role.startsWith('property:'))
                .sort(([left], [right]) => Number(left.slice(9)) - Number(right.slice(9)));
            for (const [, property] of entries) {
                const node = this.#index.occurrences.get(property);
                const links = this.#index.children.get(property);
                if (node.syntax === 'SpreadAssignment') {
                    const spread = next(links?.get('expression'));
                    if (spread.kind === 'object') {
                        if (spread.incomplete) {
                            properties.clear();
                            incomplete = true;
                        }
                        for (const [name, value] of spread.properties)
                            properties.set(name, value);
                    }
                    else {
                        properties.clear();
                        incomplete = true;
                    }
                    continue;
                }
                const nameId = links?.get('name') ?? (node.syntax === 'ShorthandPropertyAssignment' ? links?.get('child:0') : undefined);
                const nameNode = nameId && this.#index.occurrences.get(nameId);
                const nameSymbol = nameNode?.symbol ?? (node.syntax === 'MethodDeclaration' ? node.symbol : undefined);
                if (nameSymbol)
                    this.depend(state, `symbol:${nameSymbol}`);
                const directName = nameId && this.#index.direct.get(nameId);
                const name = (nameSymbol && this.#index.symbols.get(nameSymbol)?.payload.name) ||
                    (directName?.kind === 'known' && typeof directName.value === 'string' ? directName.value : undefined);
                if (!name) {
                    properties.clear();
                    incomplete = true;
                    continue;
                }
                const value = node.syntax === 'MethodDeclaration' ? property : links?.get('initializer') ??
                    (node.syntax === 'ShorthandPropertyAssignment' ? nameId : undefined);
                if (value)
                    properties.set(name, { occurrence: value, environment });
                else {
                    properties.delete(name);
                    incomplete = true;
                }
            }
            return { kind: 'object', properties, incomplete };
        }
        if (occurrence.syntax === 'ConditionalExpression') {
            const condition = children?.get('condition');
            if (condition)
                this.depend(state, `occurrence:${condition}`);
            const value = condition && this.#index.direct.get(condition);
            if (value?.kind === 'known' && typeof value.value === 'boolean')
                return next(children?.get(value.value ? 'when-true' : 'when-false'));
            return alternatives([next(children?.get('when-true')), next(children?.get('when-false'))], state);
        }
        if (TRANSPARENT_SYNTAX.has(occurrence.syntax))
            return next(children?.get('expression'));
        if (occurrence.syntax === 'ReturnStatement')
            return children?.has('expression') ? next(children.get('expression')) : UNDEFINED;
        if (occurrence.syntax === 'VariableDeclaration' || occurrence.syntax === 'PropertyAssignment')
            return next(children?.get('initializer'));
        if (occurrence.syntax === 'Identifier' || occurrence.syntax === 'Parameter') {
            if (occurrence.symbol) {
                this.depend(state, `mutation:${occurrence.symbol}`);
                if (this.#index.mutations.has(occurrence.symbol))
                    return uncertain('VALUE_MUTATION_UNSUPPORTED', 'Writes to this binding or an object alias prevent an initializer-only value proof.');
            }
            const bound = occurrence.symbol && environment.get(occurrence.symbol);
            if (bound)
                return next(bound.occurrence, bound.environment);
            const definitions = this.#index.definitions.get(id);
            if (definitions?.length)
                return alternatives(definitions.map((definition) => next(definition)), state);
            for (const parent of this.#index.parents.get(id) ?? []) {
                const node = this.#index.occurrences.get(parent.parent);
                if (parent.role === 'name' && (node?.syntax === 'VariableDeclaration' || node?.syntax === 'PropertyAssignment'))
                    return next(this.#index.children.get(parent.parent)?.get('initializer'));
                if (parent.role === 'left' && node?.kind === 'assignment') {
                    return uncertain('VALUE_ASSIGNMENT_UNSUPPORTED', 'Assignment operands do not prove the effective assigned value.');
                }
            }
            if (occurrence.symbol) {
                this.depend(state, `initializers:${occurrence.symbol}`, `function:${occurrence.symbol}`, `symbol:${occurrence.symbol}`);
                const initializers = this.#index.initializers.get(occurrence.symbol);
                if (initializers?.length)
                    return alternatives(initializers.map((initializer) => next(initializer)), state);
                const body = this.#index.bodies.get(occurrence.symbol);
                if (body)
                    return { kind: 'function', body, environment };
                if (occurrence.symbolOrigin)
                    return { kind: 'external', symbol: occurrence.symbol, symbolOrigin: occurrence.symbolOrigin };
            }
        }
        if (occurrence.syntax === 'PropertyAccessExpression') {
            const receiver = next(children?.get('receiver') ?? children?.get('child:0'));
            const nameId = children?.get('name') ?? children?.get('child:1');
            const symbol = nameId && this.#index.occurrences.get(nameId)?.symbol;
            if (symbol)
                this.depend(state, `symbol:${symbol}`);
            const name = symbol && this.#index.symbols.get(symbol)?.payload.name;
            return name ? this.property(receiver, name, state, depth + 1) : uncertain('VALUE_PROPERTY_UNRESOLVED', 'The property identity is unavailable.');
        }
        const direct = this.#index.direct.get(id);
        if (direct?.kind === 'known')
            return { kind: 'literal', value: direct.value };
        if (direct?.kind === 'ambiguous')
            return alternatives(direct.values.map((value) => ({ kind: 'literal', value })), state);
        if (direct?.kind === 'unsupported')
            return { kind: 'unsupported', construct: direct.construct };
        if (occurrence.syntax === 'TrueKeyword')
            return { kind: 'literal', value: true };
        if (occurrence.syntax === 'FalseKeyword')
            return { kind: 'literal', value: false };
        if (occurrence.syntax === 'NullKeyword')
            return { kind: 'literal', value: null };
        if (occurrence.syntax === 'ArrayLiteralExpression')
            return { kind: 'object', properties: new Map(), incomplete: true };
        return uncertain('VALUE_NO_SEMANTIC_PATH', `No bounded value path is available for ${occurrence.syntax}.`);
    }
    call(call, environment, state, depth) {
        const callee = this.#index.children.get(call.occurrence)?.get('callee');
        const operand = (id) => this.result(this.visit(id, environment, state, depth + 1), state, false);
        const modeled = this.#model?.({
            call,
            callee: () => callee ? operand(callee) : this.result(uncertain('VALUE_CALLEE_MISSING', 'The call has no callee occurrence.'), state, false),
            receiver: () => call.receiver ? operand(call.receiver) : undefined,
            argument: (index) => call.arguments[index] ? operand(call.arguments[index]) : undefined,
        });
        if (modeled)
            return modeled.kind === 'atom' ? modeled : uncertain('VALUE_MODEL_UNKNOWN', modeled.reason);
        if (call.bindings.some((binding) => binding.rest) || call.arguments.some((id) => this.#index.occurrences.get(id)?.syntax === 'SpreadElement')) {
            return uncertain('VALUE_ARGUMENT_BINDING_UNSUPPORTED', 'Spread and rest arguments require an aggregate argument binding.');
        }
        if (call.target)
            this.depend(state, `function:${call.target}`);
        const body = call.target && this.#index.bodies.get(call.target);
        // Resolve the callee first to preserve environments of returned/stored closures.
        const resolved = callee ? this.visit(callee, environment, state, depth + 1) : undefined;
        const target = resolved?.kind === 'function' || resolved?.kind === 'alternatives'
            ? resolved
            : body ? { kind: 'function', body, environment }
                : call.target ? { kind: 'unsupported', construct: 'external-or-bodyless-call' }
                    : resolved?.kind === 'unknown' ? resolved : uncertain('VALUE_DYNAMIC_CALL', 'The call target is unresolved or dynamic.');
        return this.invoke(target, state, depth + 1, call, environment);
    }
    invoke(value, state, depth, call, caller = new Map()) {
        state.signal?.throwIfAborted();
        if (depth > state.limits.maximumDepth)
            return exhaust(state, 'VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.');
        if (value.kind === 'unknown' || value.kind === 'unsupported')
            return value;
        if (value.kind === 'alternatives')
            return alternatives(value.values.map((item) => this.invoke(item, state, depth + 1, call, caller)), state);
        if (value.kind !== 'function')
            return uncertain('VALUE_NOT_CALLABLE', 'The resolved value is not an inspectable function.');
        const body = value.body.payload.body;
        this.depend(state, `function:${body.function}`);
        if (body.execution !== 'sync')
            return uncertain('VALUE_EXECUTION_UNSUPPORTED', 'The function is not proved to produce a synchronous value.');
        if (body.summary.recursion)
            return uncertain('VALUE_RECURSION', 'The target function is recursive.');
        const completeness = value.body.completeness;
        if (completeness.kind !== 'complete' && (completeness.kind !== 'partial' || completeness.reasons.some(({ code }) => code !== 'CFG_EXPRESSION_BRANCH_PARTIAL'))) {
            return uncertain('VALUE_CONTROL_FLOW_INCOMPLETE', 'The function control flow is incomplete in this snapshot.');
        }
        const environment = new Map(value.environment);
        for (const binding of call?.bindings ?? []) {
            if (binding.parameter)
                environment.set(binding.parameter, { occurrence: binding.argument, environment: caller });
        }
        if (!body.summary.returns.length)
            return UNDEFINED;
        const returned = body.summary.returns.map((id) => this.visit(id, environment, state, depth + 1));
        if (body.occurrences.some(({ syntax }) => syntax === 'Block') && body.edges.some(({ to, kind }) => to === 'exit' && kind === 'fallthrough'))
            returned.push(UNDEFINED);
        return alternatives(returned, state);
    }
    property(value, name, state, depth) {
        state.signal?.throwIfAborted();
        if (value.kind === 'unknown' || value.kind === 'unsupported')
            return value;
        if (value.kind === 'alternatives')
            return alternatives(value.values.map((item) => this.property(item, name, state, depth + 1)), state);
        if (value.kind !== 'object')
            return uncertain('VALUE_PROPERTY_UNSUPPORTED', 'The receiver has no inspectable object properties.');
        const property = value.properties.get(name);
        return property ? this.visit(property.occurrence, property.environment, state, depth + 1)
            : value.incomplete ? uncertain('VALUE_PROPERTY_INCOMPLETE', `The effective ${name} property is unknown.`) : UNDEFINED;
    }
    result(value, state, scalar) {
        const evidence = [...state.evidence].sort();
        if (value.kind === 'unknown')
            return { kind: 'unknown', reasons: [{ code: value.code, message: value.reason, retryable: false }], evidence };
        if (value.kind === 'unsupported')
            return { kind: 'unsupported', construct: value.construct, evidence };
        if (value.kind === 'alternatives') {
            const results = value.values.map((item) => this.result(item, state, scalar));
            const incomplete = results.find((item) => item.kind === 'unknown' || item.kind === 'unsupported');
            if (incomplete)
                return { ...incomplete, evidence };
            const values = [...new Map(results.flatMap((item) => item.kind === 'known' ? [item.value] : item.kind === 'ambiguous' ? item.values : [])
                    .map((item) => [JSON.stringify(item), item])).values()];
            if (values.length === 1)
                return { kind: 'known', value: values[0], evidence };
            return { kind: 'ambiguous', values, reasons: [{ code: 'VALUE_ALTERNATIVES', message: 'Several statically reachable values remain possible.', effective: { alternatives: values.length } }], evidence };
        }
        if (scalar)
            return value.kind === 'literal' ? { kind: 'known', value: value.value, evidence }
                : { kind: 'unknown', reasons: [{ code: 'VALUE_NOT_LITERAL', message: 'The value is symbolic rather than a materialized literal.', retryable: false }], evidence };
        const projected = value.kind === 'function'
            ? { kind: 'function', symbol: value.body.payload.body.function, execution: value.body.payload.body.execution, parameterCount: value.body.payload.body.parameters.length }
            : value.kind === 'object' ? { kind: 'object', properties: [...value.properties.keys()].sort(), complete: !value.incomplete } : value;
        return { kind: 'known', value: projected, evidence };
    }
    depend(state, ...keys) {
        for (const key of keys) {
            state.dependencies.add(key);
            for (const fact of this.#index.evidence.get(key) ?? [])
                state.evidence.add(fact);
        }
    }
}
const FUNCTION_SYNTAX = new Set(['ArrowFunction', 'FunctionExpression', 'FunctionDeclaration', 'MethodDeclaration']);
const TRANSPARENT_SYNTAX = new Set(['ParenthesizedExpression', 'NonNullExpression', 'SatisfiesExpression', 'AsExpression', 'TypeAssertionExpression']);
function uncertain(code, reason) { return { kind: 'unknown', code, reason }; }
function exhaust(state, code, reason) {
    state.exhausted ??= { kind: 'unknown', code, reason };
    return state.exhausted;
}
function alternatives(values, state) {
    const flattened = values.flatMap((value) => value.kind === 'alternatives' ? value.values : [value]);
    if (flattened.length > state.limits.maximumAlternatives)
        return exhaust(state, 'VALUE_ALTERNATIVE_LIMIT', 'Bounded value evaluation exceeded its alternative limit.');
    if (!flattened.length)
        return UNDEFINED;
    return flattened.length === 1 ? flattened[0] : { kind: 'alternatives', values: flattened };
}
async function indexFacts(query) {
    const reader = createTypeScriptFactReader(query);
    const [bodyFacts, symbolFacts] = await Promise.all([collect(reader.export('body')), collect(reader.export('symbol'))]);
    const bodies = new Map();
    const occurrences = new Map();
    const children = new Map();
    const parents = new Map();
    const definitions = new Map();
    const initializers = new Map();
    const calls = new Map();
    const direct = new Map();
    const fingerprints = new Map();
    const evidence = new Map();
    const bind = (key, fact, fingerprint) => {
        fingerprints.set(key, fingerprint);
        evidence.set(key, [fact.id]);
    };
    for (const fact of bodyFacts) {
        const body = fact.payload.body;
        const fingerprint = hashFact(fact);
        bodies.set(body.function, fact);
        bind(`function:${body.function}`, fact, fingerprint);
        for (const occurrence of body.occurrences) {
            const previous = occurrences.get(occurrence.id);
            if (previous && previous.owner !== occurrence.owner)
                throw new Error(`Occurrence ${occurrence.id} has multiple function owners.`);
            occurrences.set(occurrence.id, occurrence);
            bind(`occurrence:${occurrence.id}`, fact, fingerprint);
        }
        for (const relation of body.relations) {
            let map = children.get(relation.parent);
            if (!map)
                children.set(relation.parent, (map = new Map()));
            map.set(relation.role, relation.child);
            append(parents, relation.child, { parent: relation.parent, role: relation.role });
        }
        for (const definition of body.definitions)
            append(definitions, definition.use, definition.definition);
        for (const call of body.calls)
            calls.set(call.occurrence, call);
        for (const [id, value] of Object.entries(fact.payload.values))
            direct.set(id, value);
    }
    for (const occurrence of occurrences.values()) {
        if (occurrence.syntax !== 'VariableDeclaration')
            continue;
        const links = children.get(occurrence.id);
        const name = links?.get('name');
        const initializer = links?.get('initializer');
        const symbol = name && occurrences.get(name)?.symbol;
        if (symbol && initializer)
            append(initializers, symbol, initializer);
    }
    for (const [symbol, values] of initializers) {
        fingerprints.set(`initializers:${symbol}`, JSON.stringify([...values].sort()));
        evidence.set(`initializers:${symbol}`, [...new Set(values.flatMap((id) => evidence.get(`occurrence:${id}`) ?? []))]);
    }
    // Initializer provenance cannot prove an object's later shape after an observed
    // write. Follow direct aliases conservatively; do not invent heap execution.
    const mutations = new Map();
    const aliases = new Map();
    const rootSymbol = (id) => {
        const seen = new Set();
        while (id && !seen.has(id)) {
            seen.add(id);
            const node = occurrences.get(id);
            if (!node)
                return;
            if (node.syntax === 'Identifier')
                return node.symbol;
            const links = children.get(id);
            if (node.syntax === 'PropertyAccessExpression' || node.syntax === 'ElementAccessExpression')
                id = links?.get('receiver') ?? links?.get('child:0');
            else if (TRANSPARENT_SYNTAX.has(node.syntax))
                id = links?.get('expression');
            else
                return;
        }
        return;
    };
    for (const [symbol, values] of initializers) {
        for (const value of values) {
            const target = rootSymbol(value);
            if (target && target !== symbol) {
                let targets = aliases.get(symbol);
                if (!targets)
                    aliases.set(symbol, (targets = new Set()));
                targets.add(target);
            }
        }
    }
    for (const occurrence of occurrences.values()) {
        const links = children.get(occurrence.id);
        const target = occurrence.kind === 'assignment' ? links?.get('left')
            : occurrence.syntax === 'DeleteExpression' ? links?.get('expression') : undefined;
        const symbol = rootSymbol(target);
        if (symbol) {
            let writes = mutations.get(symbol);
            if (!writes)
                mutations.set(symbol, (writes = new Set()));
            writes.add(`occurrence:${occurrence.id}`);
        }
    }
    const pending = [...mutations.keys()];
    for (let position = 0; position < pending.length; position += 1) {
        const symbol = pending[position];
        for (const target of aliases.get(symbol) ?? []) {
            const writes = mutations.get(target) ?? new Set();
            const before = writes.size;
            for (const write of mutations.get(symbol))
                writes.add(write);
            if (writes.size !== before) {
                mutations.set(target, writes);
                pending.push(target);
            }
        }
    }
    for (const [symbol, writes] of mutations) {
        const keys = [...writes].sort();
        fingerprints.set(`mutation:${symbol}`, JSON.stringify(keys.map((key) => [key, fingerprints.get(key)])));
        evidence.set(`mutation:${symbol}`, [...new Set(keys.flatMap((key) => evidence.get(key) ?? []))]);
    }
    for (const fact of symbolFacts)
        bind(`symbol:${fact.payload.symbol}`, fact, hashFact(fact));
    return { bodies, occurrences, children, parents, definitions, initializers, calls, direct,
        symbols: new Map(symbolFacts.map((fact) => [fact.payload.symbol, fact])), mutations: new Set(mutations.keys()), fingerprints, evidence };
}
function hashFact(fact) {
    return createHash('sha256').update(JSON.stringify({ id: fact.id, payload: fact.payload, completeness: fact.completeness })).digest('hex');
}
function append(map, key, value) {
    let values = map.get(key);
    if (!values)
        map.set(key, (values = []));
    values.push(value);
}
async function collect(values) {
    const result = [];
    for await (const value of values)
        result.push(value);
    return result;
}
//# sourceMappingURL=engine.js.map