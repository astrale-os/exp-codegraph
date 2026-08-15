import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ModuleSourceReference } from '../resource/index.ts'
import type { ModuleFile, ModuleFileInventory } from './inventory.ts'

import {
  cacheEntries,
  record,
  restoreCacheEntries,
  stringRecord,
  type RestorableCache,
} from '../../cache/memory.ts'
import { createTaskLimiter } from '../../compiler/limit.ts'
import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.ts'
import { workspacePackageCoordinate } from '../../typescript/package-coordinate.ts'
import { sourceCoordinate } from '../../typescript/source.ts'
import {
  firstDeclaration,
  resolveAlias,
  semanticTokenIdentity,
} from '../../typescript/surface/symbol.ts'
import { AUTHORING_SPECIFIER, isAuthoringSpecifier, nodeDiagnostic } from './authoring-syntax.ts'
import {
  captureModuleTypeScriptEvidence,
  moduleTypeScriptEvidenceCurrent,
  type ModuleTypeScriptEvidence,
} from './typescript-evidence.ts'
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

export interface ModuleTypeScriptAnalysis {
  readonly diagnostics: readonly Diagnostic[]
  readonly references: readonly ModuleSourceReference[]
}

interface CachedModuleTypeScriptAnalysis {
  readonly analysis: ModuleTypeScriptAnalysis
  readonly evidence: ModuleTypeScriptEvidence
  readonly cacheable?: boolean
}

const analysisCache = new Map<string, CachedModuleTypeScriptAnalysis>()
const analyses = createTaskLimiter(2)
// Retain one complete kernel catalog wave. A smaller cache deterministically evicts entries just
// before the next traversal reaches them, while cached values contain evidence rather than Programs.
const MAX_ANALYSES = 256
// Bound temporary checker state independently from catalog size. Thirty-two modules still share
// libraries and public dependencies aggressively without retaining one catalog-wide Program.
const SHARED_PROGRAM_MODULE_CAPACITY = 32
const operationAnalyses = operationSnapshotNamespace<Promise<CachedModuleTypeScriptAnalysis>>(
  'module-typescript-analyses',
)

export const moduleTypeScriptAnalysisCache: RestorableCache = {
  snapshot: (scope) =>
    cacheEntries(
      new Map(
        [...analysisCache].filter(([key]) => analysisCacheRoot(key) === canonicalFile(scope)),
      ),
    ),
  restore(scope, snapshot) {
    const root = canonicalFile(scope)
    for (const key of analysisCache.keys())
      if (analysisCacheRoot(key) === root) analysisCache.delete(key)
    for (const [key, cached] of restoreCacheEntries(snapshot, MAX_ANALYSES, isCachedAnalysis)) {
      analysisCache.set(key, cached)
    }
  },
}

function analysisCacheRoot(key: string): string | undefined {
  try {
    const value: unknown = JSON.parse(key)
    return record(value) && typeof value.root === 'string' ? value.root : undefined
  } catch {
    return
  }
}

interface AnalysisRequest {
  readonly inventory: ModuleFileInventory
  readonly sources: readonly OwnedSource[]
  readonly key: string
}

interface SharedProgramContext {
  readonly options: ts.CompilerOptions
  readonly resolutionEdges: ReadonlyMap<string, ReadonlySet<string>>
  readonly program: ts.Program
  readonly defaults: ReadonlySet<string>
}

function isCachedAnalysis(value: unknown): value is CachedModuleTypeScriptAnalysis {
  if (!record(value) || !record(value.analysis) || !record(value.evidence)) return false
  return (
    Array.isArray(value.analysis.diagnostics) &&
    Array.isArray(value.analysis.references) &&
    Array.isArray(value.evidence.dependencies) &&
    value.evidence.dependencies.every(stringRecord) &&
    Array.isArray(value.evidence.resolutions) &&
    value.evidence.resolutions.every(
      (resolution) =>
        record(resolution) &&
        (resolution.kind === 'module' ||
          resolution.kind === 'path' ||
          resolution.kind === 'type') &&
        typeof resolution.containingFile === 'string' &&
        typeof resolution.specifier === 'string' &&
        (resolution.resolvedFile === undefined || typeof resolution.resolvedFile === 'string'),
    ) &&
    value.cacheable !== false
  )
}

/** Prime one coherent catalog wave with shared TypeScript Programs where semantics permit it. */
export async function prepareModuleTypeScriptAnalyses(
  catalogRoot: string,
  inventories: readonly ModuleFileInventory[],
): Promise<void> {
  const snapshot = operationSnapshot(operationAnalyses)
  if (!snapshot) {
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
  if (!misses.length) return

  try {
    const values = await analyzeModuleTypeScriptBatchFresh(catalogRoot, misses)
    for (const request of misses) {
      const completed = values.get(request.key)!
      snapshot.set(request.key, Promise.resolve(completed))
      rememberAnalysis(request.key, completed)
    }
  } catch {
    // Preparation is an optimization. Unexpected shared-path failures must retain the normal
    // per-module diagnostics and bounded two-Program execution contract.
    await Promise.all(
      misses.map((request) => analyzeModuleTypeScript(catalogRoot, request.inventory)),
    )
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
      evidence: { dependencies: [], resolutions: [] },
      cacheable: false,
    }
  }
}

async function analyzeModuleTypeScriptBatchFresh(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
): Promise<ReadonlyMap<string, CachedModuleTypeScriptAnalysis>> {
  const values = new Map<string, CachedModuleTypeScriptAnalysis>()
  for (let index = 0; index < requests.length; index += SHARED_PROGRAM_MODULE_CAPACITY) {
    const group = requests.slice(index, index + SHARED_PROGRAM_MODULE_CAPACITY)
    try {
      const candidate = await createSharedProgramContext(catalogRoot, group)
      const safe = group.filter((request) => sharedProgramSafe(candidate, request))
      const unsafe = group.filter((request) => !safe.includes(request))
      if (safe.length) {
        // The candidate can be reused only when every closure is isolation-safe. Otherwise an
        // ambient unsafe root may already have changed its diagnostics, so rebuild from safe roots.
        const context = unsafe.length ? undefined : candidate
        for (const [key, value] of await analyzeSharedProgram(catalogRoot, safe, context)) {
          values.set(key, value)
        }
      }
      await analyzeIndependently(catalogRoot, unsafe, values)
    } catch {
      // Preserve per-module failure attribution and bounded error messages if the shared fast path
      // itself cannot be constructed.
      await analyzeIndependently(catalogRoot, group, values)
    }
  }
  return values
}

async function analyzeIndependently(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  values: Map<string, CachedModuleTypeScriptAnalysis>,
): Promise<void> {
  await Promise.all(
    requests.map(async (request) => {
      values.set(
        request.key,
        await analyses.run(() =>
          analyzeModuleTypeScriptFresh(catalogRoot, request.inventory, request.sources),
        ),
      )
    }),
  )
}

async function analyzeSharedProgram(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
  prepared?: SharedProgramContext,
): Promise<ReadonlyMap<string, CachedModuleTypeScriptAnalysis>> {
  const context = prepared ?? (await createSharedProgramContext(catalogRoot, requests))
  const { options, program } = context
  const compilerDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
  const output = new Map<string, CachedModuleTypeScriptAnalysis>()
  for (const request of requests) {
    const sourceByFile = new Map(
      request.sources.map(({ file }) => [canonicalFile(file.absolute), file.source]),
    )
    const closure = requestProgramFiles(context, request)
    const diagnostics = compilerDiagnostics
      .filter((entry) => !entry.file || closure.has(canonicalFile(entry.file.fileName)))
      .map((entry) => compilerDiagnostic(catalogRoot, sourceByFile, entry))
    diagnostics.push(
      ...moduleBoundaryDiagnostics(catalogRoot, request.inventory, request.sources, program),
    )
    const sourceFiles = program
      .getSourceFiles()
      .filter((file) => closure.has(canonicalFile(file.fileName)))
    output.set(request.key, {
      analysis: {
        diagnostics: deduplicate(diagnostics).slice(0, 200),
        references: collectSourceReferences(catalogRoot, program, sourceByFile),
      },
      evidence: captureModuleTypeScriptEvidence(program, options, sourceFiles),
    })
  }
  return output
}

async function createSharedProgramContext(
  catalogRoot: string,
  requests: readonly AnalysisRequest[],
): Promise<SharedProgramContext> {
  const options = compilerOptions()
  const resolutionEdges = new Map<string, Set<string>>()
  const host = compilerHost(options, catalogRoot, (from, target) => {
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
  const program = ts.createProgram({ rootNames: roots, options, host })
  const defaults = new Set(
    program
      .getSourceFiles()
      .filter((file) => program.isSourceFileDefaultLibrary(file))
      .map((file) => canonicalFile(file.fileName)),
  )
  return { options, resolutionEdges, program, defaults }
}

function sharedProgramSafe(context: SharedProgramContext, request: AnalysisRequest): boolean {
  const closure = requestProgramFiles(context, request)
  for (const file of closure) {
    if (context.defaults.has(file)) continue
    const parsed = context.program.getSourceFile(file)
    if (parsed && ambientEffects(parsed)) return false
  }
  return true
}

function requestProgramFiles(
  context: SharedProgramContext,
  request: AnalysisRequest,
): ReadonlySet<string> {
  return reachableProgramFiles(
    context.program,
    request.sources.map(({ file }) => canonicalFile(file.absolute)),
    context.resolutionEdges,
    context.defaults,
  )
}

function ambientEffects(parsed: ts.SourceFile): boolean {
  if (!ts.isExternalModule(parsed) || parsed.libReferenceDirectives.length > 0) return true
  let unsafe = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isNamespaceExportDeclaration(node) ||
      (ts.isModuleDeclaration(node) &&
        ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(node.name)))
    ) {
      unsafe = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return unsafe
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
  return references
    .filter(
      (reference, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.source === reference.source &&
            candidate.from === reference.from &&
            candidate.to === reference.to,
        ) === index,
    )
    .sort(
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
  onResolution?: (containingFile: string, resolvedFile?: string) => void,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  const authoring = ts.resolveModuleName(
    AUTHORING_SPECIFIER,
    fileURLToPath(import.meta.url),
    options,
    ts.sys,
  ).resolvedModule
  const resolveModule = (specifier: string, containingFile: string, mode: ts.ResolutionMode) => {
    if (isAuthoringSpecifier(specifier) && authoring) {
      onResolution?.(containingFile, authoring.resolvedFileName)
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
      onResolution?.(containingFile)
      return
    }
    onResolution?.(containingFile, resolved?.resolvedFileName)
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

function canonicalFile(path: string): string {
  const absolute = resolve(path)
  return ts.sys.realpath ? ts.sys.realpath(absolute) : absolute
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
