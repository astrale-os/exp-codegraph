import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'

import type {
  AnalysisQuery,
  AnalysisSnapshotSet,
  AnalysisStore,
  QualificationSnapshot,
} from '../../../index.ts'

import { deriveAnalysisId, validateFactTransaction } from '../../../analysis/index.ts'
import { createMemoryAnalysisStore } from '../../../analysis/memory/index.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
import { discoverSpecificationDirectories } from '../../../application/discovery/index.ts'
import {
  createModuleConformanceProfiles,
  qualifySpecification,
} from '../../../conformance/index.ts'
import { compileSpecificationSnapshot } from '../../../specification/index.ts'
import {
  modulesFromTransactions,
  type ObservationCheckpoint,
  validateCheckpointModules,
  validateCompleteObservationCheckpoint,
} from './checkpoint.ts'
import {
  compareQualificationOracle,
  projectQualificationOracle,
  qualificationOracleDifferenceDigest,
  type V1QualificationOracle,
} from './oracle/index.ts'
import { conformanceCorpusScope } from './scope.ts'
import { qualifiedProductionNativeDigest } from '../ttsc/qualified-native.ts'

const root = resolve(import.meta.dirname, '../../../..')
const checkpointPath = argument('--observation-input')
const nativePath = argument('--native')
const resultPath = argument('--result-output')
const selectedModules = argumentsFor('--module')
const write = process.argv.includes('--write')
const evidencePath = resolve(root, 'spec/.history/v2/evidence/g4-conformance.json')
const oraclePath = resolve(root, 'spec/.history/v2/evidence/v1-oracle.json')
const ttscEvidencePath = resolve(root, 'spec/.history/v2/evidence/ttsc-qualification.json')
const shadowRoots = ['spec']

if (!checkpointPath) {
  throw new Error(
    'Usage: corpus.ts --observation-input <v4-checkpoint> [--native <qualified-binary>] [--result-output <path> | --write]',
  )
}
if (write && (!nativePath || resultPath)) {
  throw new Error('Governed evidence requires --native and does not accept --result-output.')
}
if (write && selectedModules.length) {
  throw new Error('Focused module inspection cannot write governed evidence.')
}

const checkpointBytes = await readFile(resolve(checkpointPath))
const checkpoint = JSON.parse(checkpointBytes.toString('utf8')) as ObservationCheckpoint
const repositoryInventory = deriveAnalysisId(
  'source-manifest',
  'astrale.typespec.gate4.repository-inventory',
  { checkpoint: digest(checkpointBytes) },
)
validateCompleteObservationCheckpoint(checkpoint)
if (nativePath) {
  const nativeDigest = digest(await readFile(resolve(nativePath)))
  if (nativeDigest !== checkpoint.nativeDigest) {
    throw new Error('The checkpoint was produced by a different native binary.')
  }
  if (write && nativeDigest !== (await qualifiedProductionNativeDigest(ttscEvidencePath))) {
    throw new Error('Governed conformance requires the exact native binary retained by ttsc qualification.')
  }
}

const transactions = new Map(checkpoint.transactions)
const modules = modulesFromTransactions(transactions)
validateCheckpointModules(checkpoint, modules)
const specificationModules = (
  await discoverSpecificationDirectories(root, {
    exclude: [
      'backend/falkordb/evidence/artifacts',
      'backend/falkordb/benchmark/artifacts',
      ...shadowRoots,
    ],
  })
)
  .filter((directory) => directory.endsWith('/.spec'))
  .map((directory) => portable(relative(root, resolve(directory, 'api.d.ts'))))
  .sort(compare)
const corpusScope = conformanceCorpusScope(
  specificationModules,
  [...modules.keys()],
  selectedModules,
)
const focused = selectedModules.length > 0
if (corpusScope.orphanObservations.length) {
  throw new Error(
    `Native observations have no authored specification: ${corpusScope.orphanObservations.join(', ')}.`,
  )
}
const transactionModules = modulesFromTransactions(transactions)
if (stableJson([...transactionModules]) !== stableJson([...modules])) {
  throw new Error('Checkpoint module payloads do not equal their retained native transactions.')
}
for (const [project, transaction] of transactions) {
  const diagnostics = validateFactTransaction(transaction)
  if (diagnostics.length) {
    throw new Error(`Invalid retained transaction for ${project}: ${diagnostics.join(', ')}`)
  }
  const expected = checkpoint.projects.find((entry) => entry.project === project)
  if (!expected || expected.generation !== transaction.next.id) {
    throw new Error(`Checkpoint project generation does not match ${project}.`)
  }
}

const temporary = await mkdtemp(resolve(tmpdir(), 'typespec-v2-g4-conformance-'))
const memory = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
const sqlite = focused
  ? undefined
  : await createSQLiteAnalysisStore({
      file: resolve(temporary, 'analysis.sqlite'),
      namespace: 'gate4-corpus',
      maximumRetainedGenerations: 2,
    })

let memoryAnalysis: AnalysisSnapshotSet | undefined
let sqliteAnalysis: AnalysisSnapshotSet | undefined
try {
  for (const [index, [project, transaction]] of [...transactions].entries()) {
    process.stderr.write(`[conformance materialize ${index + 1}/${transactions.size}] ${project}\n`)
    await memory.commit(transaction)
    await sqlite?.commit(transaction)
  }
  const generations = new Map(
    [...transactions.values()].map((transaction) => [
      transaction.next.universe,
      transaction.next.id,
    ]),
  )
  memoryAnalysis = await memory.snapshotSet(generations, repositoryInventory)
  if (sqlite) {
    sqliteAnalysis = await sqlite.snapshotSet(generations, repositoryInventory)
    if (memoryAnalysis.id !== sqliteAnalysis.id) {
      throw new Error('Memory and SQLite produced different analysis snapshot identities.')
    }
  }

  const storeDigests = []
  for (const [index, transaction] of [...transactions.values()].entries()) {
    const universe = transaction.next.universe
    process.stderr.write(
      `[conformance store differential ${index + 1}/${transactions.size}] ${universe}\n`,
    )
    const memoryDigest = await queryDigest(await memoryAnalysis.query(universe))
    if (sqliteAnalysis) {
      const sqliteDigest = await queryDigest(await sqliteAnalysis.query(universe))
      if (stableJson(memoryDigest) !== stableJson(sqliteDigest)) {
        throw new Error(
          `Memory and SQLite query results differ for ${universe}: ${stableJson({ memoryDigest, sqliteDigest })}`,
        )
      }
    }
    storeDigests.push(memoryDigest)
  }

  const profiles = createModuleConformanceProfiles()
  await sqliteAnalysis?.dispose()
  sqliteAnalysis = undefined
  const qualifications: QualificationSnapshot[] = []
  const qualificationModules = corpusScope.selected
  for (const [index, module] of qualificationModules.entries()) {
    if (
      qualificationModules.length === 1 ||
      index === 0 ||
      (index + 1) % 10 === 0 ||
      index + 1 === qualificationModules.length
    ) {
      process.stderr.write(
        `[conformance qualify ${index + 1}/${qualificationModules.length}] ${module}\n`,
      )
    }
    const specification = await compileSpecificationSnapshot(root, dirname(resolve(root, module)))
    qualifications.push(
      await qualifySpecification({
        specification,
        analysis: memoryAnalysis,
        profiles,
      }),
    )
  }

  const historicalOracle = JSON.parse(await readFile(oraclePath, 'utf8')) as V1QualificationOracle
  const oracleProjection = projectQualificationOracle(
    historicalOracle,
    corpusScope.specifications,
  )
  const comparison = compareQualificationOracle(oracleProjection.oracle, qualifications)
  if (write && comparison.policy.status !== 'qualified') {
    throw new Error(
      `Governed V1 comparison contains unexplained drift: ${comparison.policy.unexplained.length} unclassified difference(s), ${comparison.policy.groups.filter((group) => !group.accepted).length} changed policy group(s).`,
    )
  }
  const output = {
    format: 'astrale.typespec.v2.conformance-corpus',
    version: 1,
    authority: nativePath ? (write ? 'governed-fresh-native' : 'verified-native') : 'checkpoint',
    checkpoint: {
      digest: digest(checkpointBytes),
      boundaries: checkpoint.boundaries,
      nativeDigest: checkpoint.nativeDigest,
      projects: checkpoint.projects.length,
      modules: modules.size,
      specifications: corpusScope.specifications.length,
      unobservedSpecifications: corpusScope.unobservedSpecifications,
      transactions: checkpoint.transactions.length,
    },
    materialization: {
      analysis: memoryAnalysis.id,
      universes: memoryAnalysis.universes.length,
      stores: sqlite ? ['memory', 'sqlite'] : ['memory'],
      exactQueryDigests: storeDigests,
      ...(sqlite ? { identical: true } : { differential: 'full-corpus-only' }),
      qualificationInput:
        'memory snapshot after exact identity, capability, manifest, and fact-stream equivalence',
    },
    qualification: summarizeQualifications(qualifications),
    ...(selectedModules.length ? { inspection: qualifications } : {}),
    oracle: comparison,
    oracleProjection: {
      requestedSpecifications: oracleProjection.requestedSources.length,
      retainedSpecifications: oracleProjection.retainedSources.length,
      excludedHistoricalSpecifications: oracleProjection.excludedSources.length,
      excludedHistoricalDigest: qualificationOracleDifferenceDigest(
        oracleProjection.excludedSources,
      ),
      absentFromHistoricalOracle: oracleProjection.absentSources,
    },
  }
  const serialized = `${JSON.stringify(output, null, 2)}\n`
  if (write) await atomicWrite(evidencePath, serialized)
  else if (resultPath) await atomicWrite(resolve(resultPath), serialized)
  else process.stdout.write(serialized)
} finally {
  await memoryAnalysis?.dispose()
  await sqliteAnalysis?.dispose()
  await memory.dispose()
  await sqlite?.dispose()
  await rm(temporary, { recursive: true, force: true })
}

async function queryDigest(query: AnalysisQuery) {
  try {
    const hash = createHash('sha256')
    let facts = 0
    for await (const fact of query.export()) {
      hash.update(stableJson(fact))
      hash.update('\0')
      facts++
    }
    return {
      universe: query.generation.universe,
      generation: query.generation.id,
      manifest: digest(Buffer.from(stableJson(await query.manifest()))),
      capabilities: await query.capabilities(),
      facts,
      factsDigest: hash.digest('hex'),
    }
  } finally {
    await query.dispose()
  }
}

function summarizeQualifications(values: readonly QualificationSnapshot[]) {
  const statuses = count(values.map((value) => value.status))
  const profiles = new Map<
    string,
    {
      statuses: string[]
      diagnostics: string[]
      forwardMatched: number
      forwardTotal: number
      inverseMatched: number
      inverseTotal: number
    }
  >()
  for (const qualification of values) {
    for (const profile of qualification.profiles) {
      const current = profiles.get(profile.id) ?? {
        statuses: [],
        diagnostics: [],
        forwardMatched: 0,
        forwardTotal: 0,
        inverseMatched: 0,
        inverseTotal: 0,
      }
      current.statuses.push(profile.status)
      current.diagnostics.push(
        ...profile.rules.flatMap((rule) => rule.diagnostics.map((entry) => entry.code)),
      )
      current.forwardMatched += profile.coverage.forward.matched
      current.forwardTotal += profile.coverage.forward.total
      current.inverseMatched += profile.coverage.inverse.matched
      current.inverseTotal += profile.coverage.inverse.total
      profiles.set(profile.id, current)
    }
  }
  return {
    modules: values.length,
    statuses,
    profiles: Object.fromEntries(
      [...profiles].map(([id, value]) => [
        id,
        {
          statuses: count(value.statuses),
          diagnostics: count(value.diagnostics),
          coverage: {
            forward: { matched: value.forwardMatched, total: value.forwardTotal },
            inverse: { matched: value.inverseMatched, total: value.inverseTotal },
          },
        },
      ]),
    ),
    byModule: values.map((value) => ({
      source: value.specification.source,
      status: value.status,
      profiles: value.profiles.map((profile) => ({
        id: profile.id,
        status: profile.status,
        diagnostics: count(
          profile.rules.flatMap((rule) => rule.diagnostics.map((entry) => entry.code)),
        ),
        coverage: profile.coverage,
      })),
    })),
    digest: digest(Buffer.from(stableJson(values))),
  }
}

function count(values: readonly string[]): Readonly<Record<string, number>> {
  const output: Record<string, number> = {}
  for (const value of values) output[value] = (output[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => compare(left, right)))
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, path)
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function argumentsFor(name: string): readonly string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!)
    }
  }
  return values
}

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
