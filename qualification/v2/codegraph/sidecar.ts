import { DatabaseSync } from 'node:sqlite'

export interface SidecarProbe {
  readonly namespaces: readonly string[]
  readonly versions: readonly number[]
  readonly pinnedGenerationPayload: unknown
  readonly currentGenerationPayload: unknown
}

/**
 * Prove what can be layered beside Codegraph without claiming that Codegraph
 * owns or queries these tables. This deliberately exercises the minimum
 * normalized schema V2 would still have to implement itself.
 */
export function installSidecarProbe(file: string): SidecarProbe {
  const database = new DatabaseSync(file)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS astrale_fact_generations (
        namespace TEXT NOT NULL,
        universe TEXT NOT NULL,
        generation TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        current INTEGER NOT NULL CHECK (current IN (0, 1)),
        PRIMARY KEY (namespace, universe, sequence)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS astrale_fact_current
        ON astrale_fact_generations(namespace, universe)
        WHERE current = 1;
      CREATE TABLE IF NOT EXISTS astrale_facts (
        namespace TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        universe TEXT NOT NULL,
        generation TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        completeness TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (namespace, universe, generation, fact_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS astrale_facts_subject
        ON astrale_facts(namespace, schema_version, kind, subject);
    `)
    const insertGeneration = database.prepare(
      `INSERT INTO astrale_fact_generations
        (namespace, universe, generation, sequence, current)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const insertFact = database.prepare(
      `INSERT INTO astrale_facts
        (namespace, schema_version, universe, generation, fact_id, kind, subject,
         completeness, provenance_json, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    database.exec('BEGIN IMMEDIATE')
    try {
      insertGeneration.run('astrale.typescript.symbol', 'fixture', 'generation-1', 1, 0)
      insertFact.run(
        'astrale.typescript.symbol',
        1,
        'fixture',
        'generation-1',
        'symbol-1',
        'symbol',
        'ts:src/sdk/builder.ts#defineMutation',
        'complete',
        JSON.stringify({
          pass: 'ttsc.native',
          evidence: [{ source: 'src/sdk/builder.ts', start: 0, end: 1 }],
        }),
        JSON.stringify({
          name: 'defineMutation',
          identity: 'ts:src/sdk/builder.ts#defineMutation',
        }),
      )
      insertGeneration.run('astrale.typescript.symbol', 'fixture', 'generation-2', 2, 1)
      insertFact.run(
        'astrale.typescript.symbol',
        2,
        'fixture',
        'generation-2',
        'symbol-1',
        'symbol',
        'ts:src/sdk/builder.ts#defineMutation',
        'partial',
        JSON.stringify({ pass: 'ttsc.native.v2', evidence: [] }),
        JSON.stringify({ name: 'defineMutation', revision: 2 }),
      )
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return readProbe(database)
  } finally {
    database.close()
  }
}

export function readSidecarProbe(file: string): SidecarProbe {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    return readProbe(database)
  } finally {
    database.close()
  }
}

function readProbe(database: DatabaseSync): SidecarProbe {
  const facts = database
    .prepare(
      `SELECT namespace, schema_version, generation, payload_json
       FROM astrale_facts
       ORDER BY generation`,
    )
    .all() as {
    readonly namespace: string
    readonly schema_version: number
    readonly generation: string
    readonly payload_json: string
  }[]
  const current = database
    .prepare(
      `SELECT fact.payload_json
       FROM astrale_fact_generations AS generation
       JOIN astrale_facts AS fact
         ON fact.namespace = generation.namespace
        AND fact.universe = generation.universe
        AND fact.generation = generation.generation
       WHERE generation.current = 1`,
    )
    .get() as { readonly payload_json: string }
  return {
    namespaces: [...new Set(facts.map((fact) => fact.namespace))],
    versions: [...new Set(facts.map((fact) => fact.schema_version))].sort(
      (left, right) => left - right,
    ),
    pinnedGenerationPayload: JSON.parse(
      facts.find((fact) => fact.generation === 'generation-1')!.payload_json,
    ),
    currentGenerationPayload: JSON.parse(current.payload_json),
  }
}
