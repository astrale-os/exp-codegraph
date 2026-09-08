import { combineCompleteness, shardReference } from '../facts/index.js';
import { stableJson } from '../identity/model.js';
import { OrderedMap, compareKeys } from './ordered-map.js';
/** Counts retain masked partial reasons so removing an unavailable contribution restores them. */
class CompletionCounts {
    partial;
    unavailable;
    constructor(partial = new OrderedMap(), unavailable = new OrderedMap()) {
        this.partial = partial;
        this.unavailable = unavailable;
    }
    adjust(value, direction) {
        if (value.kind === 'complete')
            return this;
        let reasons = this[value.kind];
        for (const reason of value.reasons) {
            const key = stableJson(reason);
            const count = (reasons.get(key)?.count ?? 0) + direction;
            if (count < 0)
                throw new Error('A query completeness contribution is missing.');
            reasons = count ? reasons.set(key, { reason, count }) : reasons.delete(key);
        }
        return value.kind === 'partial' ? new CompletionCounts(reasons, this.unavailable)
            : new CompletionCounts(this.partial, reasons);
    }
    value() {
        if (this.unavailable.size)
            return combineCompleteness(undefined, {
                kind: 'unavailable', reasons: [...this.unavailable.values()].map(({ reason }) => reason),
            });
        if (this.partial.size)
            return combineCompleteness(undefined, {
                kind: 'partial', reasons: [...this.partial.values()].map(({ reason }) => reason),
            });
        return { kind: 'complete' };
    }
}
/** Generation-neutral, immutable rows; only a reader binds the requested generation. */
export class MemoryFactIndex {
    facts;
    #references;
    #namespaces;
    #capabilities;
    #postings;
    #manifest;
    constructor(facts, references, namespaces, capabilities, postings = new Map()) {
        this.facts = facts;
        this.#references = references;
        this.#namespaces = namespaces;
        this.#capabilities = capabilities;
        this.#postings = postings;
    }
    static build(shards) {
        const facts = [...shards.values()].flatMap((shard) => shard.facts)
            .sort((left, right) => compareKeys(left.id, right.id));
        const references = [...shards.values()].map(shardReference).sort((left, right) => compareKeys(left.key, right.key));
        return new MemoryFactIndex(OrderedMap.fromSorted(facts.map((fact) => [fact.id, fact])), OrderedMap.fromSorted(references.map((reference) => [reference.key, reference])), new OrderedMap(), new OrderedMap()).contributions([], [...shards.values()]);
    }
    update(removed, added) {
        let facts = this.facts;
        let references = this.#references;
        const postings = new Map(this.#postings);
        for (const [shards, direction] of [[removed, -1], [added, 1]]) {
            for (const shard of shards) {
                references = direction === 1 ? references.set(shard.key, shardReference(shard)) : references.delete(shard.key);
                for (const fact of shard.facts) {
                    facts = direction === 1 ? facts.set(fact.id, fact) : facts.delete(fact.id);
                    for (const [field, index] of postings) {
                        let next = index;
                        for (const key of fieldKeys(fact, field)) {
                            const previous = next.get(key) ?? new OrderedMap();
                            const bucket = direction === 1 ? previous.set(fact.id, fact) : previous.delete(fact.id);
                            next = bucket.size ? next.set(key, bucket) : next.delete(key);
                        }
                        postings.set(field, next);
                    }
                }
            }
        }
        return new MemoryFactIndex(facts, references, this.#namespaces, this.#capabilities, postings).contributions(removed, added);
    }
    manifest() {
        return this.#manifest ??= Object.freeze([...this.#references.values()].map((reference) => Object.freeze(reference)));
    }
    capabilities(declared) {
        const completion = new Map(declared.map((capability) => [capability, { kind: 'complete' }]));
        for (const [capability, value] of this.#capabilities)
            completion.set(capability, combineCompleteness(completion.get(capability), value.completion.value()));
        for (const [namespace, value] of this.#namespaces) {
            const facts = value.factCompletion.value();
            completion.set(namespace, combineCompleteness(completion.get(namespace), combineCompleteness(value.shardCompletion.value(), facts)));
            for (const [capability] of value.capabilities)
                completion.set(capability, combineCompleteness(completion.get(capability), facts));
        }
        return [...completion].sort(([left], [right]) => left.localeCompare(right))
            .map(([capability, completeness]) => ({ capability, completeness }));
    }
    *matching(filter) {
        for (const fact of this.candidates(filter))
            if (matches(fact, filter))
                yield fact;
    }
    candidates(filter) {
        let selected;
        let size = this.facts.size;
        for (const [field, values] of [
            ['subject', filter.subjects], ['subject', filter.symbols], ['source', filter.sources],
            ['namespace', filter.namespaces], ['kind', filter.kinds], ['completeness', filter.completeness],
        ]) {
            if (!values)
                continue;
            if (!values.length)
                return [];
            const index = this.postings(field);
            const groups = [...new Set(values)].flatMap((value) => { const group = index.get(value); return group ? [group] : []; });
            const count = groups.reduce((total, group) => total + group.size, 0);
            if (!count)
                return [];
            if (count < size) {
                selected = groups;
                size = count;
                if (count === 1)
                    break;
            }
        }
        if (!selected)
            return this.facts.values();
        return selected.length === 1 ? selected[0].values() : mergePostings(selected);
    }
    postings(field) {
        const existing = this.#postings.get(field);
        if (existing)
            return existing;
        const groups = new Map();
        for (const fact of this.facts.values()) {
            for (const key of fieldKeys(fact, field)) {
                let bucket = groups.get(key);
                if (!bucket)
                    groups.set(key, (bucket = []));
                bucket.push([fact.id, fact]);
            }
        }
        const next = OrderedMap.fromSorted([...groups].sort(([left], [right]) => compareKeys(left, right))
            .map(([key, entries]) => [key, OrderedMap.fromSorted(entries)]));
        this.#postings.set(field, next);
        return next;
    }
    contributions(removed, added) {
        let namespaces = this.#namespaces;
        let capabilities = this.#capabilities;
        for (const [shards, direction] of [[removed, -1], [added, 1]]) {
            for (const shard of shards) {
                const previous = namespaces.get(shard.namespace);
                let factCompletion = previous?.factCompletion ?? new CompletionCounts();
                for (const fact of shard.facts)
                    factCompletion = factCompletion.adjust(fact.completeness, direction);
                let declared = previous?.capabilities ?? new OrderedMap();
                for (const capability of shard.capabilities ?? []) {
                    const count = (declared.get(capability) ?? 0) + direction;
                    declared = count ? declared.set(capability, count) : declared.delete(capability);
                    const old = capabilities.get(capability);
                    const shards = (old?.shards ?? 0) + direction;
                    const completion = (old?.completion ?? new CompletionCounts()).adjust(shard.completion, direction);
                    capabilities = shards ? capabilities.set(capability, { shards, completion }) : capabilities.delete(capability);
                }
                const count = (previous?.shards ?? 0) + direction;
                const shardCompletion = (previous?.shardCompletion ?? new CompletionCounts()).adjust(shard.completion, direction);
                namespaces = count ? namespaces.set(shard.namespace, { shards: count, shardCompletion, factCompletion, capabilities: declared })
                    : namespaces.delete(shard.namespace);
            }
        }
        return new MemoryFactIndex(this.facts, this.#references, namespaces, capabilities, this.#postings);
    }
}
function fieldKeys(fact, field) {
    return field === 'source' ? [...new Set(fact.provenance.evidence.map(({ source }) => source))]
        : [field === 'completeness' ? fact.completeness.kind : fact[field]];
}
function matches(fact, filter) {
    return !(filter.namespaces && !filter.namespaces.includes(fact.namespace) ||
        filter.kinds && !filter.kinds.includes(fact.kind) || filter.subjects && !filter.subjects.includes(fact.subject) ||
        filter.completeness && !filter.completeness.includes(fact.completeness.kind) ||
        filter.sources && !fact.provenance.evidence.some(({ source }) => filter.sources.includes(source)) ||
        filter.symbols && !filter.symbols.some((symbol) => fact.subject === symbol));
}
/** Merge sorted postings without allocating or sorting their union, including overlap. */
function* mergePostings(groups) {
    const pending = [];
    const push = (head) => {
        let index = pending.length;
        pending.push(head);
        while (index) {
            const parent = (index - 1) >>> 1;
            if (compareKeys(pending[parent].fact.id, head.fact.id) <= 0)
                break;
            pending[index] = pending[parent];
            index = parent;
        }
        pending[index] = head;
    };
    for (const group of groups) {
        const iterator = group.values();
        const first = iterator.next();
        if (!first.done)
            push({ iterator, fact: first.value });
    }
    let previous;
    while (pending.length) {
        const selected = pending[0];
        const fact = selected.fact;
        if (fact.id !== previous) {
            previous = fact.id;
            yield fact;
        }
        const next = selected.iterator.next();
        if (next.done) {
            const last = pending.pop();
            if (!pending.length)
                break;
            pending[0] = last;
        }
        else
            selected.fact = next.value;
        const head = pending[0];
        let index = 0;
        while (index * 2 + 1 < pending.length) {
            let child = index * 2 + 1;
            if (child + 1 < pending.length && compareKeys(pending[child + 1].fact.id, pending[child].fact.id) < 0)
                child++;
            if (compareKeys(head.fact.id, pending[child].fact.id) <= 0)
                break;
            pending[index] = pending[child];
            index = child;
        }
        pending[index] = head;
    }
}
//# sourceMappingURL=query-index.js.map