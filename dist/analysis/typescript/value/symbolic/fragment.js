import { projectPackedTypeScriptBody } from '../../physical/index.js';
export class BodyFragment {
    fact;
    owner;
    source;
    nodes;
    calls;
    effects;
    callsBySource;
    packed;
    #occurrences;
    #calls;
    #children = new Map();
    #parents = new Map();
    #definitions = new Map();
    #definite = new Set();
    constructor(fact) {
        this.packed = projectPackedTypeScriptBody(fact);
        this.fact = this.packed ? fact : snapshotFact(fact);
        if (this.packed) {
            this.owner = this.packed.owner;
            this.source = this.packed.source;
            this.nodes = this.packed.occurrences.map((_, row) => ({ fragment: this, row }));
            this.calls = this.packed.calls.map((_, row) => ({ fragment: this, row }));
            this.effects = this.packed.effectCandidates;
            this.callsBySource = new Map(this.calls.length ? [[this.source, this.calls.map((ref) => this.callId(ref.row))]] : []);
        }
        else {
            const body = this.fact.payload.body;
            this.owner = body.function;
            this.source = body.occurrences[0]?.span.source ?? fact.provenance.evidence[0]?.source;
            this.#occurrences = body.occurrences;
            this.#calls = body.calls;
            const callSources = new Map();
            const sources = new Map(body.occurrences.map((node) => [node.id, node.span.source]));
            for (const call of body.calls) {
                const source = sources.get(call.occurrence);
                if (source)
                    append(callSources, source, call.occurrence);
            }
            this.callsBySource = callSources;
            this.nodes = body.occurrences.map((_, row) => ({ fragment: this, row }));
            this.calls = body.calls.map((_, row) => ({ fragment: this, row }));
            this.effects = body.occurrences.flatMap((node, row) => node.syntax === 'VariableDeclaration' ||
                node.syntax === 'DeleteExpression' || node.kind === 'assignment' ? [row] : []);
            for (const relation of body.relations) {
                let children = this.#children.get(relation.parent);
                if (!children)
                    this.#children.set(relation.parent, (children = new Map()));
                children.set(relation.role, relation.child);
                append(this.#parents, relation.child, { parent: relation.parent, role: relation.role });
            }
            for (const definition of body.definitions) {
                append(this.#definitions, definition.use, definition.definition);
                if (definition.reaching === 'definite')
                    this.#definite.add(definition.use);
            }
        }
    }
    id(row) { return this.packed?.occurrences[row] ?? this.#occurrences[row].id; }
    effectNode(row) { return this.packed?.effectNode(row) ?? this.#occurrences[row]; }
    effectCall(row) { return this.packed?.effectCall(row) ?? this.#calls[row]; }
    node(row) { return this.packed?.occurrence(row) ?? this.#occurrences[row]; }
    callId(row) { return this.packed ? this.packed.occurrences[this.packed.calls[row]] : this.#calls[row].occurrence; }
    call(row) { return this.packed?.call(row) ?? this.#calls[row]; }
    children(row) { return this.packed ? this.packed.children(row) : this.#children.get(this.id(row)); }
    parents(row) { return this.packed ? this.packed.parents(row) : this.#parents.get(this.id(row)); }
    definitions(row) { return this.packed ? this.packed.definitions(row) : this.#definitions.get(this.id(row)); }
    definite(row) { return this.packed ? this.packed.definite(row) : this.#definite.has(this.id(row)); }
    value(row) { return this.packed ? this.packed.value(row) : this.fact.payload.values[this.id(row)]; }
}
const FRAGMENTS = new WeakMap();
export function bodyFragment(fact) {
    let fragment = FRAGMENTS.get(fact);
    if (!fragment) {
        fragment = new BodyFragment(fact);
        FRAGMENTS.set(fragment.fact, fragment);
    }
    return fragment;
}
function append(map, key, value) {
    let values = map.get(key);
    if (!values)
        map.set(key, (values = []));
    values.push(value);
}
function snapshotFact(fact) {
    // External providers may reuse mutable input objects. Own our data containers,
    // without freezing their objects or memoizing a fragment by the caller's identity.
    return snapshotData(fact);
}
function snapshotData(value, seen = new Map()) {
    if (!value || typeof value !== 'object')
        return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        return value;
    const previous = seen.get(value);
    if (previous)
        return previous;
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const [key, entry] of Object.entries(value))
        Object.defineProperty(copy, key, {
            value: snapshotData(entry, seen), enumerable: true, writable: true, configurable: true,
        });
    return Object.freeze(copy);
}
//# sourceMappingURL=fragment.js.map