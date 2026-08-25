import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ModuleSourceReference } from '../resource/index.ts'
import type { ModuleFile, ModuleFileInventory } from './inventory.ts'
import type {
  ModuleTypeScriptAnalysis,
  ModuleTypeScriptIsolationGroupResult,
} from './typescript-model.ts'

export type {
  ModuleTypeScriptAnalysis,
  ModuleTypeScriptIsolationEntry,
  ModuleTypeScriptIsolationGroupResult,
} from './typescript-model.ts'

import { createTaskLimiter } from '../../compiler/limit.ts'
import {
  operationSnapshot,
  operationSnapshotNamespace,
  operationSourceText,
} from '../../source/operation-snapshot.ts'
import { workspacePackageCoordinate } from '../../typescript/package-coordinate.ts'
import { typeScriptSourceHasAmbientEffects } from '../../typescript/compiler-universe.optimization.ts'
import { sourceCoordinate } from '../../typescript/source.ts'
import {
  firstDeclaration,
  resolveAlias,
  semanticTokenIdentity,
} from '../../typescript/surface/symbol.ts'
import { AUTHORING_SPECIFIER, isAuthoringSpecifier, nodeDiagnostic } from './authoring-syntax.ts'
import { markAuthoringSyntaxSources } from './authoring-syntax.optimization.ts'
import {
  captureModuleTypeScriptEvidence,
  moduleTypeScriptResolutionKey,
  moduleTypeScriptEvidenceCurrent,
  type ModuleTypeScriptEvidence,
} from './typescript-evidence.ts'
import { createModuleTypeScriptEvidenceProjection } from './typescript-evidence.optimization.ts'
import {
  moduleTypeScriptProjectionObserver,
  observeModuleTypeScriptProgram,
  observeModuleTypeScriptProjection,
} from './typescript-program.optimization.ts'
import { canonicalModuleTypeScriptPath, deduplicateModuleSourceReferences } from './typescript-reference.optimization.ts'
import { analyzeModuleTypeScriptGroupsIsolated } from './typescript-process.optimization.ts'
import { visitModuleReferences } from './typescript-reference.ts'

type SourceRole =
  | 'api'
  | 'code'
  | 'internal'
  | 'port'
  | 'capability'
  | 'flow'
  | 'law'
  | 'state'
  | 'limits'
  | 'layout'
  | 'example'
  | 'benchmark'
  | 'package'

interface OwnedSource {
  readonly file: ModuleFile
  readonly role: SourceRole
}

interface CachedModuleTypeScriptAnalysis {
  readonly analysis: ModuleTypeScriptAnalysis
  readonly evidence: ModuleTypeScriptEvidence
  readonly cacheable?: boolean
}

const analysisCache = new Map<string, CachedModuleTypeScriptAnalysis>()
const analyses = createTaskLimiter(2)
// Retain one complete catalog wave; smaller caches deterministically evict before reuse.
const MAX_ANALYSES = 256
const SHARED_PROGRAM_ROOT_CAPACITY = 512
const operationAnalyses = operationSnapshotNamespace<Promise<CachedModuleTypeScriptAnalysis>>(
  'module-typescript-analyses',
)
const canonicalFile = canonicalModuleTypeScriptPath

interface AnalysisRequest {
  readonly inventory: ModuleFileInventory
  readonly sources: readonly OwnedSource[]
  readonly key: string
}

export interface ModuleTypeScriptCompilerUniverse {
  readonly options: ts.CompilerOptions
  readonly resolutionEdges: ReadonlyMap<string, ReadonlySet<string>>
  readonly program: ts.Program
  readonly defaults: ReadonlySet<string>
  readonly observedResolutions: ReadonlyMap<string, string | null>
  readonly compilerDiagnostics?: readonly ts.Diagnostic[]
  readonly onProjectionPhase?: (phase: ModuleTypeScriptProjectionPhase) => void
}

export interface ModuleTypeScriptProjectionPhase {
  readonly phase:
    | 'admission'
    | 'program'
    | 'diagnostics'
    | 'evidence-index'
    | 'owner-boundaries'
    | 'owner-closures'
    | 'owner-diagnostics'
    | 'owner-evidence'
    | 'owner-references'
  readonly durationMs: number
  readonly items: number
  readonly fallbacks?: number
  readonly workerPeakResidentBytes?: number
  readonly workerResidentUpperBoundBytes?: number
}

/** Project exact owner analyses from one already-admitted ambient-safe compiler universe. */
export async function projectModuleTypeScriptCompilerUniverse(
  catalogRoot: string,
  inventories: readonly ModuleFileInventory[],
  universe: ModuleTypeScriptCompilerUniverse,
): Promise<readonly ModuleTypeScriptAnalysis[]> {
  const requests = inventories.map((inventory): AnalysisRequest => {
    const sources = ownedSources(inventory)
    return { inventory, sources, key: analysisCacheKey(catalogRoot, sources) }
  })
  let started = performance.now()
  const unsafe = requests.filter((request) => !sharedProgramSafe(universe, request))
  observeModuleTypeScriptProjection(
    universe.onProjectionPhase, 'admission', performance.now() - started, requests.length,
  )
  if (unsafe.length) {
    throw new Error(`Compiler universe contains ${unsafe.length} ambient-unsafe owners.`)
  }
  const projected = await analyzeSharedProgram(catalogRoot, requests, universe)
  return requests.map((request) => projected.get(request.key)!.analysis)
}

/** Prime one coherent catalog wave with shared TypeScript Programs where semantics permit it. */
export async function prepareModuleTypeScriptAnalyses(
  catalogRoot: string,
  inventories: readonly ModuleFileInventory[],
  onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'],
  onScheduled?: () => void,
): Promise<void> {
  const snapshot = operationSnapshot(operationAnalyses)
  if (!snapshot) {
    onScheduled?.()
    await Promise.all(
      inventories.map((inventory) => analyzeModuleTypeScript(catalogRoot, inventory)),
    )
    return
  }
  const requests = inventories.map((inventory): AnalysisRequest => {
    const sources = ownedSources(inventory)
    return { inventory, sources, key: analysisCacheKey(catalogRoot, sources) }
  })
  const misses: AnalysisRequest[] = []
  await Promise.all(
    requests.map(async (request) => {
      const current = snapshot.get(request.key)
      if (current) return
      const cached = analysisCache.get(request.key)
      if (cached && (await currentAnalysis(catalogRoot, request.sources, cached))) {
        touchAnalysis(request.key, cached)
        snapshot.set(request.key, Promise.resolve(cached))
        return
      }
      analysisCache.delete(request.key)
      misses.push(request)
    }),
  )
  if (!misses.length) {
    onScheduled?.()
    return
  }

  const isolated = misses.length > 256
  const isolationStarted = performance.now()
  const prepared = (
    isolated
      ? analyzeModuleTypeScriptGroupsIsolated(
          catalogRoot,
          sharedProgramGroups(misses).map((group) => group.map((request) => request.inventory)),
        ).then((result) => {
          onProjectionPhase?.({
            phase: 'program',
            durationMs: performance.now() - isolationStarted,
            items: result.programs,
            fallbacks: 0,
            workerPeakResidentBytes: result.workerPeakResidentBytes,
            workerResidentUpperBoundBytes: result.workerResidentUpperBoundBytes,
          })
          return new Map(
            result.entries.map(({ key, analysis }) => [
              key,
              { analysis, evidence: { sources: [] }, cacheable: false } satisfies CachedModuleTypeScriptAnalysis,
            ]),
          )
        })
      : analyzeModuleTypeScriptBatchFresh(catalogRoot, misses, onProjectionPhase)
  ).catch(async (error: unknown) => {
      if (isolated) throw error
      // Preparation is an optimization. Unexpected shared-path failures retain exact independent
      // owner diagnostics while still publishing one pending result per owner.
      onProjectionPhase?.({
        phase: 'program',
        durationMs: performance.now() - isolationStarted,
        items: 0,
        fallbacks: 1,
      })
      const values = new Map<string, CachedModuleTypeScriptAnalysis>()
      await analyzeIndependently(catalogRoot, misses, values, onProjectionPhase)
      return values
    })
  const completed = misses.map((request) => {
    const result = prepared.then((values) => values.get(request.key)!)
    snapshot.set(request.key, result)
    return result.then((value) => rememberAnalysis(request.key, value))
  })
  onScheduled?.()
  await Promise.all(completed)
}

/** Worker entry: project one already-planned exact semantic group. */
export async function analyzeModuleTypeScriptIsolationGroup(
  catalogRoot: string,
  inventories: readonly ModuleFileInventory[],
): Promise<ModuleTypeScriptIsolationGroupResult> {
  const requests = inventories.map((inventory): AnalysisRequest => {
    const sources = ownedSources(inventory)
    return { inventory, sources, key: analysisCacheKey(catalogRoot, sources) }
  })
  let programs = 0
  const values = await analyzeModuleTypeScriptBatchFresh(
    catalogRoot,
    requests,
    (phase) => {
      if (phase.phase === 'program') programs += phase.items
    },
  )
  return {
    entries: requests.map((request) => ({
      key: request.key,
      analysis: values.get(request.key)!.analysis,
    })),
    programs,
  }
}

/** Typecheck all specification TypeScript and enforce local dependency-direction boundaries. */
export async function analyzeModuleTypeScript(
  catalogRoot: string,
  inventory: ModuleFileInventory,
): Promise<ModuleTypeScriptAnalysis> {
  const sources = ownedSources(inventory)
  const key = analysisCacheKey(catalogRoot, sources)
  const snapshot = operationSnapshot(operationAnalyses)
  const prepared = snapshot?.get(key)
  if (prepared) return (await prepared).analysis
  const cached = analysisCache.get(key)
  if (cached && (await currentAnalysis(catalogRoot, sources, cached))) {
    touchAnalysis(key, cached)
    snapshot?.set(key, Promise.resolve(cached))
    return cached.analysis
  }
  analysisCache.delete(key)
  // Pending work belongs to one coherent source snapshot. Do not leak an older in-flight analysis
  // into a rebuild that may already observe a newer revision.
  const running = snapshot?.get(key)
  if (running) return (await running).analysis
  const analysis = analyses.run(() => analyzeModuleTypeScriptFresh(catalogRoot, inventory, sources))
  snapshot?.set(key, analysis)
  const completed = await analysis
  rememberAnalysis(key, completed)
  return completed.analysis
}

function touchAnalysis(key: string, cached: CachedModuleTypeScriptAnalysis): void {
  analysisCache.delete(key)
  analysisCache.set(key, cached)
}

function rememberAnalysis(key: string, completed: CachedModuleTypeScriptAnalysis): void {
  if (completed.cacheable === false) return
  touchAnalysis(key, completed)
  while (analysisCache.size > MAX_ANALYSES) {
    const oldest = analysisCache.keys().next().value
    if (oldest === undefined) break
    analysisCache.delete(oldest)
  }
}

async function analyzeModuleTypeScriptFresh(
  catalogRoot: string,
  inventory: ModuleFileInventory,
  sources: readonly OwnedSource[],
): Promise<CachedModuleTypeScriptAnalysis> {
  try {
    return await analyzeModuleTypeScriptUnchecked(catalogRoot, inventory, sources)
  } catch (error) {
    return {
      analysis: {
        diagnostics: [
          {
            code: 'MODULE_TYPESCRIPT_ANALYSIS_FAILED',
            message: boundedErrorMessage(error),
            file: inventory.api.source,
            line: 1,
            column: 1,
          },
        ],
        references: [],
      },
      evidence: { sources: [] },
      cacheable: false,
    }
  }
}

async function analyzeModuleTypeScriptBatchFresh(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'],
): Promise<ReadonlyMap<string, CachedModuleTypeScriptAnalysis>> {
  const values = new Map<string, CachedModuleTypeScriptAnalysis>()
  for (const group of sharedProgramGroups(requests)) {
    try {
      const candidate = await createSharedProgramContext(catalogRoot, group, onProjectionPhase)
      const safe = group.filter((request) => sharedProgramSafe(candidate, request))
      const unsafe = group.filter((request) => !safe.includes(request))
      if (safe.length) {
        // The candidate can be reused only when every closure is isolation-safe. Otherwise an
        // ambient unsafe root may already have changed its diagnostics, so rebuild from safe roots.
        const context = unsafe.length ? undefined : candidate
        for (const [key, value] of await analyzeSharedProgram(
          catalogRoot,
          safe,
          context,
          onProjectionPhase,
        )) {
          values.set(key, value)
        }
      }
      await analyzeIndependently(catalogRoot, unsafe, values, onProjectionPhase)
    } catch {
      // Preserve per-module failure attribution and bounded error messages if the shared fast path
      // itself cannot be constructed.
      await analyzeIndependently(catalogRoot, group, values, onProjectionPhase)
    }
  }
  return values
}

function sharedProgramGroups(requests: readonly AnalysisRequest[]): readonly AnalysisRequest[][] {
  const groups: AnalysisRequest[][] = []
  let group: AnalysisRequest[] = []
  let roots = 0
  for (const request of requests) {
    if (group.length && roots + request.sources.length > SHARED_PROGRAM_ROOT_CAPACITY) {
      groups.push(group)
      group = []
      roots = 0
    }
    group.push(request)
    roots += request.sources.length
  }
  if (group.length) groups.push(group)
  return groups
}

async function analyzeIndependently(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  values: Map<string, CachedModuleTypeScriptAnalysis>,
  onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'],
): Promise<void> {
  await Promise.all(
    requests.map(async (request) => {
      values.set(
        request.key,
        await analyses.run(() =>
          analyzeModuleTypeScriptFresh(catalogRoot, request.inventory, request.sources),
        ),
      )
      observeModuleTypeScriptProgram(onProjectionPhase)
    }),
  )
}

async function analyzeSharedProgram(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  prepared?: ModuleTypeScriptCompilerUniverse,
  onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'],
): Promise<ReadonlyMap<string, CachedModuleTypeScriptAnalysis>> {
  const context =
    prepared ?? (await createSharedProgramContext(catalogRoot, requests, onProjectionPhase))
  const { options, program } = context
  const observe = moduleTypeScriptProjectionObserver(context.onProjectionPhase)
  markAuthoringSyntaxSources(
    requests.flatMap((request) =>
      request.sources.flatMap(({ file }) => {
        const parsed = program.getSourceFile(resolve(file.absolute))
        return parsed ? [{ source: file.source, file: parsed }] : []
      }),
    ),
  )
  let phase = performance.now()
  const compilerDiagnostics = (context.compilerDiagnostics ?? ts.getPreEmitDiagnostics(program))
    .filter(
      (entry) =>
        entry.category === ts.DiagnosticCategory.Error &&
        (options.skipLibCheck !== false || !entry.file?.isDeclarationFile),
    )
  observe('diagnostics', performance.now() - phase, compilerDiagnostics.length)
  phase = performance.now()
  const projectEvidence = createModuleTypeScriptEvidenceProjection(
    program,
    options,
    context.observedResolutions,
  )
  observe('evidence-index', performance.now() - phase, program.getSourceFiles().length)
  const output = new Map<string, CachedModuleTypeScriptAnalysis>()
  let closureMilliseconds = 0
  let diagnosticMilliseconds = 0
  let boundaryMilliseconds = 0
  let referenceMilliseconds = 0
  let evidenceMilliseconds = 0
  for (const request of requests) {
    const sourceByFile = new Map(
      request.sources.map(({ file }) => [canonicalFile(file.absolute), file.source]),
    )
    phase = performance.now()
    const closure = requestProgramFiles(context, request)
    closureMilliseconds += performance.now() - phase
    phase = performance.now()
    const diagnostics = compilerDiagnostics
      .filter((entry) => !entry.file || closure.has(canonicalFile(entry.file.fileName)))
      .map((entry) => compilerDiagnostic(catalogRoot, sourceByFile, entry))
    diagnosticMilliseconds += performance.now() - phase
    phase = performance.now()
    diagnostics.push(
      ...moduleBoundaryDiagnostics(catalogRoot, request.inventory, request.sources, program),
    )
    boundaryMilliseconds += performance.now() - phase
    phase = performance.now()
    const sourceFiles = program
      .getSourceFiles()
      .filter((file) => closure.has(canonicalFile(file.fileName)))
    const references = collectSourceReferences(catalogRoot, program, sourceByFile)
    referenceMilliseconds += performance.now() - phase
    phase = performance.now()
    const evidence = projectEvidence(sourceFiles)
    evidenceMilliseconds += performance.now() - phase
    output.set(request.key, {
      analysis: {
        diagnostics: deduplicate(diagnostics).slice(0, 200),
        references,
      },
      evidence,
    })
  }
  observe('owner-closures', closureMilliseconds, requests.length)
  observe('owner-diagnostics', diagnosticMilliseconds, requests.length)
  observe('owner-boundaries', boundaryMilliseconds, requests.length)
  observe('owner-references', referenceMilliseconds, requests.length)
  observe('owner-evidence', evidenceMilliseconds, requests.length)
  return output
}

async function createSharedProgramContext(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'],
): Promise<ModuleTypeScriptCompilerUniverse> {
  const options = compilerOptions()
  const resolutionEdges = new Map<string, Set<string>>()
  const observedResolutions = new Map<string, string | null>()
  const host = compilerHost(options, catalogRoot, (from, specifier, mode, target) => {
    observedResolutions.set(
      moduleTypeScriptResolutionKey('module', canonicalFile(from), specifier, mode),
      target ? canonicalFile(target) : null,
    )
    if (!target) return
    const values = resolutionEdges.get(canonicalFile(from)) ?? new Set<string>()
    values.add(canonicalFile(target))
    resolutionEdges.set(canonicalFile(from), values)
  })
  const roots = [
    ...new Set(
      requests.flatMap((request) =>
        request.sources.map(({ file }) => canonicalFile(file.absolute)),
      ),
    ),
  ]
  const started = performance.now()
  const program = ts.createProgram({ rootNames: roots, options, host })
  observeModuleTypeScriptProgram(onProjectionPhase, performance.now() - started)
  const defaults = new Set(
    program
      .getSourceFiles()
      .filter((file) => program.isSourceFileDefaultLibrary(file))
      .map((file) => canonicalFile(file.fileName)),
  )
  return {
    options,
    resolutionEdges,
    program,
    defaults,
    observedResolutions,
    ...(onProjectionPhase ? { onProjectionPhase } : {}),
  }
}

function sharedProgramSafe(
  context: ModuleTypeScriptCompilerUniverse,
  request: AnalysisRequest,
): boolean {
  const closure = requestProgramFiles(context, request)
  for (const file of closure) {
    if (context.defaults.has(file)) continue
    const parsed = context.program.getSourceFile(file)
    if (parsed && typeScriptSourceHasAmbientEffects(parsed)) return false
  }
  return true
}

function requestProgramFiles(
  context: ModuleTypeScriptCompilerUniverse,
  request: AnalysisRequest,
): ReadonlySet<string> {
  return reachableProgramFiles(
    context.program,
    request.sources.map(({ file }) => canonicalFile(file.absolute)),
    context.resolutionEdges,
    context.defaults,
  )
}

function reachableProgramFiles(
  program: ts.Program,
  roots: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  defaults: ReadonlySet<string>,
): ReadonlySet<string> {
  const closure = new Set([...roots, ...defaults])
  const pending = [...roots]
  while (pending.length) {
    const file = pending.pop()!
    for (const target of edges.get(file) ?? []) {
      if (closure.has(target) || !program.getSourceFile(target)) continue
      closure.add(target)
      pending.push(target)
    }
    const parsed = program.getSourceFile(file)
    if (!parsed) continue
    for (const reference of parsed.referencedFiles) {
      const target = canonicalFile(resolve(dirname(file), reference.fileName))
      if (closure.has(target) || !program.getSourceFile(target)) continue
      closure.add(target)
      pending.push(target)
    }
    for (const reference of parsed.typeReferenceDirectives) {
      const resolved = ts.resolveTypeReferenceDirective(
        reference.fileName,
        file,
        program.getCompilerOptions(),
        ts.sys,
        undefined,
        undefined,
        reference.resolutionMode,
      ).resolvedTypeReferenceDirective?.resolvedFileName
      if (!resolved) continue
      const target = canonicalFile(resolved)
      if (closure.has(target) || !program.getSourceFile(target)) continue
      closure.add(target)
      pending.push(target)
    }
  }
  return closure
}

async function analyzeModuleTypeScriptUnchecked(
  catalogRoot: string,
  inventory: ModuleFileInventory,
  sources: readonly OwnedSource[],
): Promise<CachedModuleTypeScriptAnalysis> {
  const options = compilerOptions()
  const host = compilerHost(options, catalogRoot)
  const sourceByFile = new Map(
    sources.map(({ file }) => [canonicalFile(file.absolute), file.source]),
  )
  const program = ts.createProgram({
    rootNames: sources.map(({ file }) => file.absolute),
    options,
    host,
  })
  markAuthoringSyntaxSources(
    sources.flatMap(({ file }) => {
      const parsed = program.getSourceFile(resolve(file.absolute))
      return parsed ? [{ source: file.source, file: parsed }] : []
    }),
  )
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
    .map((entry) => compilerDiagnostic(catalogRoot, sourceByFile, entry))

  diagnostics.push(
    ...moduleBoundaryDiagnostics(catalogRoot, inventory, sources, program),
  )

  return {
    analysis: {
      diagnostics: deduplicate(diagnostics).slice(0, 200),
      references: collectSourceReferences(catalogRoot, program, sourceByFile),
    },
    evidence: captureModuleTypeScriptEvidence(program, options),
  }
}

function moduleBoundaryDiagnostics(
  catalogRoot: string,
  inventory: ModuleFileInventory,
  sources: readonly OwnedSource[],
  program: ts.Program,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const roles = new Map(sources.map((source) => [resolve(source.file.absolute), source]))
  const api = resolve(inventory.api.absolute)
  for (const source of sources) {
    const parsed = program.getSourceFile(resolve(source.file.absolute))
    if (!parsed) continue
    if (!hasExplicitModuleSyntax(parsed)) {
      diagnostics.push(
        nodeDiagnostic(
          'MODULE_TYPESCRIPT_NOT_MODULE',
          'Specification TypeScript files must use explicit imports or exports.',
          source.file.source,
          parsed,
          parsed,
        ),
      )
    }
    let importsPublicApi = false
    visitModuleReferences(parsed, (specifier, node, dynamic) => {
      if (dynamic) {
        diagnostics.push(
          nodeDiagnostic(
            'MODULE_DYNAMIC_IMPORT_INVALID',
            'Specification TypeScript cannot use dynamic imports.',
            source.file.source,
            parsed,
            node,
          ),
        )
        return
      }
      if (isAuthoringSpecifier(specifier)) return
      if (specifier.startsWith('#')) {
        diagnostics.push(
          nodeDiagnostic(
            'MODULE_IMPORT_PRIVATE_INVALID',
            'Package-private import-map specifiers are implementation dependencies, not specification boundaries.',
            source.file.source,
            parsed,
            node,
          ),
        )
        return
      }
      if (!relativeSpecifier(specifier)) return
      const candidates = importCandidates(source.file.absolute, specifier)
      if (candidates.some((candidate) => candidate === api)) importsPublicApi = true
      const owned = candidates.map((candidate) => roles.get(candidate)).find(Boolean)
      if (owned) {
        if (resolve(owned.file.absolute) === resolve(source.file.absolute)) return
        if (localImportAllowed(source.role, owned.role)) return
        diagnostics.push(
          nodeDiagnostic(
            'MODULE_IMPORT_BOUNDARY_INVALID',
            `${source.role} specifications cannot import ${owned.role} artifacts.`,
            source.file.source,
            parsed,
            node,
          ),
        )
        return
      }
      if (
        candidates.some((candidate) => permittedPublicApi(catalogRoot, candidate))
      )
        return
      const target = candidates[0]!
      const location = portable(relative(catalogRoot, target))
      diagnostics.push(
        nodeDiagnostic(
          'MODULE_IMPORT_BOUNDARY_INVALID',
          `Relative specification imports must target a public .spec/api.d.ts contract; resolved from ${location}.`,
          source.file.source,
          parsed,
          node,
        ),
      )
    })
    if (source.role === 'example' && !importsPublicApi) {
      diagnostics.push({
        code: 'EXAMPLE_TARGET_NOT_IMPORTED',
        message: 'Examples must import the module public contract from ../api.js.',
        file: source.file.source,
        line: 1,
        column: 1,
      })
    }
  }
  return diagnostics
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const limit = 2_000
  return message.length <= limit
    ? `TypeScript specification analysis failed: ${message}`
    : `TypeScript specification analysis failed: ${message.slice(0, limit)}…`
}

async function currentAnalysis(
  _catalogRoot: string,
  _sources: readonly OwnedSource[],
  cached: CachedModuleTypeScriptAnalysis,
): Promise<boolean> {
  try {
    return await moduleTypeScriptEvidenceCurrent(cached.evidence, compilerOptions())
  } catch {
    return false
  }
}

function analysisCacheKey(catalogRoot: string, sources: readonly OwnedSource[]): string {
  return JSON.stringify({
    root: canonicalFile(catalogRoot),
    sources: sources
      .map(({ file, role }) => ({ file: canonicalFile(file.absolute), role }))
      .sort((left, right) => compare(left.file, right.file) || compare(left.role, right.role)),
  })
}

function collectSourceReferences(
  catalogRoot: string,
  program: ts.Program,
  sourceByFile: ReadonlyMap<string, string>,
): ModuleSourceReference[] {
  const checker = program.getTypeChecker()
  const root = canonicalFile(catalogRoot)
  const references: ModuleSourceReference[] = []
  for (const file of program.getSourceFiles()) {
    const source = sourceByFile.get(canonicalFile(file.fileName))
    if (!source) continue
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
        const symbol = checker.getSymbolAtLocation(node)
        if (symbol) {
          const target = resolveAlias(checker, symbol)
          const declaration = firstDeclaration(target)
          if (declaration && !declarationNamesNode(declaration, node)) {
            const targetFile = canonicalFile(declaration.getSourceFile().fileName)
            const targetCoordinate = sourceCoordinate(root, targetFile)
            const targetIsOwned = sourceByFile.has(targetFile)
            const targetIsPublicApi = publicApiCandidate(targetFile)
            if (
              targetCoordinate.kind === 'catalog' &&
              (targetIsOwned || targetIsPublicApi) &&
              targetCoordinate.file !== source
            ) {
              const targetNode = declarationName(declaration) ?? declaration
              const targetStart =
                targetNode === targetNode.getSourceFile()
                  ? 0
                  : targetNode.getStart(targetNode.getSourceFile(), false)
              const position = targetNode.getSourceFile().getLineAndCharacterOfPosition(targetStart)
              references.push({
                source,
                from: node.getStart(file, false),
                to: node.getEnd(),
                text: node.getText(file),
                target: {
                  source: targetCoordinate.file,
                  from: targetStart,
                  line: position.line + 1,
                  column: position.character + 1,
                  ...(ts.isSourceFile(declaration)
                    ? {}
                    : { declaration: semanticTokenIdentity(checker, target, root) }),
                },
              })
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return [...deduplicateModuleSourceReferences(references)].sort(
      (left, right) =>
        compare(left.source, right.source) || left.from - right.from || left.to - right.to,
    )
}

function declarationName(declaration: ts.Declaration): ts.DeclarationName | undefined {
  return (declaration as ts.NamedDeclaration).name
}

function declarationNamesNode(declaration: ts.Declaration, node: ts.Node): boolean {
  return declarationName(declaration) === node
}

function ownedSources(inventory: ModuleFileInventory): OwnedSource[] {
  return [
    { file: inventory.api, role: 'api' },
    ...withRole(inventory.apiFragments, 'api'),
    ...(inventory.code ? [{ file: inventory.code, role: 'code' } as const] : []),
    ...(inventory.internal ? [{ file: inventory.internal, role: 'internal' } as const] : []),
    ...withRole(inventory.ports, 'port'),
    ...withRole(inventory.capabilities, 'capability'),
    ...withRole(inventory.flows, 'flow'),
    ...withRole(inventory.laws, 'law'),
    ...withRole(inventory.states, 'state'),
    ...(inventory.limits ? [{ file: inventory.limits, role: 'limits' } as const] : []),
    ...(inventory.layout ? [{ file: inventory.layout, role: 'layout' } as const] : []),
    ...withRole(inventory.examples, 'example'),
    ...withRole(inventory.benchmarks, 'benchmark'),
    ...withRole(inventory.packages, 'package'),
    ...(inventory.packageExceptions
      ? [{ file: inventory.packageExceptions, role: 'package' } as const]
      : []),
  ]
}

function withRole<Role extends SourceRole>(
  files: readonly ModuleFile[],
  role: Role,
): { file: ModuleFile; role: Role }[] {
  return files.map((file) => ({ file, role }))
}

function compilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    types: [],
    ignoreDeprecations: '6.0',
  }
}

function compilerHost(
  options: ts.CompilerOptions,
  catalogRoot: string,
  onResolution?: (
    containingFile: string,
    specifier: string,
    mode: ts.ResolutionMode,
    resolvedFile?: string,
  ) => void,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  host.readFile = (file) => operationSourceText(file)?.text ?? readFile(file)
  const authoring = ts.resolveModuleName(
    AUTHORING_SPECIFIER,
    fileURLToPath(import.meta.url),
    options,
    ts.sys,
  ).resolvedModule
  const resolveModule = (specifier: string, containingFile: string, mode: ts.ResolutionMode) => {
    if (isAuthoringSpecifier(specifier) && authoring) {
      onResolution?.(containingFile, specifier, mode, authoring.resolvedFileName)
      return authoring
    }
    const resolved = ts.resolveModuleName(
      specifier,
      containingFile,
      options,
      host,
      undefined,
      undefined,
      mode,
    ).resolvedModule
    if (
      resolved &&
      withinCatalog(catalogRoot, containingFile) &&
      relativeSpecifier(specifier) &&
      !withinCatalog(catalogRoot, resolved.resolvedFileName) &&
      !permittedPublicApi(catalogRoot, resolved.resolvedFileName)
    ) {
      onResolution?.(containingFile, specifier, mode)
      return
    }
    onResolution?.(containingFile, specifier, mode, resolved?.resolvedFileName)
    return resolved
  }
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    _redirectedReference,
    compilerOptions,
    containingSourceFile,
  ) =>
    literals.map((literal) => ({
      resolvedModule: resolveModule(
        literal.text,
        containingFile,
        ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions),
      ),
    }))
  return host
}

function compilerDiagnostic(
  catalogRoot: string,
  sourceByFile: ReadonlyMap<string, string>,
  entry: ts.Diagnostic,
): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(entry.messageText, '\n')
  if (!entry.file || entry.start === undefined) {
    return {
      code: `MODULE_TYPESCRIPT_${entry.code}`,
      message,
      file: '.',
      line: 1,
      column: 1,
    }
  }
  const position = entry.file.getLineAndCharacterOfPosition(entry.start)
  const knownSource = sourceByFile.get(canonicalFile(entry.file.fileName))
  const coordinate = knownSource
    ? undefined
    : sourceCoordinate(canonicalFile(catalogRoot), canonicalFile(entry.file.fileName))
  return {
    code: `MODULE_TYPESCRIPT_${entry.code}`,
    message,
    file: knownSource ?? (coordinate?.kind === 'catalog' ? coordinate.file : coordinate!.external),
    line: position.line + 1,
    column: position.character + 1,
  }
}

function hasExplicitModuleSyntax(file: ts.SourceFile): boolean {
  return file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      Boolean(
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      ),
  )
}

function localImportAllowed(from: SourceRole, to: SourceRole): boolean {
  if (from === 'example') return to === 'api'
  if (from === 'api') return to === 'api'
  if (from === 'internal' || from === 'port' || from === 'limits') {
    return to === 'api' || to === 'internal'
  }
  if (from === 'flow') {
    return !['example', 'package', 'benchmark'].includes(to)
  }
  return false
}

function relativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || isAbsolute(specifier)
}

function importCandidates(from: string, specifier: string): string[] {
  const target = resolve(dirname(from), specifier)
  const values = [target]
  if (/\.[cm]?js$/u.test(target)) {
    const base = target.replace(/\.[cm]?js$/u, '')
    values.push(
      `${base}.ts`,
      `${base}.d.ts`,
      `${base}.mts`,
      `${base}.d.mts`,
      `${base}.cts`,
      `${base}.d.cts`,
    )
  } else if (!/\.[cm]?tsx?$|\.d\.[cm]?ts$/u.test(target)) {
    values.push(
      `${target}.ts`,
      `${target}.d.ts`,
      resolve(target, 'index.ts'),
      resolve(target, 'index.d.ts'),
    )
  }
  return [...new Set(values.map((value) => resolve(value)))]
}

function publicApiCandidate(candidate: string): boolean {
  return portable(candidate).endsWith('/.spec/api.d.ts')
}

function permittedPublicApi(
  catalogRoot: string,
  candidate: string,
): boolean {
  if (!publicApiCandidate(candidate)) return false
  return (
    withinCatalog(catalogRoot, candidate) ||
    workspacePackageCoordinate(catalogRoot, candidate) !== undefined
  )
}

function withinCatalog(root: string, target: string): boolean {
  const path = relative(canonicalFile(root), canonicalFile(target))
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function deduplicate(values: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify([
      value.code,
      value.message,
      value.file,
      value.line,
      value.column,
      value.pointer,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
