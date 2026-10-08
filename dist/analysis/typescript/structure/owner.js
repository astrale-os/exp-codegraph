import {} from '../../facts/index.js';
import { stableJson } from '../../identity/model.js';
import { createTypeScriptFactReader } from '../facts/index.js';
import { ValueIndexTable } from '../value/symbolic/table.js';
const complete = { kind: 'complete' };
export const structuralKey = {
    paths: 'paths', capability: 'capability',
    file: (path) => `file:${JSON.stringify(path)}`,
    path: (path) => `path:${JSON.stringify(path)}`,
    references: (symbol, path) => `references:${JSON.stringify([symbol, path ?? null])}`,
    incoming: (path) => `incoming:${JSON.stringify(path)}`,
    coverage: (kind, path) => `coverage:${JSON.stringify([kind, path ?? null])}`,
    origin: 'origins',
};
/** One shared structural graph: immutable postings reuse unchanged source contributions. */
export class StructuralIndex {
    revision;
    facts;
    files;
    references;
    incoming;
    capability;
    accounted;
    constructor(facts = new ValueIndexTable(), files = new ValueIndexTable(), references = new ValueIndexTable(), incoming = new ValueIndexTable(), capability = complete, revision, accounted = new ValueIndexTable()) {
        this.facts = facts;
        this.files = files;
        this.references = references;
        this.incoming = incoming;
        this.capability = capability;
        this.accounted = accounted;
        this.revision = revision ?? { token: {}, selection: 'typescript.structure/v1', changed: new Set() };
    }
    update(upserts, deletes, capabilities) {
        const facts = this.facts.edit(), files = this.files.edit(), references = this.references.edit(), incoming = this.incoming.edit();
        const accounted = this.accounted.edit();
        const affected = new Set(), changed = new Set(), removed = new Set(deletes);
        const additions = new Map();
        for (const id of deletes) {
            const before = facts.get(id);
            if (before) {
                affected.add(before.payload.logicalPath);
                facts.delete(id);
            }
        }
        for (const fact of upserts) {
            const path = fact.payload.logicalPath;
            if (additions.has(path) && additions.get(path).id !== fact.id)
                throw new Error(`Duplicate structural source ownership: ${path}`);
            const old = this.files.get(path);
            if (old && old.id !== fact.id && !removed.has(old.id))
                throw new Error(`Duplicate structural source ownership: ${path}`);
            additions.set(path, fact);
            affected.add(path);
            facts.set(fact.id, fact);
        }
        for (const path of affected) {
            const before = this.files.get(path);
            const after = additions.get(path) ?? (before && !removed.has(before.id) ? before : undefined);
            if (before === after)
                continue;
            changed.add(structuralKey.file(path));
            if (!before || !after) {
                changed.add(structuralKey.path(path));
                changed.add(structuralKey.paths);
            }
            for (const kind of ['exports', 'references', 'dependencies']) {
                if (stableJson(before?.payload.completeness[kind]) !== stableJson(after?.payload.completeness[kind])) {
                    changed.add(structuralKey.coverage(kind, path));
                    changed.add(structuralKey.coverage(kind));
                }
            }
            if (stableJson(before?.payload.symbols) !== stableJson(after?.payload.symbols))
                changed.add(structuralKey.origin);
            for (const [file, increment] of [[before, -1], [after, 1]])
                if (file) {
                    // Only dimension-attributed reasons can be scoped away. Additional
                    // provider/envelope uncertainty must remain visible to every selection.
                    for (const coverage of Object.values(file.payload.completeness))
                        if (coverage.kind !== 'complete') {
                            for (const reason of coverage.reasons) {
                                const key = stableJson(reason), count = (accounted.get(key) ?? 0) + increment;
                                if (count)
                                    accounted.set(key, count);
                                else
                                    accounted.delete(key);
                            }
                        }
                }
            const oldSymbols = new Set(before?.payload.references.flatMap((reference) => reference.symbol ? [reference.symbol] : []) ?? []);
            const newReferences = new Map();
            if (after)
                for (const reference of after.payload.references)
                    if (reference.symbol) {
                        let group = newReferences.get(reference.symbol);
                        if (!group)
                            newReferences.set(reference.symbol, (group = []));
                        group.push({ file: after, reference });
                    }
            for (const symbol of new Set([...oldSymbols, ...newReferences.keys()])) {
                const posting = (references.get(symbol) ?? new ValueIndexTable()).edit();
                const added = newReferences.get(symbol);
                if (added)
                    posting.set(path, added);
                else
                    posting.delete(path);
                const next = posting.finish();
                if (next.size)
                    references.set(symbol, next);
                else
                    references.delete(symbol);
                changed.add(structuralKey.references(symbol));
                changed.add(structuralKey.references(symbol, path));
            }
            const oldTargets = new Set(before?.payload.dependencies.flatMap((dependency) => dependency.targetPath ? [dependency.targetPath] : []) ?? []);
            const newDependencies = new Map();
            if (after)
                for (const dependency of after.payload.dependencies)
                    if (dependency.targetPath) {
                        let group = newDependencies.get(dependency.targetPath);
                        if (!group)
                            newDependencies.set(dependency.targetPath, (group = []));
                        group.push({ file: after, dependency });
                    }
            for (const target of new Set([...oldTargets, ...newDependencies.keys()])) {
                const posting = (incoming.get(target) ?? new ValueIndexTable()).edit();
                const added = newDependencies.get(target);
                if (added)
                    posting.set(path, added);
                else
                    posting.delete(path);
                const next = posting.finish();
                if (next.size)
                    incoming.set(target, next);
                else
                    incoming.delete(target);
                changed.add(structuralKey.incoming(target));
            }
            if (after)
                files.set(path, after);
            else
                files.delete(path);
        }
        const nextAccounted = accounted.finish();
        const capability = residualCapability(capabilities, nextAccounted);
        if (stableJson(this.capability) !== stableJson(capability))
            changed.add(structuralKey.capability);
        return new StructuralIndex(facts.finish(), files.finish(), references.finish(), incoming.finish(), capability, { token: {}, parent: this.revision.token, selection: 'typescript.structure/v1', changed }, nextAccounted);
    }
}
function residualCapability(capabilities, accounted) {
    const capability = capabilities.find((entry) => entry.capability === 'typescript.structure')?.completeness;
    if (!capability)
        return { kind: 'unavailable', reasons: [{ code: 'TYPESCRIPT_STRUCTURE_UNAVAILABLE',
                    message: 'Request the typescript.structure capability to inspect static references and dependencies.', retryable: false }] };
    if (capability.kind === 'complete')
        return capability;
    const reasons = capability.reasons.filter((reason) => !accounted.has(stableJson(reason)));
    return reasons.length ? { ...capability, reasons } : complete;
}
/** Retains the current graph and explicitly pinned readers, never an unbounded revision chain. */
export class StructuralIndexOwner {
    #records = new Map();
    #current;
    #closed = false;
    committed(transaction) {
        if (this.#closed)
            return;
        const previous = this.#current, follows = previous?.generation === transaction.base;
        const catalogue = (follows ? previous?.shards : undefined)?.edit() ?? new ValueIndexTable().edit();
        const replaced = new Set([...transaction.deletes, ...transaction.upserts.map((shard) => shard.key)]);
        if (follows)
            for (const key of replaced)
                catalogue.delete(key);
        for (const shard of transaction.upserts)
            if (shard.namespace === 'typescript.structure')
                catalogue.set(shard.key, {
                    digest: shard.digest, facts: Object.freeze(shard.facts.map((fact) => fact.id)),
                });
        const shards = catalogue.finish();
        const complete = follows && previous?.shards !== undefined || transaction.manifest.every((entry) => {
            if (entry.namespace !== 'typescript.structure')
                return true;
            const shard = shards.get(entry.key);
            return shard?.digest === entry.digest && shard.facts.length === entry.facts;
        });
        const base = complete && previous?.shards ? previous.pending ? { index: previous.pending, shards: previous.shards } : previous.base : undefined;
        const changes = (base && follows && !previous?.pending ? previous?.changed : undefined)?.edit() ?? new ValueIndexTable().edit();
        if (base)
            for (const key of follows ? replaced : new Set([...base.shards.keys(), ...shards.keys()])) {
                const before = base.shards.get(key), after = shards.get(key);
                if (before?.digest === after?.digest)
                    changes.delete(key);
                else
                    changes.set(key, after);
            }
        const record = { generation: transaction.next.id, ...(complete ? { shards } : {}), base, changed: changes.finish(), leases: 0 };
        this.#current = record;
        this.#records.set(record.generation, record);
        if (previous && !previous.leases && previous.generation !== record.generation)
            this.#records.delete(previous.generation);
    }
    acquire(query) {
        let pinned = query;
        let record = this.#records.get(query.generation.id);
        if (!record) {
            record = { generation: query.generation.id, changed: new ValueIndexTable(), leases: 0 };
            if (!this.#closed)
                this.#records.set(record.generation, record);
        }
        record.leases++;
        return {
            load: () => {
                const active = record, selected = pinned;
                if (!active || !selected)
                    return Promise.reject(new Error('Structural snapshot lease is released.'));
                return active.pending ??= this.load(active, selected).catch((error) => { active.pending = undefined; throw error; });
            },
            release: () => {
                if (!record)
                    return;
                const previous = record;
                record = undefined;
                pinned = undefined;
                previous.leases--;
                if (!previous.leases && previous !== this.#current && this.#records.get(previous.generation) === previous)
                    this.#records.delete(previous.generation);
            },
        };
    }
    close() { this.#closed = true; this.#current = undefined; this.#records.clear(); }
    async load(record, query) {
        const reader = createTypeScriptFactReader(query), base = record.base;
        const index = await base?.index.catch(() => undefined);
        const ids = [], deleted = [];
        if (index && base)
            for (const [key, shard] of record.changed) {
                deleted.push(...base.shards.get(key)?.facts ?? []);
                if (shard)
                    ids.push(...shard.facts);
            }
        const capabilities = await query.capabilities();
        let facts;
        if (index && base) {
            facts = await reader.factsById('structure', ids);
            if (facts.length !== ids.length)
                throw new Error('A committed structural source is missing in its pinned query.');
        }
        else {
            const collected = [];
            for await (const fact of reader.export('structure'))
                collected.push(fact);
            facts = collected;
        }
        const next = (index ?? new StructuralIndex()).update(facts, deleted, capabilities);
        record.base = undefined;
        record.changed = new ValueIndexTable();
        return next;
    }
}
