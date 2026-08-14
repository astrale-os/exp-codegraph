import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  deriveAnalysisId,
  factShardDigest,
  generationIdentity,
  shardReference,
  type AnalysisGenerationId,
  type AnalysisStore,
  type Fact,
  type FactTransaction,
  type ProducerIdentity,
  type ProjectUniverseId,
  type SourceId,
  type SourceManifestId,
  type SourceRevisionId,
} from '../../../analysis/index.ts'
import { createMemoryAnalysisStore } from '../../../analysis/memory/index.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const evidencePath = resolve(repositoryRoot, '.history/v2/evidence/sqlite-qualification.json')
const writeEvidence = process.argv.includes('--write')
const repositoryInventory = deriveAnalysisId(
  'source-manifest',
  'astrale.typespec.sqlite-qualification.inventory',
  { fixture: 'normalized-churn' },
)
const producer: ProducerIdentity = {
  id: deriveAnalysisId('producer', 'sqlite-qualification', {
    name: 'qualification',
    version: 1,
  }),
  name: 'sqlite-qualification',
  version: '1.0.0',
  protocolVersion: 1,
}

interface LogicalFile {
  readonly value: string
  readonly revision: string
}

type LogicalState = ReadonlyMap<string, LogicalFile>

interface Step {
  readonly operation: string
  readonly transaction: FactTransaction
}

async function main(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-typespec-v2-sqlite-qualification-'))
  try {
    const incrementalFile = join(temporary, 'incremental.sqlite')
    const coldFile = join(temporary, 'cold.sqlite')
    const memory = createMemoryAnalysisStore({ maximumRetainedGenerations: 8 })
    const incremental = await createSQLiteAnalysisStore({
      file: incrementalFile,
      namespace: 'qualification',
      maximumRetainedGenerations: 8,
    })
    const cold = await createSQLiteAnalysisStore({
      file: coldFile,
      namespace: 'qualification',
      maximumRetainedGenerations: 2,
    })
    try {
      const primaryUniverse = universe('tsconfig.json', '@sdk/* -> src/sdk/*')
      const configuredUniverse = universe('tsconfig.json', '@sdk/* -> src/fake/*')
      const primary = primarySteps(primaryUniverse)
      const configuredState = state([
        ['src/a.ts', { value: 'a-branch', revision: '5' }],
        ['src/e.ts', { value: 'e-created', revision: '1' }],
        ['tsconfig.json', { value: '@sdk/* -> src/fake/*', revision: '2' }],
      ])
      const configured = transaction({
        universe: configuredUniverse,
        state: configuredState,
        sequence: 1,
        revision: 'config-v2',
        upserts: [...configuredState.keys()],
        deletes: [],
      })
      const steps = [...primary.steps, { operation: 'config-change', transaction: configured }]
      const timings: { readonly operation: string; readonly elapsedMs: number }[] = []
      for (const step of steps) {
        const started = performance.now()
        await incremental.commit(step.transaction)
        timings.push({
          operation: step.operation,
          elapsedMs: round(performance.now() - started),
        })
        await memory.commit(step.transaction)
      }

      const primaryCold = transaction({
        universe: primaryUniverse,
        state: primary.finalState,
        sequence: 1,
        revision: 'branch-like',
        upserts: [...primary.finalState.keys()],
        deletes: [],
      })
      await cold.commit(primaryCold)
      await cold.commit(configured)

      const primaryIncremental = await semanticSnapshot(incremental, primaryUniverse)
      const primaryMemory = await semanticSnapshot(memory, primaryUniverse)
      const primaryClean = await semanticSnapshot(cold, primaryUniverse)
      const configuredIncremental = await semanticSnapshot(incremental, configuredUniverse)
      const configuredMemory = await semanticSnapshot(memory, configuredUniverse)
      const configuredClean = await semanticSnapshot(cold, configuredUniverse)
      const primaryEqual =
        stable(primaryIncremental) === stable(primaryMemory) &&
        stable(primaryIncremental) === stable(primaryClean)
      const configuredEqual =
        stable(configuredIncremental) === stable(configuredMemory) &&
        stable(configuredIncremental) === stable(configuredClean)
      if (!primaryEqual || !configuredEqual) {
        throw new Error('Normalized incremental, memory, and cold materializations diverged.')
      }

      const generations = new Map([
        [primaryUniverse, primary.final.next.id],
        [configuredUniverse, configured.next.id],
      ])
      const set = await incremental.snapshotSet(generations, repositoryInventory)
      try {
        if (set.universes.length !== 2) {
          throw new Error('Atomic snapshot set omitted a configured universe.')
        }
      } finally {
        await set.dispose()
      }

      await cold.dispose()
      await incremental.dispose()
      await memory.dispose()
      const database = new DatabaseSync(incrementalFile, { readOnly: true })
      const schema = schemaEvidence(database)
      database.close()
      const evidence = {
        format: 'astrale.typespec.v2.sqlite-qualification',
        version: 1,
        status: 'qualified',
        operations: steps.map((step) => step.operation),
        equality: {
          normalizedIncrementalEqualsMemory: true,
          normalizedIncrementalEqualsCold: true,
          configUniverseEqualsCold: true,
          nonSemanticCommitMetadataExcluded: ['generation.sequence'],
        },
        snapshots: {
          primaryDigest: digest(primaryIncremental),
          configuredDigest: digest(configuredIncremental),
          primaryFacts: primaryIncremental.facts.length,
          configuredFacts: configuredIncremental.facts.length,
        },
        performance: {
          commits: timings,
          incrementalDatabaseBytes: (await stat(incrementalFile)).size,
          coldDatabaseBytes: (await stat(coldFile)).size,
        },
        schema,
        provenance: {
          codegraphSourceRevision: '11475e7c0f36fd3fcb482dd3ea65f6d5845049b3',
          copiedSourceFiles: 0,
          adoptedPatterns: [
            'normalized compound indexes',
            'bounded parameterized query pages',
            'purge-oriented churn cases',
            'incremental versus cold normalization',
          ],
        },
      }
      if (writeEvidence) {
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
      }
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    } finally {
      await Promise.allSettled([memory.dispose(), incremental.dispose(), cold.dispose()])
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function primarySteps(universeId: ProjectUniverseId): {
  readonly steps: readonly Step[]
  readonly final: FactTransaction
  readonly finalState: LogicalState
} {
  const baseline = state([
    ['src/a.ts', { value: 'a', revision: '1' }],
    ['src/b.ts', { value: 'b', revision: '1' }],
    ['tsconfig.json', { value: '@sdk/* -> src/sdk/*', revision: '1' }],
  ])
  const edited = update(baseline, 'src/a.ts', { value: 'a-edited', revision: '2' })
  const created = update(edited, 'src/c.ts', { value: 'c-created', revision: '1' })
  const renamed = update(without(created, 'src/b.ts'), 'src/d.ts', {
    value: 'b',
    revision: '1',
  })
  const deleted = without(renamed, 'src/c.ts')
  const branch = update(without(deleted, 'src/d.ts'), 'src/e.ts', {
    value: 'e-created',
    revision: '1',
  })
  const finalState = update(branch, 'src/a.ts', { value: 'a-branch', revision: '5' })
  let base: AnalysisGenerationId | undefined
  const build = (
    operation: string,
    value: LogicalState,
    sequence: number,
    revision: string,
    upserts: readonly string[],
    deletes: readonly string[],
  ): Step => {
    const next = transaction({
      universe: universeId,
      state: value,
      sequence,
      revision,
      base,
      upserts,
      deletes,
    })
    base = next.next.id
    return { operation, transaction: next }
  }
  const steps = [
    build('baseline', baseline, 1, 'baseline', [...baseline.keys()], []),
    build('edit', edited, 2, 'edit', ['src/a.ts'], []),
    build('create', created, 3, 'create', ['src/c.ts'], []),
    build('rename', renamed, 4, 'rename', ['src/d.ts'], ['src/b.ts']),
    build('delete', deleted, 5, 'delete', [], ['src/c.ts']),
    build('branch-like', finalState, 6, 'branch-like', ['src/a.ts', 'src/e.ts'], ['src/d.ts']),
  ]
  return { steps, final: steps.at(-1)!.transaction, finalState }
}

function transaction(options: {
  readonly universe: ProjectUniverseId
  readonly state: LogicalState
  readonly sequence: number
  readonly revision: string
  readonly base?: AnalysisGenerationId
  readonly upserts: readonly string[]
  readonly deletes: readonly string[]
}): FactTransaction {
  const pending = deriveAnalysisId('generation', 'sqlite-qualification-pending', {
    sequence: options.sequence,
  })
  const shards = new Map(
    [...options.state].map(([path, file]) => {
      const source = deriveAnalysisId('source', 'sqlite-qualification', { path }) as SourceId
      const revision = deriveAnalysisId('source-revision', source, {
        revision: file.revision,
      }) as SourceRevisionId
      const namespace = 'astrale.qualification.file'
      const fact: Fact = {
        id: deriveAnalysisId('fact', namespace, { path, value: file.value }),
        generation: pending,
        namespace,
        schemaVersion: 1,
        kind: path === 'tsconfig.json' ? 'configuration' : 'source',
        subject: path,
        completeness: { kind: 'complete' },
        provenance: {
          pass: deriveAnalysisId('pass', namespace, { name: 'fixture' }),
          passVersion: '1.0.0',
          evidence: [{ source, revision, start: 0, end: Math.max(1, file.value.length) }],
          inputs: [],
        },
        payload: { path, value: file.value },
      }
      const draft = {
        key: deriveAnalysisId('fact-shard-key', namespace, { path }),
        namespace,
        schemaVersion: 1,
        completion: { kind: 'complete' as const },
        facts: [fact],
      }
      return [path, { ...draft, digest: factShardDigest(draft) }] as const
    }),
  )
  const manifest = [...shards.values()].map(shardReference).sort(byKey)
  const sourceManifest = deriveAnalysisId('source-manifest', 'sqlite-qualification', {
    revision: options.revision,
    files: [...options.state.keys()],
  }) as SourceManifestId
  const id = generationIdentity(
    {
      universe: options.universe,
      producer,
      sourceManifest,
      capabilities: ['astrale.qualification.file'],
    },
    manifest,
  )
  const upsertSet = new Set(options.upserts)
  return {
    protocolVersion: 1,
    ...(options.base ? { base: options.base } : {}),
    next: {
      id,
      sequence: options.sequence,
      universe: options.universe,
      producer,
      sourceManifest,
      capabilities: ['astrale.qualification.file'],
    },
    manifest,
    upserts: [...shards]
      .filter(([path]) => upsertSet.has(path))
      .map(([, shard]) => ({
        ...shard,
        facts: shard.facts.map((fact) => ({ ...fact, generation: id })),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    deletes: options.deletes
      .map((path) => deriveAnalysisId('fact-shard-key', 'astrale.qualification.file', { path }))
      .sort(),
  }
}

async function semanticSnapshot(store: AnalysisStore, universeId: ProjectUniverseId) {
  const query = await store.open(universeId)
  try {
    const facts = []
    for await (const fact of query.export()) facts.push(fact)
    return {
      generation: {
        id: query.generation.id,
        universe: query.generation.universe,
        producer: query.generation.producer,
        sourceManifest: query.generation.sourceManifest,
        capabilities: query.generation.capabilities,
      },
      manifest: await query.manifest(),
      capabilities: await query.capabilities(),
      facts,
    }
  } finally {
    await query.dispose()
  }
}

function schemaEvidence(database: DatabaseSync) {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'analysis_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => (row as { readonly name: string }).name)
  const generationColumns = database
    .prepare('PRAGMA table_info(analysis_generations)')
    .all()
    .map((row) => (row as { readonly name: string }).name)
  return {
    userVersion: (
      database.prepare('PRAGMA user_version').get() as { readonly user_version: number }
    ).user_version,
    tables,
    generationColumns,
    wholeGenerationSnapshotJson: generationColumns.includes('snapshot_json'),
    counts: Object.fromEntries(
      tables.map((table) => [
        table,
        (
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            readonly count: number
          }
        ).count,
      ]),
    ),
  }
}

function universe(config: string, alias: string): ProjectUniverseId {
  return deriveAnalysisId('project-universe', 'sqlite-qualification', {
    config,
    alias,
  })
}

function state(entries: readonly (readonly [string, LogicalFile])[]): LogicalState {
  return new Map(entries)
}

function update(value: LogicalState, path: string, file: LogicalFile): LogicalState {
  return new Map([...value, [path, file]])
}

function without(value: LogicalState, path: string): LogicalState {
  const next = new Map(value)
  next.delete(path)
  return next
}

function stable(value: unknown): string {
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex')
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function byKey(left: { readonly key: string }, right: { readonly key: string }): number {
  return left.key.localeCompare(right.key)
}

await main()
