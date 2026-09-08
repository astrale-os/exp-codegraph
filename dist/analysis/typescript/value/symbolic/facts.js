import { createHash } from 'node:crypto';
import { physicalPayloadForTransport } from '../../../facts/representation/index.js';
import { createTypeScriptFactReader, TypeScriptFactContractError } from '../../facts/index.js';
import { projectPackedTypeScriptBody } from '../../physical/index.js';
import { bodyFragment } from './fragment.js';
import { ValueIndexTable } from './table.js';
/** Most lookups have one contributing fact; uncommon overlaps retain their precise ordered owners. */
class Column {
    [Symbol.toStringTag] = 'ValueIndexColumn';
    slots;
    merge;
    constructor(slots = new ValueIndexTable(), merge = last) {
        this.slots = slots;
        this.merge = merge;
    }
    get size() { return this.slots.size; }
    get(key) { return this.slots.get(key)?.value; }
    has(key) { return this.slots.has(key); }
    fingerprint(key, hashes) {
        const slot = this.slots.get(key);
        if (!slot)
            return;
        return 'owner' in slot ? hashes.get(slot.owner)
            : JSON.stringify([...slot.owners.keys()].sort().map((owner) => [owner, hashes.get(owner)]));
    }
    evidence(key, facts) {
        const slot = this.slots.get(key);
        if (!slot)
            return;
        return 'owner' in slot ? facts.get(slot.owner) : [...slot.owners.keys()].sort();
    }
    project(key, project, merge = last) {
        return projectSlot(this.slots.get(key), project, merge);
    }
    edit() { return new ColumnEdit(this.slots.edit(), this.merge); }
    *entries() { for (const [key, slot] of this.slots)
        yield [key, slot.value]; }
    *keys() { yield* this.slots.keys(); }
    *values() { for (const slot of this.slots.values())
        yield slot.value; }
    [Symbol.iterator]() { return this.entries(); }
    forEach(callback, thisArg) {
        for (const [key, value] of this)
            callback.call(thisArg, value, key, this);
    }
}
class ColumnEdit {
    slots;
    merge;
    #owners = new Map();
    #finished = false;
    contributionWork = 0;
    constructor(slots, merge) {
        this.slots = slots;
        this.merge = merge;
    }
    get(key) {
        const owners = this.#owners.get(key);
        if (!owners)
            return this.slots.get(key)?.value;
        return owners.size ? this.merged(owners) : undefined;
    }
    project(key, project, merge = last) {
        const owners = this.#owners.get(key);
        if (!owners)
            return projectSlot(this.slots.get(key), project, merge);
        if (!owners.size)
            return;
        return projectSlot({ owners }, project, merge);
    }
    set(key, owner, value) {
        this.assertActive();
        const pending = this.#owners.get(key);
        if (pending) {
            pending.set(owner, value);
            return;
        }
        const old = this.slots.get(key);
        if (!old || 'owner' in old && old.owner === owner) {
            this.slots.set(key, { owner, value });
            return;
        }
        const owners = 'owner' in old ? new Map([[old.owner, old.value]]) : new Map(old.owners);
        owners.set(owner, value);
        this.#owners.set(key, owners);
    }
    delete(key, owner) {
        this.assertActive();
        const pending = this.#owners.get(key);
        if (pending) {
            pending.delete(owner);
            return;
        }
        const old = this.slots.get(key);
        if (!old)
            return;
        if ('owner' in old) {
            if (old.owner === owner)
                this.slots.delete(key);
            return;
        }
        if (!old.owners.has(owner))
            return;
        const owners = new Map(old.owners);
        owners.delete(owner);
        this.#owners.set(key, owners);
    }
    finish() {
        this.assertActive();
        for (const [key, owners] of this.#owners) {
            if (!owners.size)
                this.slots.delete(key);
            else if (owners.size === 1) {
                const [owner, value] = owners.entries().next().value;
                this.slots.set(key, { owner, value });
            }
            else
                this.slots.set(key, { owners, value: this.merged(owners) });
        }
        this.#finished = true;
        return new Column(this.slots.finish(), this.merge);
    }
    merged(owners) {
        this.contributionWork += owners.size;
        return this.merge([...owners].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value));
    }
    assertActive() { if (this.#finished)
        throw new Error('Value index column edit is already published.'); }
}
export class IndexedValues {
    work;
    bodies;
    occurrences;
    children;
    parents;
    definitions;
    definiteDefinitions;
    initializers;
    calls;
    direct;
    symbols;
    sources;
    callsBySource;
    mutations;
    escapes;
    aliases;
    fingerprints;
    evidence;
    revision;
    #facts;
    #columns;
    #derived;
    #hashes;
    #factEvidence;
    #witnesses;
    #aggregateEvidence;
    #mutationOwners;
    #aliasSources;
    constructor(facts, columns, derived, hashes, factEvidence, witnesses, aggregateEvidence, mutationOwners, aliasSources, revision, work = { facts: 0, bodies: 0, contributions: 0 }) {
        this.#facts = facts;
        this.#columns = columns;
        this.#derived = derived;
        this.#hashes = hashes;
        this.#factEvidence = factEvidence;
        this.#witnesses = witnesses;
        this.#aggregateEvidence = aggregateEvidence;
        this.#mutationOwners = mutationOwners;
        this.#aliasSources = aliasSources;
        this.revision = revision;
        this.work = Object.freeze(work);
        this.bodies = columns.bodies;
        this.occurrences = projectColumn(columns.occurrences, (ref) => ref.fragment.node(ref.row));
        this.children = projectColumn(columns.occurrences, (ref) => ref.fragment.children(ref.row), mergeChildren);
        this.parents = projectColumn(columns.occurrences, (ref) => ref.fragment.parents(ref.row), flatten);
        this.definitions = projectColumn(columns.occurrences, (ref) => ref.fragment.definitions(ref.row), flatten);
        this.definiteDefinitions = keysSet(projectColumn(columns.occurrences, (ref) => ref.fragment.definite(ref.row) ? true : undefined));
        this.initializers = columns.initializers;
        this.calls = projectColumn(columns.calls, (ref) => ref.fragment.call(ref.row));
        this.callsBySource = columns.callsBySource;
        this.direct = projectColumn(columns.occurrences, (ref) => ref.fragment.value(ref.row));
        this.symbols = columns.symbols;
        this.sources = columns.sources;
        this.mutations = mutationOwners;
        this.escapes = keysSet(columns.escapes);
        this.aliases = aliasSources;
        this.fingerprints = { get: (key) => this.fingerprint(key) };
        this.evidence = { get: (key) => {
                if (key.startsWith('function:'))
                    return columns.bodies.evidence(key.slice(9), factEvidence);
                if (key.startsWith('occurrence:'))
                    return columns.occurrences.evidence(key.slice(11), factEvidence);
                if (key.startsWith('symbol:'))
                    return columns.symbols.evidence(key.slice(7), factEvidence);
                return this.#aggregateEvidence.get(key);
            } };
    }
    static empty() {
        const columns = {
            bodies: new Column(), occurrences: new Column(), calls: new Column(), callsBySource: new Column(undefined, flatten),
            symbols: new Column(), sources: new Column(),
            initializers: new Column(undefined, flatten), mutations: new Column(undefined, flatten), escapes: new Column(undefined, flatten),
            aliases: new Column(undefined, flatten), dependents: new Column(undefined, flatten),
        };
        return new IndexedValues(new ValueIndexTable(), columns, new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), { token: {}, changed: new Set() });
    }
    dependency(key) {
        let canonical = key;
        if (key.startsWith('occurrence:')) {
            const id = key.slice(11);
            const slot = this.#columns.occurrences.slots.get(id);
            if (slot && 'owner' in slot) {
                const { fragment, row } = slot.value;
                // An admitted packed row shares its body's owner. Other providers keep
                // their node's owner, including custom objects with observable getters.
                const owner = fragment.packed ? fragment.owner : fragment.node(row).owner;
                const candidate = `function:${owner}`;
                const body = typeof owner === 'string' ? this.#columns.bodies.slots.get(owner) : undefined;
                // Equal contributing facts read the very same hash entry. Establish
                // that equality without expanding a node or rereading both hashes.
                const sameOwner = body && 'owner' in body && body.owner === slot.owner;
                if (sameOwner || this.fingerprint(candidate) === this.fingerprint(key))
                    canonical = candidate;
            }
            else if (slot) {
                const occurrence = this.occurrences.get(id);
                const candidate = occurrence && `function:${occurrence.owner}`;
                if (candidate && this.fingerprint(candidate) === this.fingerprint(key))
                    canonical = candidate;
            }
        }
        return this.#witnesses.get(canonical) ?? Object.freeze({ key: canonical, fingerprint: this.fingerprint(canonical) });
    }
    fingerprint(key) {
        if (key.startsWith('function:'))
            return this.#columns.bodies.fingerprint(key.slice(9), this.#hashes);
        if (key.startsWith('occurrence:'))
            return this.#columns.occurrences.fingerprint(key.slice(11), this.#hashes);
        if (key.startsWith('symbol:'))
            return this.#columns.symbols.fingerprint(key.slice(7), this.#hashes);
        return this.#witnesses.get(key)?.fingerprint;
    }
    update(upserts, deletes, initial = false) {
        const facts = this.#facts.edit();
        const hashes = this.#hashes.edit();
        const factEvidence = this.#factEvidence.edit();
        const derived = this.#derived.edit();
        const columns = Object.fromEntries(Object.entries(this.#columns).map(([key, column]) => [key, column.edit()]));
        const touched = new Set();
        const inputs = new Set();
        const changed = new Map();
        for (const id of deletes)
            if (this.#facts.has(id))
                changed.set(id, undefined);
        for (const input of upserts) {
            const fact = input.namespace === 'typescript.body' ? bodyFragment(input).fact : input;
            const previous = this.#facts.get(fact.id);
            if (previous && samePayload(previous, fact) && previous.completeness === fact.completeness && previous.provenance === fact.provenance) {
                changed.delete(fact.id);
                continue;
            }
            changed.set(fact.id, fact);
        }
        for (const [id, next] of changed) {
            const previous = this.#facts.get(id);
            if (previous)
                primary(columns, previous, false, touched, inputs);
            if (next) {
                primary(columns, next, true, touched, inputs);
                facts.set(id, next);
                hashes.set(id, hashFact(next));
                factEvidence.set(id, Object.freeze([id]));
            }
            else {
                facts.delete(id);
                hashes.delete(id);
                factEvidence.delete(id);
            }
        }
        const affected = new Set();
        for (const [id, fact] of changed)
            if (fact?.namespace === 'typescript.body' || this.#derived.has(id))
                affected.add(id);
        for (const key of inputs) {
            // Effect classification asks whether a callee body exists, not for its contents.
            if (key.startsWith('function:') && this.bodies.has(key.slice(9)) === !!columns.bodies.get(key.slice(9)))
                continue;
            for (const id of this.#columns.dependents.get(key) ?? [])
                affected.add(id);
        }
        for (const id of affected) {
            const previous = this.#derived.get(id);
            if (previous)
                derivedColumns(columns, id, previous, false, touched);
            const fact = facts.get(id);
            if (fact?.namespace === 'typescript.body') {
                const next = derive(fact, columns);
                derivedColumns(columns, id, next, true, touched);
                derived.set(id, next);
            }
            else
                derived.delete(id);
        }
        const nextColumns = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column.finish()]));
        const nextHashes = hashes.finish();
        const nextEvidence = factEvidence.finish();
        const witnesses = this.#witnesses.edit();
        const aggregateEvidence = this.#aggregateEvidence.edit();
        const mutationOwners = this.#mutationOwners.edit();
        const aliasSources = this.#aliasSources.edit();
        const directFingerprint = (key) => key.startsWith('function:')
            ? nextColumns.bodies.fingerprint(key.slice(9), nextHashes) : key.startsWith('occurrence:')
            ? nextColumns.occurrences.fingerprint(key.slice(11), nextHashes) : key.startsWith('symbol:')
            ? nextColumns.symbols.fingerprint(key.slice(7), nextHashes) : undefined;
        const occurrenceFingerprint = (id) => nextColumns.occurrences.fingerprint(id, nextHashes);
        const occurrenceEvidence = (ids) => [...new Set(ids.flatMap((id) => nextColumns.occurrences.evidence(id, nextEvidence) ?? []))];
        const changedKeys = new Set();
        for (const key of touched) {
            let fingerprint = directFingerprint(key);
            const separator = key.indexOf(':');
            const kind = key.slice(0, separator);
            const symbol = key.slice(separator + 1);
            if (kind === 'initializers') {
                const values = nextColumns.initializers.get(symbol);
                if (values) {
                    fingerprint = JSON.stringify([...values].sort().map((id) => [id, occurrenceFingerprint(id)]));
                    aggregateEvidence.set(key, occurrenceEvidence(values));
                }
                else
                    aggregateEvidence.delete(key);
            }
            else if (kind === 'mutation' || kind === 'escape' || kind === 'aliases') {
                const aliases = kind === 'aliases' ? nextColumns.aliases.get(symbol) : undefined;
                const values = aliases?.map((alias) => alias.occurrence) ??
                    (kind === 'mutation' ? nextColumns.mutations.get(symbol) : kind === 'escape' ? nextColumns.escapes.get(symbol) : undefined);
                if (values?.length) {
                    const ids = [...new Set(values)].sort();
                    fingerprint = JSON.stringify(ids.map((id) => [`occurrence:${id}`, occurrenceFingerprint(id)]));
                    aggregateEvidence.set(key, occurrenceEvidence(ids));
                    if (kind === 'mutation')
                        mutationOwners.set(symbol, [...new Set(ids.map((id) => nextColumns.occurrences.get(id).fragment.owner))]);
                    if (kind === 'aliases')
                        aliasSources.set(symbol, [...new Set(aliases.map((alias) => alias.from))]);
                }
                else {
                    aggregateEvidence.delete(key);
                    if (kind === 'mutation')
                        mutationOwners.delete(symbol);
                    if (kind === 'aliases')
                        aliasSources.delete(symbol);
                }
            }
            if (!initial && this.fingerprint(key) !== fingerprint)
                changedKeys.add(key);
            // Present occurrences normally share the selected function witness. Store
            // one whole-body witness instead of another object/trie entry per AST node.
            // Rare overlapping owners use an exact on-demand occurrence witness.
            if (kind === 'occurrence')
                continue;
            if (fingerprint === undefined)
                witnesses.delete(key);
            else if (this.#witnesses.get(key)?.fingerprint !== fingerprint)
                witnesses.set(key, Object.freeze({ key, fingerprint }));
        }
        return new IndexedValues(facts.finish(), nextColumns, derived.finish(), nextHashes, nextEvidence, witnesses.finish(), aggregateEvidence.finish(), mutationOwners.finish(), aliasSources.finish(), { token: {}, ...(!initial ? { parent: this.revision.token } : {}), changed: changedKeys }, { facts: changed.size, bodies: affected.size, contributions: Object.values(columns).reduce((sum, column) => sum + column.contributionWork, 0) });
    }
}
export async function loadValueIndex(query) {
    const reader = createTypeScriptFactReader(query);
    const facts = await Promise.all([readIndexedBodies(query), collect(reader.export('symbol')), collect(reader.export('source'))]);
    return IndexedValues.empty().update(facts.flat(), [], true);
}
function primary(columns, fact, add, touched, inputs) {
    const owner = fact.id;
    const apply = (column, key, value) => {
        if (add)
            column.set(key, owner, value);
        else
            column.delete(key, owner);
    };
    if (fact.namespace === 'typescript.symbol') {
        apply(columns.symbols, fact.payload.symbol, fact);
        touched.add(`symbol:${fact.payload.symbol}`);
        return;
    }
    if (fact.namespace === 'typescript.source') {
        apply(columns.sources, fact.payload.source, fact);
        return;
    }
    const fragment = bodyFragment(fact);
    apply(columns.bodies, fragment.owner, fact);
    touched.add(`function:${fragment.owner}`);
    inputs.add(`function:${fragment.owner}`);
    for (const reference of fragment.nodes) {
        const id = fragment.id(reference.row);
        const previous = columns.occurrences.get(id);
        if (add && previous && previous.fragment.owner !== fragment.owner)
            throw new Error(`Occurrence ${id} has multiple function owners.`);
        apply(columns.occurrences, id, reference);
        touched.add(`occurrence:${id}`);
        inputs.add(`occurrence:${id}`);
        inputs.add(`children:${id}`);
    }
    for (const reference of fragment.calls)
        apply(columns.calls, fragment.callId(reference.row), reference);
    for (const [source, calls] of fragment.callsBySource)
        apply(columns.callsBySource, source, calls);
}
function derive(fact, columns) {
    const inputs = new Set();
    const occurrence = (id) => { inputs.add(`occurrence:${id}`); return columns.occurrences.project(id, (ref) => ref.fragment.effectNode(ref.row)); };
    const children = (id) => { inputs.add(`children:${id}`); return columns.occurrences.project(id, (ref) => ref.fragment.children(ref.row), mergeChildren); };
    const rootSymbol = (id) => {
        const seen = new Set();
        while (id && !seen.has(id)) {
            seen.add(id);
            const node = occurrence(id);
            if (!node)
                return;
            if (node.syntax === 'Identifier')
                return node.symbol;
            const links = children(id);
            if (node.syntax === 'PropertyAccessExpression' || node.syntax === 'ElementAccessExpression')
                id = links?.get('receiver') ?? links?.get('child:0');
            else if (TRANSPARENT_SYNTAX.has(node.syntax))
                id = links?.get('expression');
            else
                return;
        }
        return;
    };
    const initializers = new Map();
    const mutations = new Map();
    const escapes = new Map();
    const aliases = new Map();
    const fragment = bodyFragment(fact);
    for (const row of fragment.effects) {
        const node = fragment.effectNode(row);
        if (node.syntax === 'VariableDeclaration') {
            const links = children(node.id);
            const name = links?.get('name');
            const initializer = links?.get('initializer');
            const symbol = name && occurrence(name)?.symbol;
            if (symbol && initializer) {
                append(initializers, symbol, initializer);
                const target = rootSymbol(initializer);
                if (target && target !== symbol)
                    append(aliases, target, { from: symbol, occurrence: initializer });
            }
        }
        const target = node.kind === 'assignment' ? children(node.id)?.get('left')
            : node.syntax === 'DeleteExpression' ? children(node.id)?.get('expression') : undefined;
        const symbol = rootSymbol(target);
        if (symbol)
            append(mutations, symbol, node.id);
    }
    for (const reference of fragment.calls) {
        const call = fragment.effectCall(reference.row);
        for (const binding of call.bindings) {
            const argument = rootSymbol(binding.argument);
            if (binding.parameter && argument && binding.parameter !== argument)
                append(aliases, argument, { from: binding.parameter, occurrence: call.occurrence });
        }
        if (call.target)
            inputs.add(`function:${call.target}`);
        if (call.target && columns.bodies.get(call.target) && !call.dynamic)
            continue;
        for (const argument of call.arguments) {
            const symbol = rootSymbol(argument);
            if (symbol)
                append(escapes, symbol, call.occurrence);
        }
    }
    return { initializers, mutations, escapes, aliases, inputs };
}
function derivedColumns(columns, owner, value, add, touched) {
    for (const [column, prefix, entries] of [
        [columns.initializers, 'initializers', value.initializers], [columns.mutations, 'mutation', value.mutations],
        [columns.escapes, 'escape', value.escapes],
    ]) {
        for (const [key, items] of entries) {
            if (add)
                column.set(key, owner, items);
            else
                column.delete(key, owner);
            touched.add(`${prefix}:${key}`);
        }
    }
    for (const [key, items] of value.aliases) {
        if (add)
            columns.aliases.set(key, owner, items);
        else
            columns.aliases.delete(key, owner);
        touched.add(`aliases:${key}`);
    }
    for (const key of value.inputs) {
        if (add)
            columns.dependents.set(key, owner, [owner]);
        else
            columns.dependents.delete(key, owner);
    }
}
function hashFact(fact) {
    const packed = fact.namespace === 'typescript.body' && projectPackedTypeScriptBody(fact);
    return createHash('sha256').update(JSON.stringify({ id: fact.id,
        ...(packed ? { physical: packed.record } : { payload: fact.payload }), completeness: fact.completeness })).digest('hex');
}
function last(values) { return values.at(-1); }
function flatten(values) { return values.flat(); }
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
function keysSet(map) {
    return {
        get size() { return map.size; }, has: (key) => map.has(key), keys: () => map.keys(), values: () => map.keys(),
        *entries() { for (const key of map.keys())
            yield [key, key]; },
        [Symbol.iterator]: () => map.keys(),
        forEach(callback, thisArg) { for (const key of map.keys())
            callback.call(thisArg, key, key, this); },
    };
}
const TRANSPARENT_SYNTAX = new Set(['ParenthesizedExpression', 'NonNullExpression', 'SatisfiesExpression', 'AsExpression', 'TypeAssertionExpression']);
function mergeChildren(values) {
    return new Map(values.flatMap((value) => [...value]));
}
function projectColumn(column, project, merge = last) {
    const get = (key) => column.project(key, project, merge);
    const result = {
        get, has: (key) => get(key) !== undefined,
        get size() { let count = 0; for (const _ of result)
            count++; return count; },
        *entries() { for (const key of column.keys()) {
            const value = get(key);
            if (value !== undefined)
                yield [key, value];
        } },
        *keys() { for (const [key] of result)
            yield key; },
        *values() { for (const [, value] of result)
            yield value; },
        [Symbol.iterator]() { return this.entries(); },
        forEach(callback, thisArg) { for (const [key, value] of result)
            callback.call(thisArg, value, key, result); },
    };
    return result;
}
function samePayload(left, right) {
    if (left === right)
        return true;
    const physical = physicalPayloadForTransport(left);
    return physical ? physical === physicalPayloadForTransport(right) : left.payload === right.payload;
}
export async function readIndexedBodies(query, ids) {
    const facts = ids ? await query.factsById(ids) : await collect(query.export({ namespaces: ['typescript.body'] }));
    const result = [];
    const remaining = [];
    for (const fact of facts) {
        if (!projectPackedTypeScriptBody(fact)) {
            remaining.push(fact.id);
            continue;
        }
        const diagnostics = [];
        if (fact.namespace !== 'typescript.body')
            diagnostics.push(`namespace:${fact.namespace}`);
        if (fact.schemaVersion !== 1)
            diagnostics.push(`schema-version:${fact.schemaVersion}`);
        if (diagnostics.length)
            throw new TypeScriptFactContractError('body', fact.id, diagnostics);
        result.push(fact);
    }
    if (remaining.length)
        result.push(...await createTypeScriptFactReader(query).factsById('body', remaining));
    return result.sort((left, right) => left.id.localeCompare(right.id));
}
function projectSlot(slot, project, merge) {
    if (!slot)
        return;
    if ('owner' in slot)
        return project(slot.value);
    const values = [...slot.owners].sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, value]) => { const result = project(value); return result === undefined ? [] : [result]; });
    return values.length ? merge(values) : undefined;
}
//# sourceMappingURL=facts.js.map