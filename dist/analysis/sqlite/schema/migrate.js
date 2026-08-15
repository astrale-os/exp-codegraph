import { parseMaterialized } from '../../internal/state.js';
import { writeMaterializedGeneration } from '../materialization/write.js';
import { SQLITE_ANALYSIS_SCHEMA, SQLITE_ANALYSIS_SCHEMA_VERSION } from './schema.js';
export function migrateSQLiteAnalysisSchema(database) {
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (version === 0) {
        database.exec(SQLITE_ANALYSIS_SCHEMA);
        database.exec(`PRAGMA user_version = ${SQLITE_ANALYSIS_SCHEMA_VERSION}`);
        return;
    }
    if (version === SQLITE_ANALYSIS_SCHEMA_VERSION) {
        database.exec(SQLITE_ANALYSIS_SCHEMA);
        return;
    }
    if (version === 4 || version === 5 || version === 6) {
        migratePayloadLayout(database);
        return;
    }
    if (version === 3) {
        migrateShardCapabilities(database);
        return;
    }
    if (version === 1 || version === 2) {
        migrateSnapshotJsonSchema(database);
        return;
    }
    throw new Error(`Unsupported analysis SQLite schema ${version}.`);
}
/** Add the optional capability-to-output completeness mapping without rewriting fact data. */
function migrateShardCapabilities(database) {
    database.exec('BEGIN IMMEDIATE');
    try {
        database.exec("ALTER TABLE analysis_shards ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'");
        database.exec('PRAGMA user_version = 4');
        database.exec('COMMIT');
    }
    catch (error) {
        if (database.isTransaction)
            database.exec('ROLLBACK');
        throw error;
    }
    migratePayloadLayout(database);
}
function migratePayloadLayout(database) {
    database.exec(SQLITE_ANALYSIS_SCHEMA);
    database.exec('BEGIN IMMEDIATE');
    try {
        const columns = database.prepare('PRAGMA table_info(analysis_shards)').all();
        if (!columns.some((column) => column.name === 'payload_layout')) {
            database.exec("ALTER TABLE analysis_shards ADD COLUMN payload_layout TEXT NOT NULL DEFAULT 'inline-json/1'");
        }
        database.exec(`
UPDATE analysis_shards
SET payload_layout = 'shard-ordinal/1'
WHERE EXISTS (
  SELECT 1 FROM analysis_shard_payloads AS payload
  WHERE payload.store_namespace = analysis_shards.store_namespace
    AND payload.shard_digest = analysis_shards.shard_digest
);
PRAGMA user_version = ${SQLITE_ANALYSIS_SCHEMA_VERSION};
`);
        database.exec('COMMIT');
    }
    catch (error) {
        if (database.isTransaction)
            database.exec('ROLLBACK');
        throw error;
    }
    database.exec(SQLITE_ANALYSIS_SCHEMA);
}
function migrateSnapshotJsonSchema(database) {
    const generations = database
        .prepare(`SELECT namespace, universe, generation_id, sequence, snapshot_json
       FROM analysis_generations
       ORDER BY namespace, universe, sequence`)
        .all();
    const current = database
        .prepare('SELECT * FROM analysis_current')
        .all();
    const leases = database
        .prepare('SELECT * FROM analysis_leases')
        .all();
    const materialized = generations.map((row) => ({
        row,
        value: parseMaterialized(row.snapshot_json),
    }));
    const sequenceByIdentity = new Map(generations.map((row) => [
        legacyIdentity(row.namespace, row.universe, row.generation_id),
        row.sequence,
    ]));
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('BEGIN IMMEDIATE');
    try {
        renameIfPresent(database, 'analysis_quarantine', 'analysis_quarantine_snapshot_json');
        database.exec(`
ALTER TABLE analysis_leases RENAME TO analysis_leases_snapshot_json;
ALTER TABLE analysis_current RENAME TO analysis_current_snapshot_json;
ALTER TABLE analysis_generations RENAME TO analysis_generations_snapshot_json;
${SQLITE_ANALYSIS_SCHEMA}
`);
        for (const entry of materialized) {
            assertLegacyEnvelope(entry.row, entry.value);
            writeMaterializedGeneration(database, entry.row.namespace, entry.value);
        }
        const currentStatement = database.prepare(`INSERT INTO analysis_current
        (store_namespace, universe, generation_sequence)
       VALUES (?, ?, ?)`);
        for (const row of current) {
            currentStatement.run(row.namespace, row.universe, row.generation_sequence ??
                requiredSequence(sequenceByIdentity, row.namespace, row.universe, row.generation_id));
        }
        const leaseStatement = database.prepare(`INSERT INTO analysis_leases
        (store_namespace, lease_id, universe, generation_sequence, expires_at)
       VALUES (?, ?, ?, ?, ?)`);
        for (const row of leases) {
            leaseStatement.run(row.namespace, row.lease_id, row.universe, row.generation_sequence ??
                requiredSequence(sequenceByIdentity, row.namespace, row.universe, row.generation_id), row.expires_at);
        }
        database.exec(`
DROP TABLE analysis_leases_snapshot_json;
DROP TABLE analysis_current_snapshot_json;
DROP TABLE analysis_generations_snapshot_json;
DROP TABLE IF EXISTS analysis_quarantine_snapshot_json;
PRAGMA user_version = ${SQLITE_ANALYSIS_SCHEMA_VERSION};
`);
        database.exec('COMMIT');
    }
    catch (error) {
        if (database.isTransaction)
            database.exec('ROLLBACK');
        throw error;
    }
    finally {
        database.exec('PRAGMA foreign_keys = ON');
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) {
        throw new Error(`Analysis SQLite migration violated foreign keys: ${JSON.stringify(violations)}`);
    }
}
function renameIfPresent(database, from, to) {
    const exists = database
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(from);
    if (exists)
        database.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
}
function requiredSequence(sequences, namespace, universe, generation) {
    const sequence = sequences.get(legacyIdentity(namespace, universe, generation));
    if (sequence === undefined) {
        throw new Error(`Legacy analysis pointer names an unavailable generation ${generation}.`);
    }
    return sequence;
}
function legacyIdentity(namespace, universe, generation) {
    return `${namespace}\0${universe}\0${generation}`;
}
function assertLegacyEnvelope(row, value) {
    if (value.generation.id !== row.generation_id ||
        value.generation.sequence !== row.sequence ||
        value.generation.universe !== row.universe) {
        throw new Error('Legacy stored generation columns disagree with snapshot payload.');
    }
}
//# sourceMappingURL=migrate.js.map