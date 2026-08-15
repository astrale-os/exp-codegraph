export const SQLITE_ANALYSIS_SCHEMA_VERSION = 7;
/**
 * Durable rows are split between immutable generation metadata, reusable
 * content-addressed shards, and generation-to-shard membership. JSON is kept
 * only for open-ended value envelopes; no complete generation is serialized
 * into one database value.
 */
export const SQLITE_ANALYSIS_SCHEMA = `
CREATE TABLE IF NOT EXISTS analysis_generations (
  store_namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  producer_id TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  producer_version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  source_manifest TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  PRIMARY KEY (store_namespace, universe, sequence)
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_generations_by_id
  ON analysis_generations(store_namespace, universe, generation_id, sequence DESC);

CREATE TABLE IF NOT EXISTS analysis_current (
  store_namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_sequence INTEGER NOT NULL,
  PRIMARY KEY (store_namespace, universe),
  FOREIGN KEY (store_namespace, universe, generation_sequence)
    REFERENCES analysis_generations(store_namespace, universe, sequence)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS analysis_leases (
  store_namespace TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_sequence INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (store_namespace, lease_id),
  FOREIGN KEY (store_namespace, universe, generation_sequence)
    REFERENCES analysis_generations(store_namespace, universe, sequence)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_leases_by_generation
  ON analysis_leases(store_namespace, universe, generation_sequence, expires_at);

CREATE TABLE IF NOT EXISTS analysis_shards (
  store_namespace TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  shard_key TEXT NOT NULL,
  fact_namespace TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  completion_kind TEXT NOT NULL,
  completion_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  fact_count INTEGER NOT NULL,
  payload_layout TEXT NOT NULL,
  PRIMARY KEY (store_namespace, shard_digest)
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_shards_by_key
  ON analysis_shards(store_namespace, shard_key, shard_digest);

CREATE TABLE IF NOT EXISTS analysis_generation_shards (
  store_namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_sequence INTEGER NOT NULL,
  shard_key TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  PRIMARY KEY (store_namespace, universe, generation_sequence, shard_key),
  FOREIGN KEY (store_namespace, universe, generation_sequence)
    REFERENCES analysis_generations(store_namespace, universe, sequence)
    ON DELETE CASCADE,
  FOREIGN KEY (store_namespace, shard_digest)
    REFERENCES analysis_shards(store_namespace, shard_digest)
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_generation_shards_by_digest
  ON analysis_generation_shards(store_namespace, shard_digest);

CREATE TABLE IF NOT EXISTS analysis_facts (
  store_namespace TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  fact_namespace TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  completeness_kind TEXT NOT NULL,
  completeness_json TEXT NOT NULL,
  pass_id TEXT NOT NULL,
  pass_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (store_namespace, shard_digest, fact_id),
  FOREIGN KEY (store_namespace, shard_digest)
    REFERENCES analysis_shards(store_namespace, shard_digest)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_facts_by_id
  ON analysis_facts(store_namespace, fact_id);
CREATE INDEX IF NOT EXISTS analysis_facts_by_namespace_kind
  ON analysis_facts(store_namespace, fact_namespace, kind, fact_id);
CREATE INDEX IF NOT EXISTS analysis_facts_by_subject
  ON analysis_facts(store_namespace, subject, fact_id);
CREATE INDEX IF NOT EXISTS analysis_facts_by_completeness
  ON analysis_facts(store_namespace, completeness_kind, fact_id);
CREATE TABLE IF NOT EXISTS analysis_shard_payloads (
  store_namespace TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  encoding TEXT NOT NULL,
  payloads_blob BLOB NOT NULL,
  PRIMARY KEY (store_namespace, shard_digest),
  FOREIGN KEY (store_namespace, shard_digest)
    REFERENCES analysis_shards(store_namespace, shard_digest)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS analysis_fact_evidence (
  store_namespace TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  PRIMARY KEY (store_namespace, shard_digest, fact_id, ordinal),
  FOREIGN KEY (store_namespace, shard_digest, fact_id)
    REFERENCES analysis_facts(store_namespace, shard_digest, fact_id)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_fact_evidence_by_source
  ON analysis_fact_evidence(store_namespace, source_id, fact_id);

CREATE TABLE IF NOT EXISTS analysis_fact_inputs (
  store_namespace TEXT NOT NULL,
  shard_digest TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  input_fact_id TEXT NOT NULL,
  PRIMARY KEY (store_namespace, shard_digest, fact_id, ordinal),
  FOREIGN KEY (store_namespace, shard_digest, fact_id)
    REFERENCES analysis_facts(store_namespace, shard_digest, fact_id)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS analysis_fact_inputs_by_input
  ON analysis_fact_inputs(store_namespace, input_fact_id, fact_id);

CREATE TABLE IF NOT EXISTS analysis_quarantine (
  quarantine_id TEXT NOT NULL PRIMARY KEY,
  store_namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  generation_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  quarantined_at INTEGER NOT NULL
) STRICT;
`;
//# sourceMappingURL=schema.js.map