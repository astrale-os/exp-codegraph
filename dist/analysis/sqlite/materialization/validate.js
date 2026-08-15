import { shardReference } from '../../facts/index.js';
import { TransactionError, validateFactTransaction, } from '../../generation/index.js';
import { stableJson } from '../../identity/model.js';
import { loadCurrentGeneration, loadManifest } from './read.js';
/**
 * Recheck only the causal base after acquiring the writer lock. The complete
 * transaction was admitted synchronously immediately before BEGIN IMMEDIATE;
 * immutable shards cannot change while this connection waits for that lock.
 */
export function validateSQLiteTransactionBase(database, storeNamespace, transaction, expectedCurrentSequence) {
    const current = loadCurrentGeneration(database, storeNamespace, transaction.next.universe);
    if (current?.id !== transaction.base ||
        current?.sequence !== expectedCurrentSequence ||
        transaction.next.sequence !== (current?.sequence ?? 0) + 1) {
        throw new TransactionError('BASE_STALE', `BASE_STALE:expected=${transaction.base ?? '<none>'}:actual=${current?.id ?? '<none>'}`);
    }
}
/**
 * Validate a delta against indexed current membership. Unchanged shards are
 * never inflated into one in-memory snapshot.
 */
export function validateSQLiteTransaction(database, storeNamespace, transaction) {
    const current = loadCurrentGeneration(database, storeNamespace, transaction.next.universe);
    const diagnostics = [...validateFactTransaction(transaction, current?.id)];
    const expectedSequence = (current?.sequence ?? 0) + 1;
    if (transaction.next.sequence !== expectedSequence) {
        diagnostics.push(`GENERATION_SEQUENCE_STALE:expected=${expectedSequence}:actual=${transaction.next.sequence}`);
    }
    if (current && current.universe !== transaction.next.universe) {
        diagnostics.push('GENERATION_UNIVERSE_MISMATCH');
    }
    if (diagnostics.length)
        failValidation(diagnostics);
    const materialized = new Map(current
        ? loadManifest(database, storeNamespace, current.universe, current.sequence).map((entry) => [
            entry.key,
            entry,
        ])
        : []);
    for (const key of transaction.deletes) {
        if (!materialized.delete(key)) {
            throw new TransactionError('MANIFEST_INVALID', `Unknown delete ${key}.`);
        }
    }
    for (const shard of transaction.upserts) {
        materialized.set(shard.key, shardReference(shard));
    }
    const actual = [...materialized.values()].sort(byKey);
    if (stableJson(actual) !== stableJson(transaction.manifest)) {
        throw new TransactionError('MANIFEST_INVALID', 'The transaction manifest is not the complete materialized next generation.');
    }
    validateFactClosure(database, storeNamespace, transaction, current?.sequence);
    return { currentSequence: current?.sequence, manifest: actual };
}
function validateFactClosure(database, storeNamespace, transaction, currentSequence) {
    const replaced = [...new Set([
            ...transaction.deletes,
            ...transaction.upserts.map((shard) => shard.key),
        ])].sort();
    const facts = new Map();
    for (const shard of transaction.upserts) {
        for (const fact of shard.facts) {
            if (facts.has(fact.id)) {
                throw new TransactionError('SHARD_INVALID', `Fact identity ${fact.id} occurs in more than one materialized shard.`);
            }
            facts.set(fact.id, fact.provenance.inputs);
        }
    }
    if (currentSequence === undefined) {
        for (const [fact, inputs] of facts) {
            for (const input of inputs) {
                if (!facts.has(input))
                    unavailableInput(fact, input);
            }
        }
        return;
    }
    const externalInputs = new Set();
    for (const inputs of facts.values()) {
        for (const input of inputs) {
            if (!facts.has(input))
                externalInputs.add(input);
        }
    }
    const requested = [...new Set([...facts.keys(), ...externalInputs])];
    const available = new Set(database
        .prepare(`SELECT DISTINCT fact.fact_id
         FROM analysis_facts AS fact
         WHERE fact.store_namespace = ?
           AND fact.fact_id IN (SELECT value FROM json_each(?))
           AND EXISTS (
             SELECT 1
             FROM analysis_generation_shards AS member
             WHERE member.store_namespace = fact.store_namespace
               AND member.universe = ?
               AND member.generation_sequence = ?
               AND member.shard_digest = fact.shard_digest
               AND member.shard_key NOT IN (SELECT value FROM json_each(?))
           )`)
        .all(storeNamespace, JSON.stringify(requested), transaction.next.universe, currentSequence, JSON.stringify(replaced))
        .map((row) => row.fact_id));
    for (const [fact, inputs] of facts) {
        if (available.has(fact)) {
            throw new TransactionError('SHARD_INVALID', `Fact identity ${fact} occurs in more than one materialized shard.`);
        }
        for (const input of inputs) {
            if (!facts.has(input) && !available.has(input)) {
                unavailableInput(fact, input);
            }
        }
    }
    if (!replaced.length)
        return;
    const replacedFacts = database
        .prepare(`SELECT fact.fact_id
       FROM analysis_generation_shards AS member
       JOIN analysis_facts AS fact
         ON fact.store_namespace = member.store_namespace
        AND fact.shard_digest = member.shard_digest
       WHERE member.store_namespace = ?
         AND member.universe = ?
         AND member.generation_sequence = ?
         AND member.shard_key IN (SELECT value FROM json_each(?))`)
        .all(storeNamespace, transaction.next.universe, currentSequence, JSON.stringify(replaced));
    const removed = replacedFacts.map((row) => row.fact_id).filter((fact) => !facts.has(fact));
    if (!removed.length)
        return;
    const consumer = database
        .prepare(`SELECT input.fact_id, input.input_fact_id
       FROM analysis_fact_inputs AS input
       WHERE input.store_namespace = ?
         AND input.input_fact_id IN (SELECT value FROM json_each(?))
         AND EXISTS (
           SELECT 1
           FROM analysis_generation_shards AS member
           WHERE member.store_namespace = input.store_namespace
             AND member.universe = ?
             AND member.generation_sequence = ?
             AND member.shard_digest = input.shard_digest
             AND member.shard_key NOT IN (SELECT value FROM json_each(?))
         )
       ORDER BY input.fact_id, input.input_fact_id
       LIMIT 1`)
        .get(storeNamespace, JSON.stringify(removed), transaction.next.universe, currentSequence, JSON.stringify(replaced));
    if (consumer) {
        unavailableInput(consumer.fact_id, consumer.input_fact_id);
    }
}
function unavailableInput(fact, input) {
    throw new TransactionError('SHARD_INVALID', `Fact ${fact} names unavailable derivation input ${input}.`);
}
function failValidation(diagnostics) {
    const unique = [...new Set(diagnostics)].sort();
    const code = unique.includes('BASE_STALE') ? 'BASE_STALE' : 'TRANSACTION_ABORTED';
    throw new TransactionError(code, unique.join('\n'));
}
function byKey(left, right) {
    return left.key.localeCompare(right.key);
}
//# sourceMappingURL=validate.js.map