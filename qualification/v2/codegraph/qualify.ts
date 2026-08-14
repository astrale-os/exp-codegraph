import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import { normalizeCodegraph, tableCounts } from './normalize.ts'
import { installSidecarProbe, readSidecarProbe } from './sidecar.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const qualificationRoot = resolve(import.meta.dirname)
const fixtureSource = resolve(qualificationRoot, 'fixtures/adversarial')
const evidencePath = resolve(repositoryRoot, 'spec/.history/v2/evidence/codegraph-spike.json')
const installation = argument('--installation')
const writeEvidence = process.argv.includes('--write')
const retainFixture = process.argv.includes('--retain')

if (!installation) {
  throw new Error('Usage: qualify.ts --installation <Codegraph package or source root> [--write]')
}

interface CodegraphModule {
  readonly buildGraph: (
    root: string,
    options?: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly phases: Readonly<Record<string, number>> } | undefined>
  readonly queryNameData: (
    name: string,
    database: string,
    options?: { readonly noTests?: boolean; readonly limit?: number },
  ) => unknown
}

interface PackageMetadata {
  readonly exports?: Readonly<Record<string, unknown>>
}

async function main(): Promise<void> {
  const toolchain = JSON.parse(await readFile(resolve(qualificationRoot, 'toolchain.json'), 'utf8'))
  const packageJson = JSON.parse(await readFile(resolve(installation!, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, toolchain.package.name)
  assert.equal(packageJson.version, toolchain.package.version)
  assert.equal(packageJson.license, toolchain.package.license)

  const module = (await import(
    pathToFileURL(resolve(installation!, packageJson.main ?? 'dist/index.js')).href
  )) as CodegraphModule
  assert.equal(typeof module.buildGraph, 'function')
  assert.equal(typeof module.queryNameData, 'function')

  const source = await auditSource(installation!, packageJson, toolchain.schemaVersion)
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-typespec-v2-codegraph-'))
  const project = join(temporary, 'project')
  await cp(fixtureSource, project, { recursive: true })
  const database = join(project, '.qualification', 'live.db')
  const options = {
    dbPath: database,
    incremental: false,
    skipRegistry: true,
    userConfig: false,
    dataflow: true,
    ast: true,
    cfg: true,
    complexity: true,
  } as const

  let completed = false
  try {
    const initial = await timedBuild(module, project, options)
    const normalizedInitial = normalizeCodegraph(database)
    const initialStats = await stat(database)
    const semantics = inspectSemantics(database)
    const query = measureQueries(() =>
      module.queryNameData('defineMutation', database, { limit: 20 }),
    )

    const builderPath = join(project, 'src/sdk/builder.ts')
    const builderBefore = await readFile(builderPath, 'utf8')
    const identityBefore = codegraphIdentity(database, 'src/sdk/builder.ts', 'defineMutation')
    await writeFile(builderPath, `// unrelated line shift\n${builderBefore}`, 'utf8')
    const positionBuild = await timedBuild(module, project, { ...options, incremental: true })
    const identityAfter = codegraphIdentity(database, 'src/sdk/builder.ts', 'defineMutation')
    const positionParity = await coldParity(module, project, database, options, 'position')
    await writeFile(builderPath, builderBefore, 'utf8')
    await timedBuild(module, project, options)

    const sidecar = installSidecarProbe(database)
    const churn: Record<string, unknown> = {}
    const casesPath = join(project, 'src/cases.ts')
    const casesBefore = await readFile(casesPath, 'utf8')
    await writeFile(
      casesPath,
      casesBefore.replace("const knownName = 'known'", "const knownName = 'edited'"),
      'utf8',
    )
    churn.change = await incrementalParity(module, project, database, options, 'change')

    const createdPath = join(project, 'src/created.ts')
    const renamedPath = join(project, 'src/renamed.ts')
    await writeFile(
      createdPath,
      "import { defineMutation } from '@fixture/builder'\nexport const created = defineMutation({ name: 'created', callback: (input) => input })\n",
      'utf8',
    )
    churn.create = await incrementalParity(module, project, database, options, 'create')
    await rename(createdPath, renamedPath)
    churn.rename = await incrementalParity(module, project, database, options, 'rename')
    await rm(renamedPath)
    churn.delete = await incrementalParity(module, project, database, options, 'delete')

    const configPath = join(project, '.codegraphrc.json')
    const configBefore = await readFile(configPath, 'utf8')
    const config = JSON.parse(configBefore)
    config.exclude = ['**/fake.ts']
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    churn.codegraphConfig = await incrementalParity(
      module,
      project,
      database,
      options,
      'codegraph-config',
    )
    await writeFile(configPath, configBefore, 'utf8')
    await timedBuild(module, project, options)

    const tsconfigPath = join(project, 'tsconfig.json')
    const tsconfigBefore = await readFile(tsconfigPath, 'utf8')
    const tsconfig = JSON.parse(tsconfigBefore)
    tsconfig.compilerOptions.paths['@fixture/builder'] = ['src/fake.ts']
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8')
    churn.typescriptConfig = await incrementalParity(
      module,
      project,
      database,
      options,
      'typescript-config',
    )
    await writeFile(tsconfigPath, tsconfigBefore, 'utf8')
    await timedBuild(module, project, options)

    const helperPath = join(project, 'src/helpers.ts')
    const branchHelperPath = join(project, 'src/branch-helpers.ts')
    const helperBefore = await readFile(helperPath, 'utf8')
    const fakePath = join(project, 'src/fake.ts')
    const fakeBefore = await readFile(fakePath, 'utf8')
    await rename(helperPath, branchHelperPath)
    await rm(fakePath)
    await writeFile(
      casesPath,
      casesBefore
        .replace('./helpers.js', './branch-helpers.js')
        .replace("import { defineMutation as defineFakeMutation } from './fake.js'\n", '')
        .replace('export const collision = defineFakeMutation({ name: knownName })\n', ''),
      'utf8',
    )
    await writeFile(
      join(project, 'src/branch-added.ts'),
      'export const branchAdded = true\n',
      'utf8',
    )
    churn.branchSwitch = await incrementalParity(
      module,
      project,
      database,
      options,
      'branch-switch',
    )

    await rm(branchHelperPath)
    await rm(join(project, 'src/branch-added.ts'))
    await writeFile(helperPath, helperBefore, 'utf8')
    await writeFile(fakePath, fakeBefore, 'utf8')
    await writeFile(casesPath, casesBefore, 'utf8')
    await timedBuild(module, project, options)

    const sidecarAfterFullRebuilds = readSidecarProbe(database)
    const fixedSchema = await fixedSchemaProbe(module, project, database, options)

    const evidence = {
      format: 'astrale.typespec.v2.codegraph-spike',
      version: 1,
      status: 'qualified',
      subject: {
        package: packageJson.name,
        version: packageJson.version,
        license: packageJson.license,
        sourceRevision: toolchain.source.revision,
      },
      boundary: {
        semanticAuthority: 'ttsc and TypeSpec portable facts remain authoritative',
        evaluatedRole: 'materialization, change detection, query, AST, CFG, and dataflow substrate',
      },
      source,
      ingestion: {
        compilerFactInput: false,
        publicExtractorInjection: false,
        redundantTreeSitterAnalysisRequiredByBuildGraph: true,
        disposition: 'requires a new public ingestion pipeline or a fork',
      },
      extension: {
        fixedGraphTablesAcceptArbitraryTextKinds: true,
        fixedGraphRowsSurviveFullBuild: fixedSchema.survivesFullBuild,
        fixedGraphRowsVisibleToGenericNameQuery: fixedSchema.visibleToNameQuery,
        namespacedVersionedSidecarPossible: true,
        sidecar,
        sidecarAfterFullRebuilds,
        sidecarIntegratedWithCodegraphQueries: false,
        sidecarUsesCodegraphChangeLifecycle: false,
      },
      generations: {
        nativeStoreIsMutableCurrentState: true,
        packageSnapshotsAreWholeDatabaseBackups: true,
        generationPinnedReadersNative: false,
        immutableGenerationsLayerableInSidecar: true,
        infrastructureStillOwnedByAdapter: [
          'generation transactions',
          'reader leases',
          'retention',
          'fact schema validation',
          'provenance and completeness queries',
        ],
      },
      identity: {
        databaseIdStableAcrossPositionShift: identityBefore.id === identityAfter.id,
        sourceLineStableAcrossPositionShift: identityBefore.line === identityAfter.line,
        contentHashStableAcrossPositionShift:
          identityBefore.contentHash === identityAfter.contentHash,
        qualifiedNameStableAcrossPositionShift:
          identityBefore.qualifiedName === identityAfter.qualifiedName,
        portableIdentityCanBeLayeredFromTtsc: true,
        codegraphIdentityIsSuitableAsSemanticAuthority: false,
        positionBuildMs: positionBuild.elapsedMs,
        positionParity,
      },
      churn,
      bodyAnalysis: {
        astRows: semantics.astRows,
        cfgBlocks: semantics.cfgBlocks,
        dataflowRows: semantics.dataflowRows,
        dataflowKinds: semantics.dataflowKinds,
        callTargets: semantics.callTargets,
        knownUnknownAmbiguousUnsupportedValueStates: false,
        checkerResolvedSdkIdentity: false,
        usefulAsSupplementalStructuralEvidence: true,
      },
      fixturePerformance: {
        fullBuildMs: initial.elapsedMs,
        maximumRssBytes: initial.maximumRssBytes,
        databaseBytes: initialStats.size,
        query,
        rows: tableCounts(normalizedInitial),
      },
      decision: {
        outcome: 'own-normalized-materializer-with-selective-codegraph-derived-machinery',
        rationale: [
          'No public compiler-fact ingestion or repository extension seam exists.',
          'The fixed mutable schema lacks namespaces, versions, evidence, completeness, and immutable generations.',
          'The documented incremental contract is weaker than normalized incremental equals cold.',
          'AST, CFG, and dataflow are Tree-sitter-derived and cannot replace checker-resolved TypeSpec facts.',
          'A sidecar can coexist but would reimplement the infrastructure block the dependency was meant to replace.',
          'A direct dependency would inherit a conflicting analysis authority and lifecycle without removing TypeSpec-owned semantic infrastructure.',
        ],
        reusable: [
          'normalized SQLite schema and index patterns',
          'file metadata triage with content hashing as final authority',
          'delete and rename purge semantics',
          'bounded query and pagination patterns',
          'cold-equivalence and adversarial churn test cases',
        ],
        excludedFromReuse: [
          'fixed nodes and edges ontology',
          'Tree-sitter analysis pipeline',
          'line or database-row identities',
          'mutable-current generation lifecycle',
          'mirrored native and WASM implementations',
        ],
        productionStore: 'TypeSpec-owned normalized SQLite materializer',
        currentSnapshotJsonStore: 'correctness reference only; not the production architecture',
        dependencyPolicy: 'no direct @optave/codegraph runtime dependency',
        derivationPolicy:
          'Any copied or adapted Apache-2.0 implementation must identify the upstream revision, preserve attribution, and document material divergences.',
        upstreamSeamsWorthProposing: [
          'public transactional external-fact ingestion',
          'namespaced extension tables and query registration',
          'portable identity columns independent of source lines',
          'generation-pinned read API',
          'cold-equivalence mode covering analysis tables and config inputs',
        ],
      },
    }
    if (writeEvidence)
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    completed = true
  } finally {
    if (completed && !retainFixture) await rm(temporary, { recursive: true, force: true })
    else process.stderr.write(`Codegraph qualification fixture retained at ${temporary}\n`)
  }
}

async function auditSource(root: string, packageJson: PackageMetadata, expectedSchema: number) {
  const publicIndex = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const pipeline = await readFile(resolve(root, 'src/domain/graph/builder/pipeline.ts'), 'utf8')
  const parserStage = await readFile(
    resolve(root, 'src/domain/graph/builder/stages/parse-files.ts'),
    'utf8',
  )
  const migrations = await readFile(resolve(root, 'src/db/migrations.ts'), 'utf8')
  const incrementalGuide = await readFile(
    resolve(root, 'docs/guides/incremental-builds.md'),
    'utf8',
  )
  const migrationVersions = [...migrations.matchAll(/version:\s*(\d+)/gu)].map((match) =>
    Number(match[1]),
  )
  assert.equal(Math.max(...migrationVersions), expectedSchema)
  return {
    publicExports: Object.keys(packageJson.exports ?? {}).sort(),
    publicBuildGraph: /export \{ buildGraph \}/u.test(publicIndex),
    publicDatabaseRepository: /openDb|SqliteRepository|initSchema/u.test(publicIndex),
    pipelineAlwaysParses: /await parseFiles\(ctx\)/u.test(pipeline),
    parserStageUsesTreeSitterPipeline: /parseFilesAuto/u.test(parserStage),
    schemaVersion: Math.max(...migrationVersions),
    fixedTables: [...migrations.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/gu)]
      .map((match) => match[1])
      .filter((name, index, values) => values.indexOf(name) === index)
      .sort(),
    documentsAnalysisStaleness:
      /complexity, dataflow, and CFG data for files you didn't directly edit won't update incrementally/u.test(
        incrementalGuide,
      ),
    documentsFullRebuildAfterBranchMerges: /After large refactors or branch merges/u.test(
      incrementalGuide,
    ),
    sourceDigest: sha256(publicIndex + pipeline + parserStage + migrations + incrementalGuide),
  }
}

async function timedBuild(
  module: CodegraphModule,
  root: string,
  options: Readonly<Record<string, unknown>>,
) {
  const before = process.resourceUsage().maxRSS
  const started = performance.now()
  const result = await module.buildGraph(root, options)
  return {
    elapsedMs: Math.round(performance.now() - started),
    maximumRssBytes: Math.max(before, process.resourceUsage().maxRSS) * 1024,
    changed: result !== undefined,
    phases: result?.phases,
  }
}

async function incrementalParity(
  module: CodegraphModule,
  root: string,
  live: string,
  options: Readonly<Record<string, unknown>>,
  label: string,
) {
  const incremental = await timedBuild(module, root, {
    ...options,
    incremental: true,
    dbPath: live,
  })
  const parity = await coldParity(module, root, live, options, label)
  return { ...parity, incremental }
}

async function coldParity(
  module: CodegraphModule,
  root: string,
  live: string,
  options: Readonly<Record<string, unknown>>,
  label: string,
) {
  const cold = join(root, '.qualification', `cold-${label}.db`)
  await rm(cold, { force: true })
  const coldBuild = await timedBuild(module, root, {
    ...options,
    incremental: false,
    dbPath: cold,
  })
  const actual = normalizeCodegraph(live)
  const expected = normalizeCodegraph(cold)
  const differingTables = Object.keys(actual.tables).filter(
    (name) => JSON.stringify(actual.tables[name]) !== JSON.stringify(expected.tables[name]),
  )
  return {
    equivalent: actual.digest === expected.digest,
    incrementalDigest: actual.digest,
    coldDigest: expected.digest,
    differingTables,
    differences: Object.fromEntries(
      differingTables.map((name) => [
        name,
        rowDifferences(actual.tables[name] ?? [], expected.tables[name] ?? []),
      ]),
    ),
    coldBuildMs: coldBuild.elapsedMs,
  }
}

function rowDifferences(actual: readonly unknown[], expected: readonly unknown[]) {
  const actualRows = new Set(actual.map((row) => JSON.stringify(row)))
  const expectedRows = new Set(expected.map((row) => JSON.stringify(row)))
  return {
    incrementalOnly: [...actualRows].filter((row) => !expectedRows.has(row)).slice(0, 3),
    coldOnly: [...expectedRows].filter((row) => !actualRows.has(row)).slice(0, 3),
    incrementalCount: actual.length,
    coldCount: expected.length,
  }
}

function codegraphIdentity(database: string, file: string, name: string) {
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const row = db
      .prepare(
        `SELECT id, line, qualified_name AS qualifiedName, content_hash AS contentHash
         FROM nodes WHERE file = ? AND name = ? AND kind = 'function'
         ORDER BY line LIMIT 1`,
      )
      .get(file, name) as
      | {
          readonly id: number
          readonly line: number
          readonly qualifiedName: string
          readonly contentHash: string
        }
      | undefined
    assert(row, `Codegraph did not materialize ${file}#${name}.`)
    return row
  } finally {
    db.close()
  }
}

function inspectSemantics(file: string) {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const scalar = (sql: string) => (database.prepare(sql).get() as { count: number }).count
    const kinds = database
      .prepare('SELECT DISTINCT kind FROM dataflow ORDER BY kind')
      .all()
      .map((row) => (row as { readonly kind: string }).kind)
    const callTargets = database
      .prepare(
        `SELECT source.file AS sourceFile, source.name AS sourceName,
                target.file AS targetFile, target.name AS targetName,
                edge.confidence, edge.technique
         FROM edges AS edge
         JOIN nodes AS source ON source.id = edge.source_id
         JOIN nodes AS target ON target.id = edge.target_id
         WHERE edge.kind = 'calls' AND target.name IN ('defineMutation', 'referencedBuilder')
         ORDER BY sourceFile, sourceName, targetFile, targetName`,
      )
      .all()
    return {
      astRows: scalar('SELECT COUNT(*) AS count FROM ast_nodes'),
      cfgBlocks: scalar('SELECT COUNT(*) AS count FROM cfg_blocks'),
      dataflowRows: scalar('SELECT COUNT(*) AS count FROM dataflow'),
      dataflowKinds: kinds,
      callTargets,
    }
  } finally {
    database.close()
  }
}

async function fixedSchemaProbe(
  module: CodegraphModule,
  root: string,
  file: string,
  options: Readonly<Record<string, unknown>>,
) {
  const database = new DatabaseSync(file)
  database
    .prepare(
      `INSERT INTO nodes (name, kind, file, line, qualified_name, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'externalSemanticFact',
      'astrale.typescript.symbol.v1',
      'astrale://fixture',
      1,
      'externalSemanticFact',
      'stable-fact',
    )
  database.close()
  const visible = module.queryNameData('externalSemanticFact', file, { limit: 10 }) as {
    readonly results?: readonly unknown[]
  }
  await timedBuild(module, root, { ...options, incremental: false, dbPath: file })
  const after = new DatabaseSync(file, { readOnly: true })
  const survives = Boolean(
    after.prepare("SELECT 1 FROM nodes WHERE name = 'externalSemanticFact'").get(),
  )
  after.close()
  return {
    visibleToNameQuery: Boolean(visible.results?.length),
    survivesFullBuild: survives,
  }
}

function measureQueries(run: () => unknown) {
  const values: number[] = []
  for (let index = 0; index < 50; index++) {
    const started = performance.now()
    run()
    values.push(performance.now() - started)
  }
  values.sort((left, right) => left - right)
  return {
    samples: values.length,
    medianMs: round(values[Math.floor(values.length / 2)]!),
    p95Ms: round(values[Math.floor(values.length * 0.95)]!),
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

await main()
