import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { createHash } from 'node:crypto'

import {
  createMemoryAnalysisStore,
  deriveAnalysisId,
  deriveAnalysisSnapshotSetId,
  type AnalysisGenerationId,
  type NativeModuleBoundary,
  type ProjectUniverseId,
  type RepositoryId,
} from '../../../analysis/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
import { resolveApplicationModuleBoundaries } from '../../../application/analysis/index.ts'
import {
  APPLICATION_REPOSITORY_EXCLUDES,
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../../../application/discovery/index.ts'
import { inventoryRepository } from '../../../repository/index.ts'
import { compileSpecificationSnapshots } from '../../../specification/index.ts'

import {
  analyzeProject,
  binaryDigest,
  summarizeGeneration,
} from './analyze.ts'
import {
  SELF_HOST_AUDIT_FORMAT,
  SELF_HOST_EVIDENCE_FORMAT,
  type SelfHostAudit,
  type SelfHostAuditDisposition,
  type SelfHostCandidate,
  type SelfHostFactSummary,
  type SelfHostProjectResult,
  type SelfHostTarget,
  type SelfHostTargetResult,
} from './model.ts'

const packageRoot = resolve(import.meta.dirname, '../../..')
const evidencePath = resolve(packageRoot, '.history/v2/evidence/self-host-qualification.json')
const nativeBinary = requiredArgument('--native-binary')
const kernelRoot = requiredArgument('--kernel-root')
const auditPath = argument('--audit')
const outputPath = argument('--output')
const selectedTarget = argument('--target')
const writeEvidence = process.argv.includes('--write')

if (selectedTarget && selectedTarget !== 'codegraph' && selectedTarget !== 'kernel') {
  throw new Error('--target must be codegraph or kernel.')
}
if (writeEvidence && selectedTarget) {
  throw new Error('Governed self-host evidence requires both targets and does not accept --target.')
}

async function main(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-codegraph-self-host-'))
  try {
    const audit = auditPath ? await readAudit(resolve(auditPath)) : emptyAudit()
    const allTargets: readonly SelfHostTarget[] = [
      {
        id: 'codegraph',
        repository: 'package:@astrale-os/codegraph',
        root: packageRoot,
      },
      {
        id: 'kernel',
        repository: 'repository:astrale-os/kernel-v2',
        root: resolve(kernelRoot),
        excludeSpecifications: ['spec'],
      },
    ]
    const targets = selectedTarget
      ? allTargets.filter((target) => target.id === selectedTarget)
      : allTargets
    const results: SelfHostTargetResult[] = []
    for (const target of targets) {
      progress(target.id, 'discovering and compiling specification corpus')
      results.push(await qualifyTarget(target, resolve(nativeBinary), temporary, audit))
    }
    const candidates = results.flatMap((result) => result.candidates)
    const staleAccepted = audit.dispositions.filter(
      (entry) => entry.status === 'accepted' && !candidates.some((candidate) => candidate.fingerprint === entry.fingerprint),
    )
    if (staleAccepted.length) {
      throw new Error(
        `Self-host audit contains ${staleAccepted.length} accepted dispositions without current candidates: ${staleAccepted.map((value) => value.fingerprint).join(', ')}`,
      )
    }
    const unresolved = candidates.filter((candidate) => candidate.disposition !== 'accepted')
    const evidence = {
      format: SELF_HOST_EVIDENCE_FORMAT,
      version: 1,
      status: writeEvidence && unresolved.length === 0 ? 'qualified' : 'diagnostic',
      native: {
        sha256: await binaryDigest(resolve(nativeBinary)),
        platform: `${process.platform}-${process.arch}`,
      },
      targets: results,
      audit: {
        supplied: Boolean(auditPath),
        candidates: candidates.length,
        accepted: candidates.filter((candidate) => candidate.disposition === 'accepted').length,
        unresolved: candidates.filter((candidate) => candidate.disposition === 'unresolved').length,
        fixRequired: candidates.filter((candidate) => candidate.disposition === 'fix-required').length,
      },
      invariants: {
        memoryEqualsSQLite: results.every((target) => target.projects.every((project) => project.memoryEqualsSQLite)),
        sqliteReopenEquivalent: results.every((target) => target.projects.every((project) => project.sqliteReopenEquivalent)),
        warmNoChangeReusedGeneration: results.every((target) => target.projects.every((project) => project.warmReusedGeneration)),
        portableOutput: true,
      },
    }
    assert.equal(evidence.invariants.memoryEqualsSQLite, true)
    assert.equal(evidence.invariants.sqliteReopenEquivalent, true)
    assert.equal(evidence.invariants.warmNoChangeReusedGeneration, true)
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`
    assertPortable(serialized, targets, resolve(nativeBinary))
    if (outputPath) await atomicWrite(resolve(outputPath), serialized)
    if (writeEvidence) {
      if (unresolved.length) {
        throw new Error(
          `Governed self-host evidence rejected: ${unresolved.length} candidates remain unresolved or fix-required.`,
        )
      }
      await atomicWrite(evidencePath, serialized)
    }
    process.stdout.write(serialized)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function qualifyTarget(
  target: SelfHostTarget,
  binary: string,
  temporary: string,
  audit: SelfHostAudit,
): Promise<SelfHostTargetResult> {
  const root = await resolveApplicationRoot(target.root)
  const repository = deriveAnalysisId(
    'repository',
    'astrale.codegraph.self-host',
    { key: target.repository },
  ) as RepositoryId
  const inventoryExcludes = [
    ...APPLICATION_REPOSITORY_EXCLUDES,
    ...(target.excludeSpecifications ?? []).map((path) => `${path}/**`),
  ]
  const inventoryBefore = await inventoryRepository({
    repository,
    root,
    scope: { exclude: inventoryExcludes },
  })
  const directories = await discoverSpecificationDirectories(root, {
    ...(target.excludeSpecifications ? { exclude: target.excludeSpecifications } : {}),
  })
  const specifications = await compileSpecificationSnapshots(root, directories)
  const resolution = await resolveApplicationModuleBoundaries(root, specifications)
  if (resolution.diagnostics.length) {
    throw new Error(
      `${target.id} module boundary resolution failed:\n${resolution.diagnostics.map((value) => `${value.file}:${value.line}:${value.column} [${value.code}] ${value.message}`).join('\n')}`,
    )
  }
  const projects = groupByProject(resolution.boundaries)
  if (!projects.size) throw new Error(`${target.id} produced no analyzable TypeScript projects.`)

  const memoryGenerations = new Map<ProjectUniverseId, AnalysisGenerationId>()
  let memorySnapshot: { readonly id: string; readonly inventory: string; readonly universes: readonly string[] }
  const memoryResults = new Map<string, {
    readonly generation: Awaited<ReturnType<typeof analyzeProject>>['generation']
    readonly summary: SelfHostFactSummary
    readonly coldMs: number
    readonly warmMs: number
    readonly warmReused: boolean
  }>()
  let memoryIndex = 0
  for (const [project, modules] of projects) {
    const memory = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
    try {
      progress(target.id, `memory ${++memoryIndex}/${projects.size}: ${project}`)
      const analyzed = await analyzeProject({
        target: target.id,
        root,
        project,
        modules,
        binary,
        store: memory,
      })
      try {
        const summary = await summarizeGeneration(target.id, project, memory, analyzed.generation)
        const warmStarted = performance.now()
        const warm = await analyzed.service.refresh()
        const warmMs = round(performance.now() - warmStarted)
        memoryResults.set(project, {
          generation: analyzed.generation,
          summary,
          coldMs: analyzed.elapsedMs,
          warmMs,
          warmReused: warm.transaction === undefined && warm.generation.id === analyzed.generation.id,
        })
        memoryGenerations.set(analyzed.generation.universe, analyzed.generation.id)
      } finally {
        await analyzed.service.dispose()
      }
    } finally {
      await memory.dispose()
    }
  }
  memorySnapshot = {
    id: deriveAnalysisSnapshotSetId(memoryGenerations, inventoryBefore.revision),
    inventory: inventoryBefore.revision,
    universes: [...memoryGenerations.keys()].sort(),
  }

  const sqliteFile = resolve(temporary, `${target.id}.sqlite`)
  const sqlite = await createSQLiteAnalysisStore({
    file: sqliteFile,
    namespace: `self-host-${target.id}`,
    maximumRetainedGenerations: 2,
  })
  const sqliteResults = new Map<string, {
    readonly generation: Awaited<ReturnType<typeof analyzeProject>>['generation']
    readonly summary: SelfHostFactSummary
    readonly coldMs: number
  }>()
  const sqliteGenerations = new Map<ProjectUniverseId, AnalysisGenerationId>()
  let sqliteSnapshot: { readonly id: string; readonly inventory: string; readonly universes: readonly string[] }
  try {
    let index = 0
    for (const [project, modules] of projects) {
      progress(target.id, `sqlite ${++index}/${projects.size}: ${project}`)
      const analyzed = await analyzeProject({
        target: target.id,
        root,
        project,
        modules,
        binary,
        store: sqlite,
      })
      try {
        sqliteResults.set(project, {
          generation: analyzed.generation,
          summary: await summarizeGeneration(target.id, project, sqlite, analyzed.generation),
          coldMs: analyzed.elapsedMs,
        })
        sqliteGenerations.set(analyzed.generation.universe, analyzed.generation.id)
      } finally {
        await analyzed.service.dispose()
      }
    }
    const snapshot = await sqlite.snapshotSet(sqliteGenerations, inventoryBefore.revision)
    sqliteSnapshot = {
      id: snapshot.id,
      inventory: snapshot.inventory,
      universes: snapshot.universes,
    }
    await snapshot.dispose()
  } finally {
    await sqlite.dispose()
  }

  const sqliteBytes = (await stat(sqliteFile)).size
  const reopened = await createSQLiteAnalysisStore({
    file: sqliteFile,
    namespace: `self-host-${target.id}`,
    maximumRetainedGenerations: 2,
  })
  const reopenedSummaries = new Map<string, SelfHostFactSummary>()
  try {
    for (const [project, value] of sqliteResults) {
      reopenedSummaries.set(
        project,
        await summarizeGeneration(target.id, project, reopened, value.generation),
      )
    }
  } finally {
    await reopened.dispose()
  }

  const projectResults: SelfHostProjectResult[] = []
  for (const [project, modules] of projects) {
    const memoryResult = required(memoryResults, project)
    const sqliteResult = required(sqliteResults, project)
    const reopenedSummary = required(reopenedSummaries, project)
    const memoryEqualsSQLite = sameSummary(memoryResult.summary, sqliteResult.summary)
      && memoryResult.generation.id === sqliteResult.generation.id
    const sqliteReopenEquivalent = sameSummary(sqliteResult.summary, reopenedSummary)
    if (!memoryEqualsSQLite || !sqliteReopenEquivalent || !memoryResult.warmReused) {
      throw new Error(
        `${target.id}/${project} violated cold, warm, or SQLite self-host equivalence.`,
      )
    }
    projectResults.push({
      project,
      modules: modules.length,
      generation: memoryResult.generation.id,
      universe: memoryResult.generation.universe,
      coldMemoryMs: memoryResult.coldMs,
      warmMemoryMs: memoryResult.warmMs,
      coldSQLiteMs: sqliteResult.coldMs,
      warmReusedGeneration: memoryResult.warmReused,
      memoryEqualsSQLite,
      sqliteReopenEquivalent,
      summary: memoryResult.summary,
    })
  }
  const candidates = projectResults
    .flatMap((project) => project.summary.candidateInputs)
    .map((candidate) => applyAudit(candidate, audit.dispositions))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
  const specificationSources = specifications.map((value) => value.source).sort()
  const moduleIds = specifications.map((value) => value.module.id).sort()
  const projectIds = [...projects.keys()]
  const boundIds = new Set(resolution.boundaries.map((value) => value.id))
  const unboundModuleIds = moduleIds.filter((value) => !boundIds.has(value))
  const corpus = {
    specificationSources,
    moduleIds,
    projectIds,
    unboundModuleIds,
    digest: createHash('sha256')
      .update(stableJson({ specificationSources, moduleIds, projectIds, unboundModuleIds }))
      .digest('hex'),
  }
  const incremental = await qualifyIncrementalMirror({
    target,
    root,
    projects,
    binary,
    temporary,
    baseline: memoryResults,
  })
  const inventoryAfter = await inventoryRepository({
    repository,
    root,
    scope: { exclude: inventoryExcludes },
  })
  const stableDuringRun = inventoryAfter.revision === inventoryBefore.revision
  if (!stableDuringRun) {
    throw new Error(`${target.id} repository inventory changed during self-host qualification.`)
  }
  const memoryEqualsSQLiteSnapshot = stableJson(memorySnapshot!) === stableJson(sqliteSnapshot!)
  if (!memoryEqualsSQLiteSnapshot) {
    throw new Error(`${target.id} memory and SQLite snapshot sets differ.`)
  }
  return {
    target: target.id,
    repository: target.repository,
    specifications: specifications.length,
    boundaries: resolution.boundaries.length,
    corpus,
    inventory: {
      revision: inventoryBefore.revision,
      files: inventoryBefore.files.length,
      stableDuringRun,
    },
    snapshotSet: {
      ...memorySnapshot!,
      memoryEqualsSQLite: memoryEqualsSQLiteSnapshot,
    },
    incremental,
    projects: projectResults,
    sqliteBytes,
    candidates,
  }
}

async function qualifyIncrementalMirror(options: {
  readonly target: SelfHostTarget
  readonly root: string
  readonly projects: ReadonlyMap<string, readonly NativeModuleBoundary[]>
  readonly binary: string
  readonly temporary: string
  readonly baseline: ReadonlyMap<string, { readonly generation: { readonly id: string }; readonly summary: SelfHostFactSummary }>
}): Promise<SelfHostTargetResult['incremental']> {
  const [project, modules] = [...options.projects]
    .sort(([leftProject, leftModules], [rightProject, rightModules]) =>
      leftModules.length - rightModules.length || leftProject.localeCompare(rightProject),
    )[0]!
  const mirror = resolve(options.temporary, `${options.target.id}-incremental`)
  progress(options.target.id, `preparing controlled incremental mirror for ${project}`)
  await copyAnalysisMirror(options.root, mirror, options.target.excludeSpecifications ?? [])
  const changed = modules[0]!.entrypoint
  const baselineStore = createMemoryAnalysisStore({ maximumRetainedGenerations: 3 })
  const baseline = await analyzeProject({
    target: options.target.id,
    root: mirror,
    project,
    modules,
    binary: options.binary,
    store: baselineStore,
  })
  let incrementalSummary: SelfHostFactSummary
  let incrementalMs: number
  let incrementalGeneration: string
  try {
    const mirroredBaseline = await summarizeGeneration(
      options.target.id,
      project,
      baselineStore,
      baseline.generation,
    )
    const original = required(options.baseline, project)
    if (baseline.generation.id !== original.generation.id || !sameSummary(mirroredBaseline, original.summary)) {
      throw new Error(
        `${options.target.id}/${project} controlled mirror differs from the source baseline: ${JSON.stringify({
          sourceGeneration: original.generation.id,
          mirrorGeneration: baseline.generation.id,
          source: comparisonSummary(original.summary),
          mirror: comparisonSummary(mirroredBaseline),
        })}`,
      )
    }
    const source = resolve(mirror, changed)
    const before = await readFile(source, 'utf8')
    await writeFile(source, `${before}${before.endsWith('\n') ? '' : '\n'}// codegraph self-host incremental probe\n`, 'utf8')
    const started = performance.now()
    const refreshed = await baseline.service.refresh({ changed: [changed] })
    incrementalMs = round(performance.now() - started)
    if (!refreshed.transaction || refreshed.generation.id === baseline.generation.id) {
      throw new Error(`${options.target.id}/${project} incremental edit did not publish a new generation.`)
    }
    incrementalGeneration = refreshed.generation.id
    incrementalSummary = await summarizeGeneration(
      options.target.id,
      project,
      baselineStore,
      refreshed.generation,
    )
  } finally {
    await baseline.service.dispose()
    await baselineStore.dispose()
  }

  const coldStore = createMemoryAnalysisStore()
  const cold = await analyzeProject({
    target: options.target.id,
    root: mirror,
    project,
    modules,
    binary: options.binary,
    store: coldStore,
  })
  let coldSummary: SelfHostFactSummary
  try {
    coldSummary = await summarizeGeneration(options.target.id, project, coldStore, cold.generation)
  } finally {
    await cold.service.dispose()
    await coldStore.dispose()
  }

  const sqliteFile = resolve(options.temporary, `${options.target.id}-incremental.sqlite`)
  const sqlite = await createSQLiteAnalysisStore({
    file: sqliteFile,
    namespace: `self-host-${options.target.id}-incremental`,
  })
  const sqliteCold = await analyzeProject({
    target: options.target.id,
    root: mirror,
    project,
    modules,
    binary: options.binary,
    store: sqlite,
  })
  let sqliteSummary: SelfHostFactSummary
  try {
    sqliteSummary = await summarizeGeneration(
      options.target.id,
      project,
      sqlite,
      sqliteCold.generation,
    )
  } finally {
    await sqliteCold.service.dispose()
    await sqlite.dispose()
  }
  const incrementalEqualsCold = incrementalGeneration! === cold.generation.id
    && sameSummary(incrementalSummary!, coldSummary!)
  const incrementalEqualsSQLite = incrementalGeneration! === sqliteCold.generation.id
    && sameSummary(incrementalSummary!, sqliteSummary!)
  if (!incrementalEqualsCold || !incrementalEqualsSQLite) {
    throw new Error(
      `${options.target.id}/${project} incremental mirror differs from a cold rebuild: ${JSON.stringify({
        generations: {
          incremental: incrementalGeneration!,
          coldMemory: cold.generation.id,
          coldSQLite: sqliteCold.generation.id,
        },
        incremental: comparisonSummary(incrementalSummary!),
        coldMemory: comparisonSummary(coldSummary!),
        coldSQLite: comparisonSummary(sqliteSummary!),
      })}`,
    )
  }
  return {
    project,
    changed,
    incrementalMs: incrementalMs!,
    coldRebuildMs: cold.elapsedMs,
    coldSQLiteMs: sqliteCold.elapsedMs,
    generation: incrementalGeneration!,
    semanticDigest: incrementalSummary!.semanticDigest,
    incrementalEqualsCold,
    incrementalEqualsSQLite,
  }
}

async function copyAnalysisMirror(
  root: string,
  destination: string,
  excluded: readonly string[],
): Promise<void> {
  const excludedRoots = new Set(['.cache', '.git', 'node_modules', ...excluded])
  const excludedSegments = new Set(['coverage', 'dist', 'evidence'])
  await cp(root, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter(source) {
      const path = relative(root, source)
      if (!path) return true
      const segments = path.split(sep)
      if (excludedRoots.has(segments[0]!)) return false
      return !segments.some((segment) => excludedSegments.has(segment))
    },
  })
  await symlink(resolve(root, 'node_modules'), resolve(destination, 'node_modules'), 'dir')
}

function applyAudit(
  candidate: Omit<SelfHostCandidate, 'disposition' | 'rationale'>,
  dispositions: readonly SelfHostAuditDisposition[],
): SelfHostCandidate {
  const disposition = dispositions.find((value) => value.fingerprint === candidate.fingerprint)
  if (!disposition) return { ...candidate, disposition: 'unresolved' }
  if (candidate.kind === 'compiler-diagnostic') {
    return { ...candidate, disposition: 'fix-required', rationale: disposition.rationale }
  }
  if (disposition.rationale.trim().length < 20 || !disposition.witnesses.length) {
    throw new Error(`Audit disposition ${candidate.fingerprint} requires a substantive rationale and witnesses.`)
  }
  const unknownWitnesses = disposition.witnesses.filter(
    (witness) => !candidate.witnesses.includes(witness),
  )
  if (unknownWitnesses.length) {
    throw new Error(
      `Audit disposition ${candidate.fingerprint} cites non-candidate witnesses: ${unknownWitnesses.join(', ')}`,
    )
  }
  return { ...candidate, disposition: 'accepted', rationale: disposition.rationale }
}

async function readAudit(path: string): Promise<SelfHostAudit> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Partial<SelfHostAudit>
  if (value.format !== SELF_HOST_AUDIT_FORMAT || value.version !== 1 || !Array.isArray(value.dispositions)) {
    throw new Error('Self-host audit has an unsupported format or version.')
  }
  const seen = new Set<string>()
  for (const entry of value.dispositions) {
    if (
      !entry ||
      typeof entry.fingerprint !== 'string' ||
      entry.status !== 'accepted' ||
      typeof entry.rationale !== 'string' ||
      !Array.isArray(entry.witnesses) ||
      entry.witnesses.some((witness: unknown) => typeof witness !== 'string')
    ) throw new Error('Self-host audit contains an invalid disposition.')
    if (seen.has(entry.fingerprint)) throw new Error(`Duplicate audit fingerprint: ${entry.fingerprint}`)
    seen.add(entry.fingerprint)
  }
  return value as SelfHostAudit
}

function emptyAudit(): SelfHostAudit {
  return { format: SELF_HOST_AUDIT_FORMAT, version: 1, dispositions: [] }
}

function groupByProject(
  boundaries: readonly NativeModuleBoundary[],
): ReadonlyMap<string, readonly NativeModuleBoundary[]> {
  const grouped = new Map<string, NativeModuleBoundary[]>()
  for (const boundary of boundaries) {
    const values = grouped.get(boundary.project) ?? []
    values.push(boundary)
    grouped.set(boundary.project, values)
  }
  return new Map(
    [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([project, values]) => [project, values.sort((left, right) => left.id.localeCompare(right.id))]),
  )
}

function sameSummary(left: SelfHostFactSummary, right: SelfHostFactSummary): boolean {
  return stableJson(left) === stableJson(right)
}

function comparisonSummary(value: SelfHostFactSummary): unknown {
  return {
    semanticDigest: value.semanticDigest,
    boundFactDigest: value.boundFactDigest,
    manifestDigest: value.manifestDigest,
    facts: value.facts,
    factBytes: value.factBytes,
    namespaces: value.namespaces,
    capabilities: value.capabilities,
    candidates: value.candidateInputs.map((candidate) => candidate.fingerprint),
  }
}

function required<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key)
  if (!value) throw new Error(`Missing self-host result for ${String(key)}.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) {
    throw new Error(
      'Usage: node qualification/v2/self-host/qualify.ts --native-binary <path> --kernel-root <path> [--target codegraph|kernel] [--audit <path>] [--output <path>] [--write]',
    )
  }
  return value
}

function assertPortable(serialized: string, targets: readonly SelfHostTarget[], binary: string): void {
  const forbidden = [binary, dirname(binary), ...targets.map((target) => target.root)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
  for (const value of forbidden) {
    if (serialized.includes(value)) throw new Error(`Self-host output leaked an absolute physical path: ${value}`)
  }
}

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value, 'utf8')
  await rename(temporary, path)
}

function progress(target: string, message: string): void {
  process.stderr.write(`[self-host:${target}] ${message}\n`)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

await main()
