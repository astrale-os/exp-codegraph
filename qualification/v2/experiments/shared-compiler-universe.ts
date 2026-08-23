import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  compileDeclarationApis,
  projectDeclarationCompilerUniverse,
} from '../../../api/project.ts'
import { createDeclarationSourceCorpus } from '../../../api/source-corpus.ts'
import { isExternalSpecifier, renderExternalModules } from '../../../api/external.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/index.ts'
import { compileApisIsolated } from '../../../compiler/isolate.ts'
import { withOperationSnapshot } from '../../../source/operation-snapshot.ts'
import {
  MODULE_LAYOUT_PROFILE_ID,
  MODULE_SCHEMA_PROFILE_ID,
  MODULE_TEST_EVIDENCE_PROFILE_ID,
  SPECIFICATION_VALIDITY_PROFILE_ID,
} from '../../../conformance/index.ts'
import { inventoryModuleFiles, type ModuleFileInventory } from '../../../specification/module/inventory.ts'
import {
  analyzeModuleTypeScript,
  prepareModuleTypeScriptAnalyses,
  projectModuleTypeScriptCompilerUniverse,
} from '../../../specification/module/typescript.ts'
import { moduleTypeScriptResolutionKey } from '../../../specification/module/typescript-evidence.ts'
import { canonicalModuleTypeScriptPath } from '../../../specification/module/typescript-reference.optimization.ts'
import {
  AUTHORING_SPECIFIER,
  isAuthoringSpecifier,
} from '../../../specification/module/authoring-syntax.ts'
import { typeScriptSourceHasAmbientEffects } from '../../../typescript/compiler-universe.optimization.ts'

const root = resolve(requiredArgument('--root'))
const options = compilerOptions()
const execute = promisify(execFileCallback)
const workerPlan = argument('--worker-plan')

if (workerPlan) await runWorker(resolve(workerPlan))
else await runDriver()

async function runDriver(): Promise<void> {
  const cacheDirectory = resolve(requiredArgument('--cache'))
  const output = resolve(requiredArgument('--output'))
  const service = await createNodeTypeSpecApplicationService({
    root,
    cacheDirectory,
    persistence: 'advisory',
  })
  const temporary = await mkdtemp(join(tmpdir(), 'codegraph-compiler-universe-'))
  try {
  const admittedStarted = performance.now()
  const selected = await service.refresh({
    requestedCapabilities: [],
    qualify: true,
    compilerAnalysis: false,
    requestedProfiles: [
      SPECIFICATION_VALIDITY_PROFILE_ID,
      MODULE_LAYOUT_PROFILE_ID,
      MODULE_SCHEMA_PROFILE_ID,
      MODULE_TEST_EVIDENCE_PROFILE_ID,
    ],
    exclude: [],
    select: ['backend'],
    focused: true,
    includeDependents: false,
    requireCompleteLayout: true,
    requireExactLayout: false,
  })
  const admissionMilliseconds = performance.now() - admittedStarted
  const planningStarted = performance.now()
  const owners = await Promise.all(
    selected.snapshot.specifications.map(async (specification): Promise<Owner> => {
      const directory = resolve(root, specification.root, '.spec')
      const inventory = await inventoryModuleFiles(root, directory)
      const roots = ownedRoots(inventory)
      return {
        source: specification.source,
        directory,
        api: inventory.api.absolute,
        roots,
        ambient: roots.some(sourceHasAmbientEffects),
      }
    }),
  )
  owners.sort((left, right) => left.source.localeCompare(right.source))
  const planningMilliseconds = performance.now() - planningStarted
  const plan = resolve(temporary, 'owners.json')
  await writeFile(plan, stableJson(owners), 'utf8')
  const planOutput = argument('--plan-output')
  if (planOutput) await writeFile(resolve(planOutput), stableJson(owners), 'utf8')

  const variants: UniverseVariant[] = []
  for (const requestedComponents of [1, 2, 4]) {
    variants.push(await runVariantWorker(plan, requestedComponents))
  }
  const declarations = {
    sharedProcess: await runDeclarationWorker(plan, 'shared-process'),
    isolatedWorkers: await runDeclarationWorker(plan, 'isolated-workers'),
    semanticOnly: await runDeclarationWorker(plan, 'semantic-only'),
    semanticOnlyIsolated: await runDeclarationWorker(plan, 'semantic-only-isolated'),
    integratedProjection: await runDeclarationWorker(plan, 'integrated-projection'),
  }
  const reference = variants[0]!
  const comparisons = variants.slice(1).map((variant) => ({
    requestedComponents: variant.requestedComponents,
    exportDigestEqual: variant.exportDigest === reference.exportDigest,
    diagnosticDigestEqual: variant.diagnosticDigest === reference.diagnosticDigest,
    missingApisEqual: stableJson(variant.missingApis) === stableJson(reference.missingApis),
  }))
  const body = {
    format: 'astrale.codegraph.shared-compiler-universe-experiment' as const,
    version: 1 as const,
    subject: {
      root,
      inventory: selected.snapshot.inventory,
      application: selected.snapshot.id,
      selectedOwners: owners.length,
      ambientOwners: owners.filter((owner) => owner.ambient).map((owner) => owner.source),
      uniqueOwnedRoots: new Set(owners.flatMap((owner) => owner.roots)).size,
    },
    admissionMilliseconds: round(admissionMilliseconds),
    planningMilliseconds: round(planningMilliseconds),
    workerIsolation: 'fresh-process-per-variant' as const,
    variants,
    declarations,
    declarationOutputsEqual:
      declarations.sharedProcess.outputDigest === declarations.isolatedWorkers.outputDigest,
    comparisons,
    exactAcrossPartitions: comparisons.every(
      (comparison) =>
        comparison.exportDigestEqual &&
        comparison.diagnosticDigestEqual &&
        comparison.missingApisEqual,
    ),
  }
  const evidence = {
    ...body,
    evidenceSha256: digest(stableJson(body)),
  }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  } finally {
    await service.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
}

async function runVariantWorker(
  plan: string,
  requestedComponents: number,
): Promise<UniverseVariant> {
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      ...process.execArgv,
      import.meta.filename,
      '--root',
      root,
      '--worker-plan',
      plan,
      '--worker-kind',
      'universe',
      '--components',
      String(requestedComponents),
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  if (stderr.trim()) throw new Error(`CompilerUniverse worker emitted stderr: ${stderr.trim()}`)
  return JSON.parse(stdout) as UniverseVariant
}

async function runDeclarationWorker(
  plan: string,
  kind: DeclarationWorkerResult['kind'],
): Promise<DeclarationWorkerResult> {
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      ...process.execArgv,
      import.meta.filename,
      '--root',
      root,
      '--worker-plan',
      plan,
      '--worker-kind',
      kind,
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  if (stderr.trim()) throw new Error(`Declaration worker emitted stderr: ${stderr.trim()}`)
  return JSON.parse(stdout) as DeclarationWorkerResult
}

async function runWorker(plan: string): Promise<void> {
  const kind = argument('--worker-kind') ?? 'universe'
  if (kind === 'integrated-combined') {
    await runIntegratedCombinedMeasurement(plan)
    return
  }
  if (kind === 'module-oracle' || kind === 'integrated-module') {
    await runModuleMeasurement(plan, kind)
    return
  }
  if (
    kind === 'shared-process' ||
    kind === 'isolated-workers' ||
    kind === 'semantic-only' ||
    kind === 'semantic-only-isolated' ||
    kind === 'semantic-only-isolated-48' ||
    kind === 'semantic-only-isolated-24' ||
    kind === 'diagnostics-only-isolated' ||
    kind === 'integrated-diagnostics' ||
    kind === 'integrated-projection'
  ) {
    await runDeclarationMeasurement(plan, kind)
    return
  }
  if (kind !== 'universe') throw new Error('--worker-kind is invalid.')
  const requestedComponents = Number(requiredArgument('--components'))
  if (![1, 2, 4].includes(requestedComponents)) {
    throw new Error('--components must be 1, 2, or 4.')
  }
  const owners = JSON.parse(await readFile(plan, 'utf8')) as readonly Owner[]
  process.stdout.write(JSON.stringify(measureVariant(owners, requestedComponents)))
}

interface ModuleWorkerResult {
  readonly kind: 'module-oracle' | 'integrated-module'
  readonly owners: number
  readonly diagnostics: number
  readonly references: number
  readonly outputDigest: string
  readonly ownerDigests: readonly string[]
  readonly totalMilliseconds: number
  readonly maximumRssMiB: number
  readonly phases: readonly { readonly phase: string; readonly durationMs: number }[]
}

interface IntegratedCombinedResult {
  readonly kind: 'integrated-combined'
  readonly owners: number
  readonly fallbackOwners: readonly string[]
  readonly programMilliseconds: number
  readonly diagnosticsMilliseconds: number
  readonly declarationProjectionMilliseconds: number
  readonly moduleProjectionMilliseconds: number
  readonly fallbackMilliseconds: number
  readonly modulePhases: readonly {
    readonly phase: string
    readonly durationMs: number
    readonly items: number
  }[]
  readonly totalMilliseconds: number
  readonly declarationDigest: string
  readonly moduleDigest: string
  readonly maximumRssMiB: number
}

async function runIntegratedCombinedMeasurement(plan: string): Promise<void> {
  const owners = JSON.parse(await readFile(plan, 'utf8')) as readonly Owner[]
  const inventories = await Promise.all(
    owners.map((owner) => inventoryModuleFiles(root, owner.directory)),
  )
  const entrypoints = owners.map((owner) => owner.api).sort()
  let phase = performance.now()
  const integrated = createIntegratedProgram(owners, entrypoints)
  const programMilliseconds = performance.now() - phase
  phase = performance.now()
  const compilerDiagnostics = ts.getPreEmitDiagnostics(integrated.program)
  const diagnosticsMilliseconds = performance.now() - phase
  phase = performance.now()
  const modulePhases: Array<{ phase: string; durationMs: number; items: number }> = []
  const modules = await projectModuleTypeScriptCompilerUniverse(root, inventories, {
    options,
    program: integrated.program,
    resolutionEdges: integrated.resolutionEdges,
    observedResolutions: integrated.observedResolutions,
    defaults: new Set(
      integrated.program
        .getSourceFiles()
        .filter((file) => integrated.program.isSourceFileDefaultLibrary(file))
        .map((file) => canonicalModuleTypeScriptPath(file.fileName)),
    ),
    compilerDiagnostics,
    onProjectionPhase: (current) => modulePhases.push({
      ...current,
      durationMs: round(current.durationMs),
    }),
  })
  const moduleProjectionMilliseconds = performance.now() - phase
  phase = performance.now()
  const declarations = [
    ...projectIntegratedDeclarationsFrom(integrated, entrypoints, compilerDiagnostics),
  ]
  const declarationProjectionMilliseconds = performance.now() - phase
  const fallbackIndexes = declarations.flatMap((result, index) =>
    result.api?.surface.declarations.some(
      (declaration) =>
        declaration.location.file?.startsWith('.astrale-spec-externals/') === true,
    )
      ? [index]
      : [],
  )
  phase = performance.now()
  const fallback = compileDeclarationApis(
    fallbackIndexes.map((index) => ({
      mainFile: entrypoints[index]!,
      projectRoot: root,
      declarationNavigation: false,
    })),
  )
  const fallbackMilliseconds = performance.now() - phase
  for (const [offset, index] of fallbackIndexes.entries()) declarations[index] = fallback[offset]!
  const result: IntegratedCombinedResult = {
    kind: 'integrated-combined',
    owners: owners.length,
    fallbackOwners: fallbackIndexes.map((index) =>
      portable(relative(root, entrypoints[index]!)),
    ),
    programMilliseconds: round(programMilliseconds),
    diagnosticsMilliseconds: round(diagnosticsMilliseconds),
    declarationProjectionMilliseconds: round(declarationProjectionMilliseconds),
    moduleProjectionMilliseconds: round(moduleProjectionMilliseconds),
    fallbackMilliseconds: round(fallbackMilliseconds),
    modulePhases,
    totalMilliseconds: round(
      programMilliseconds +
      diagnosticsMilliseconds +
      declarationProjectionMilliseconds +
      moduleProjectionMilliseconds +
      fallbackMilliseconds,
    ),
    declarationDigest: digest(stableJson(declarations)),
    moduleDigest: digest(stableJson(modules)),
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
  }
  process.stdout.write(JSON.stringify(result))
}

async function runModuleMeasurement(
  plan: string,
  kind: ModuleWorkerResult['kind'],
): Promise<void> {
  const owners = JSON.parse(await readFile(plan, 'utf8')) as readonly Owner[]
  const inventories = await Promise.all(
    owners.map((owner) => inventoryModuleFiles(root, owner.directory)),
  )
  const started = performance.now()
  const phases: Array<{ phase: string; durationMs: number }> = []
  const analyses = kind === 'module-oracle'
    ? await withOperationSnapshot(async () => {
        await prepareModuleTypeScriptAnalyses(root, inventories, (phase) => phases.push({
          phase: phase.phase,
          durationMs: round(phase.durationMs),
        }))
        return Promise.all(
          inventories.map((inventory) => analyzeModuleTypeScript(root, inventory)),
        )
      })
    : await projectIntegratedModules(owners, inventories)
  const serialized = stableJson(analyses)
  const result: ModuleWorkerResult = {
    kind,
    owners: analyses.length,
    diagnostics: analyses.reduce(
      (total, analysis) => total + analysis.diagnostics.length,
      0,
    ),
    references: analyses.reduce(
      (total, analysis) => total + analysis.references.length,
      0,
    ),
    outputDigest: digest(serialized),
    ownerDigests: analyses.map((analysis) => digest(stableJson(analysis))),
    totalMilliseconds: round(performance.now() - started),
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
    phases,
  }
  process.stdout.write(JSON.stringify(result))
}

interface DeclarationWorkerResult {
  readonly kind:
    | 'shared-process'
    | 'isolated-workers'
    | 'semantic-only'
    | 'semantic-only-isolated'
    | 'semantic-only-isolated-48'
    | 'semantic-only-isolated-24'
    | 'diagnostics-only-isolated'
    | 'integrated-diagnostics'
    | 'integrated-projection'
  readonly entrypoints: number
  readonly ok: number
  readonly diagnostics: number
  readonly outputBytes: number
  readonly outputDigest: string
  readonly entrypointDigests: readonly string[]
  readonly representation: {
    readonly totalSources: number
    readonly uniqueSources: number
    readonly totalSourceTextBytes: number
    readonly uniqueSourceTextBytes: number
    readonly totalTokens: number
    readonly totalDeclarations: number
    readonly uniqueDeclarations: number
    readonly surfaceBytes: number
    readonly metadataBytes: number
    readonly tokenBytes: number
  }
  readonly totalMilliseconds: number
  readonly maximumRssMiB: number
}

async function runDeclarationMeasurement(
  plan: string,
  kind: DeclarationWorkerResult['kind'],
): Promise<void> {
  const owners = JSON.parse(await readFile(plan, 'utf8')) as readonly Owner[]
  const inventories = await Promise.all(
    owners.map((owner) => inventoryModuleFiles(root, owner.directory)),
  )
  const entrypoints = [
    ...new Set(
      inventories.flatMap((inventory) => [
        inventory.api.absolute,
        ...(inventory.internal ? [inventory.internal.absolute] : []),
        ...inventory.ports.map((port) => port.absolute),
      ]),
    ),
  ].sort()
  const requests = entrypoints.map((mainFile) => ({
    mainFile,
    projectRoot: root,
    ...(kind.startsWith('semantic-only') || kind.includes('diagnostics')
      ? { declarationNavigation: false }
      : {}),
    ...(kind.includes('diagnostics') ? { declarationModel: false } : {}),
  }))
  const started = performance.now()
  const results = kind === 'integrated-projection' || kind === 'integrated-diagnostics'
    ? projectIntegratedDeclarations(
        owners,
        entrypoints,
        kind !== 'integrated-diagnostics',
      )
    : kind === 'shared-process' || kind === 'semantic-only'
      ? compileDeclarationApis(requests)
      : await compileApisIsolated(
          requests,
          kind === 'semantic-only-isolated-48'
            ? { maxBatchEntries: 48 }
            : kind === 'semantic-only-isolated-24'
              ? { maxBatchEntries: 24 }
              : {},
        )
  const serialized = stableJson(results)
  const apis = results.flatMap((result) => result.api ? [result.api] : [])
  const sources = apis.flatMap((api) => api.sources)
  const uniqueSources = new Map(
    sources.map((source) => [`${source.file}\0${source.revision}`, source] as const),
  )
  const declarations = apis.flatMap((api) => api.surface.declarations)
  const uniqueDeclarations = new Set(declarations.map((declaration) => stableJson(declaration)))
  const measurement: DeclarationWorkerResult = {
    kind,
    entrypoints: results.length,
    ok: results.filter((result) => result.ok).length,
    diagnostics: results.reduce((total, result) => total + result.diagnostics.length, 0),
    outputBytes: Buffer.byteLength(serialized),
    outputDigest: digest(serialized),
    entrypointDigests: results.map((result) => digest(stableJson(result))),
    representation: {
      totalSources: sources.length,
      uniqueSources: uniqueSources.size,
      totalSourceTextBytes: sources.reduce(
        (total, source) => total + Buffer.byteLength(source.text ?? ''),
        0,
      ),
      uniqueSourceTextBytes: [...uniqueSources.values()].reduce(
        (total, source) => total + Buffer.byteLength(source.text ?? ''),
        0,
      ),
      totalTokens: apis.reduce((total, api) => total + api.tokens.length, 0),
      totalDeclarations: declarations.length,
      uniqueDeclarations: uniqueDeclarations.size,
      surfaceBytes: apis.reduce(
        (total, api) => total + Buffer.byteLength(stableJson(api.surface)),
        0,
      ),
      metadataBytes: apis.reduce(
        (total, api) => total + Buffer.byteLength(stableJson(api.metadata)),
        0,
      ),
      tokenBytes: apis.reduce(
        (total, api) => total + Buffer.byteLength(stableJson(api.tokens)),
        0,
      ),
    },
    totalMilliseconds: round(performance.now() - started),
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
  }
  process.stdout.write(JSON.stringify(measurement))
}

function projectIntegratedDeclarations(
  owners: readonly Owner[],
  entrypoints: readonly string[],
  declarationModel = true,
) {
  const integrated = createIntegratedProgram(owners, entrypoints)
  return projectIntegratedDeclarationsFrom(
    integrated,
    entrypoints,
    undefined,
    declarationModel,
  )
}

function projectIntegratedDeclarationsFrom(
  integrated: ReturnType<typeof createIntegratedProgram>,
  entrypoints: readonly string[],
  compilerDiagnostics?: readonly ts.Diagnostic[],
  declarationModel = true,
) {
  return projectDeclarationCompilerUniverse(
    {
      configFile: root,
      program: integrated.program,
      checker: integrated.program.getTypeChecker(),
      issues: [],
      externalCoordinates: integrated.externalCoordinates,
    },
    entrypoints.map((mainFile) => ({
      mainFile,
      projectRoot: root,
      files: integrated.entries.get(mainFile)!.files,
      declarationNavigation: false,
      declarationModel,
    })),
    compilerDiagnostics,
  )
}

async function projectIntegratedModules(
  owners: readonly Owner[],
  inventories: readonly ModuleFileInventory[],
) {
  const integrated = createIntegratedProgram(
    owners,
    owners.map((owner) => owner.api).sort(),
  )
  return projectModuleTypeScriptCompilerUniverse(root, inventories, {
    options,
    program: integrated.program,
    resolutionEdges: integrated.resolutionEdges,
    observedResolutions: integrated.observedResolutions,
    defaults: new Set(
      integrated.program
        .getSourceFiles()
        .filter((file) => integrated.program.isSourceFileDefaultLibrary(file))
        .map((file) => canonicalModuleTypeScriptPath(file.fileName)),
    ),
  })
}

function createIntegratedProgram(
  owners: readonly Owner[],
  entrypoints: readonly string[],
) {
  const compilerOptions = options
  const roots = [...new Set(owners.flatMap((owner) => owner.roots))].sort()
  const discovery = createDeclarationSourceCorpus(
    root,
    compilerOptions,
    ts.createCompilerHost(compilerOptions),
  )
  const entries = new Map(
    entrypoints.map((mainFile) => [mainFile, discovery.discover(mainFile)] as const),
  )
  const combined = createIntegratedCorpus(
    compilerOptions,
    new Set([...entries.values()].flatMap((entry) => [...entry.files])),
    discovery,
  )
  const program = ts.createProgram({ rootNames: roots, options: compilerOptions, host: combined.host })
  return { ...combined, declarations: discovery, entries, program }
}

function createIntegratedCorpus(
  compilerOptions: ts.CompilerOptions,
  declarationFiles: ReadonlySet<string>,
  declarations: ReturnType<typeof createDeclarationSourceCorpus>,
): {
  readonly host: ts.CompilerHost
  readonly externalCoordinates: ReadonlyMap<string, string>
  readonly resolutionEdges: ReadonlyMap<string, ReadonlySet<string>>
  readonly observedResolutions: ReadonlyMap<string, string | null>
} {
  const corpus = createSharedCorpus(compilerOptions)
  const host = corpus.host
  const virtualSources = new Map<string, string>()
  const virtualByImport = new Map<string, string>()
  const externalCoordinates = new Map<string, string>()
  const resolutionEdges = new Map<string, Set<string>>()
  const observedResolutions = new Map<string, string | null>()
  for (const file of [...declarationFiles].sort()) {
    for (const [specifier, source] of renderExternalModules([
      declarations.evidence(file).externalReferences,
    ])) {
      const virtual = resolve(
        root,
        '.astrale-spec-externals',
        `${digest(`${file}\0${specifier}\0${source}`).slice(0, 24)}.d.ts`,
      )
      virtualSources.set(virtual, source)
      virtualByImport.set(`${resolve(file)}\0${specifier}`, virtual)
      externalCoordinates.set(virtual, externalCoordinate(specifier))
    }
  }
  const ordinaryFileExists = host.fileExists.bind(host)
  const ordinaryReadFile = host.readFile.bind(host)
  const ordinaryGetSourceFile = host.getSourceFile.bind(host)
  const ordinaryResolve = host.resolveModuleNameLiterals!.bind(host)
  host.fileExists = (file) => virtualSources.has(resolve(file)) || ordinaryFileExists(file)
  host.readFile = (file) => virtualSources.get(resolve(file)) ?? ordinaryReadFile(file)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtual = virtualSources.get(resolve(file))
    return virtual === undefined
      ? ordinaryGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, virtual, languageVersion, true, ts.ScriptKind.TS)
  }
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    redirectedReference,
    currentOptions,
    containingSourceFile,
    _reusedNames,
  ) =>
    literals.map((literal) => {
      const mode = ts.getModeForUsageLocation(
        containingSourceFile,
        literal,
        currentOptions,
      )
      const virtual = virtualByImport.get(`${resolve(containingFile)}\0${literal.text}`)
      let result: ts.ResolvedModuleWithFailedLookupLocations
      if (virtual) {
        result = {
          resolvedModule: {
            resolvedFileName: virtual,
            extension: ts.Extension.Dts,
            isExternalLibraryImport: true,
          },
        }
      } else if (
        declarationFiles.has(resolve(containingFile)) &&
        isExternalSpecifier(literal.text)
      ) {
        result = { resolvedModule: undefined }
      } else {
        result = ordinaryResolve(
          [literal],
          containingFile,
          redirectedReference,
          currentOptions,
          containingSourceFile,
          undefined,
        )[0]!
      }
      const from = canonicalModuleTypeScriptPath(containingFile)
      const target = result.resolvedModule?.resolvedFileName
      observedResolutions.set(
        moduleTypeScriptResolutionKey('module', from, literal.text, mode),
        target ? canonicalModuleTypeScriptPath(target) : null,
      )
      if (target) {
        const edges = resolutionEdges.get(from) ?? new Set<string>()
        edges.add(canonicalModuleTypeScriptPath(target))
        resolutionEdges.set(from, edges)
      }
      return result
    })
  return { host, externalCoordinates, resolutionEdges, observedResolutions }
}

function externalCoordinate(specifier: string): string {
  return /^(?:node|bun|deno):/u.test(specifier)
    ? `platform:${specifier}`
    : `package:${specifier}`
}

interface Owner {
  readonly source: string
  readonly directory: string
  readonly api: string
  readonly roots: readonly string[]
  readonly ambient: boolean
}

interface UniverseVariant {
  readonly requestedComponents: number
  readonly actualComponents: number
  readonly rootCounts: readonly number[]
  readonly sourceFileRequests: number
  readonly sourceFileConstructions: number
  readonly uniqueSourceFiles: number
  readonly uniqueSourceBytes: number
  readonly resolutionRequests: number
  readonly uniqueResolutions: number
  readonly programMilliseconds: number
  readonly diagnosticsMilliseconds: number
  readonly projectionMilliseconds: number
  readonly totalMilliseconds: number
  readonly maximumRssMiB: number
  readonly diagnosticCount: number
  readonly diagnosticDigest: string
  readonly exportCount: number
  readonly exportDigest: string
  readonly missingApis: readonly string[]
}

function measureVariant(
  owners: readonly Owner[],
  requestedComponents: number,
): UniverseVariant {
  const started = performance.now()
  const corpus = createSharedCorpus(options)
  const diagnostics: string[] = []
  const exports: string[] = []
  const missingApis: string[] = []
  let programMilliseconds = 0
  let diagnosticsMilliseconds = 0
  let projectionMilliseconds = 0
  const components = planComponents(owners, requestedComponents)
  for (const component of components) {
    const rootNames = [...new Set(component.flatMap((owner) => owner.roots))].sort()
    let phase = performance.now()
    const program = ts.createProgram({ rootNames, options, host: corpus.host })
    const checker = program.getTypeChecker()
    programMilliseconds += performance.now() - phase
    phase = performance.now()
    diagnostics.push(...localDiagnostics(program, rootNames))
    diagnosticsMilliseconds += performance.now() - phase
    phase = performance.now()
    for (const owner of component) {
      const source = program.getSourceFile(owner.api)
      const symbol = source && checker.getSymbolAtLocation(source)
      if (!source || !symbol) {
        missingApis.push(owner.source)
        continue
      }
      for (const exported of checker.getExportsOfModule(symbol)) {
        exports.push(
          stableJson({
            owner: owner.source,
            name: exported.getName(),
            declarations: (exported.declarations ?? []).map((declaration) => ({
              file: portable(relative(root, declaration.getSourceFile().fileName)),
              kind: ts.SyntaxKind[declaration.kind],
              start: declaration.getStart(declaration.getSourceFile(), false),
            })),
          }),
        )
      }
    }
    projectionMilliseconds += performance.now() - phase
  }
  const totalMilliseconds = performance.now() - started
  const snapshot = corpus.measurement()
  const canonicalDiagnostics = [...new Set(diagnostics)].sort()
  const canonicalExports = [...new Set(exports)].sort()
  return {
    requestedComponents,
    actualComponents: components.length,
    rootCounts: components.map(
      (component) => new Set(component.flatMap((owner) => owner.roots)).size,
    ),
    ...snapshot,
    programMilliseconds: round(programMilliseconds),
    diagnosticsMilliseconds: round(diagnosticsMilliseconds),
    projectionMilliseconds: round(projectionMilliseconds),
    totalMilliseconds: round(totalMilliseconds),
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
    diagnosticCount: canonicalDiagnostics.length,
    diagnosticDigest: digest(stableJson(canonicalDiagnostics)),
    exportCount: canonicalExports.length,
    exportDigest: digest(stableJson(canonicalExports)),
    missingApis: [...new Set(missingApis)].sort(),
  }
}

function createSharedCorpus(compilerOptions: ts.CompilerOptions): {
  readonly host: ts.CompilerHost
  measurement(): Pick<
    UniverseVariant,
    | 'sourceFileRequests'
    | 'sourceFileConstructions'
    | 'uniqueSourceFiles'
    | 'uniqueSourceBytes'
    | 'resolutionRequests'
    | 'uniqueResolutions'
  >
} {
  const host = ts.createCompilerHost(compilerOptions)
  const sourceFiles = new Map<string, ts.SourceFile | undefined>()
  const resolutions = new Map<string, ts.ResolvedModuleWithFailedLookupLocations>()
  const originalGetSourceFile = host.getSourceFile.bind(host)
  let sourceFileRequests = 0
  let sourceFileConstructions = 0
  let resolutionRequests = 0
  const moduleResolutionCache = ts.createModuleResolutionCache(
    root,
    (value) => value,
    compilerOptions,
  )
  const authoring = ts.resolveModuleName(
    AUTHORING_SPECIFIER,
    fileURLToPath(import.meta.url),
    compilerOptions,
    ts.sys,
  ).resolvedModule
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    sourceFileRequests += 1
    const key = resolve(file)
    if (!shouldCreateNewSourceFile && sourceFiles.has(key)) return sourceFiles.get(key)
    const source = originalGetSourceFile(
      file,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    )
    sourceFileConstructions += source ? 1 : 0
    if (!shouldCreateNewSourceFile) sourceFiles.set(key, source)
    return source
  }
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
  ) =>
    literals.map((literal) => {
      resolutionRequests += 1
      if (isAuthoringSpecifier(literal.text) && authoring) {
        return { resolvedModule: authoring }
      }
      const mode = ts.getModeForUsageLocation(containingSourceFile, literal, options)
      const key = stableJson([resolve(containingFile), literal.text, mode])
      let resolution = resolutions.get(key)
      if (!resolution) {
        resolution = ts.resolveModuleName(
          literal.text,
          containingFile,
          options,
          host,
          moduleResolutionCache,
          redirectedReference,
          mode,
        )
        resolutions.set(key, resolution)
      }
      return { resolvedModule: resolution.resolvedModule }
    })
  return {
    host,
    measurement() {
      const retained = [...sourceFiles.values()].filter(
        (source): source is ts.SourceFile => source !== undefined,
      )
      return {
        sourceFileRequests,
        sourceFileConstructions,
        uniqueSourceFiles: retained.length,
        uniqueSourceBytes: retained.reduce(
          (bytes, source) => bytes + Buffer.byteLength(source.text),
          0,
        ),
        resolutionRequests,
        uniqueResolutions: resolutions.size,
      }
    },
  }
}

function planComponents(
  owners: readonly Owner[],
  requestedComponents: number,
): readonly (readonly Owner[])[] {
  const isolated = owners.filter((owner) => owner.ambient).map((owner) => [owner])
  const shared = owners.filter((owner) => !owner.ambient)
  const groups = Array.from(
    { length: Math.min(requestedComponents, Math.max(1, shared.length)) },
    (): Owner[] => [],
  )
  const rootCounts = groups.map(() => 0)
  for (const owner of [...shared].sort((left, right) => right.roots.length - left.roots.length)) {
    const index = rootCounts.indexOf(Math.min(...rootCounts))
    groups[index]!.push(owner)
    rootCounts[index]! += owner.roots.length
  }
  return [...groups.filter((group) => group.length), ...isolated]
}

function localDiagnostics(program: ts.Program, roots: readonly string[]): string[] {
  const rootSet = new Set(roots.map((file) => resolve(file)))
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || rootSet.has(resolve(diagnostic.file.fileName)))
    .map((diagnostic) =>
      stableJson({
        code: diagnostic.code,
        file: diagnostic.file
          ? portable(relative(root, diagnostic.file.fileName))
          : '.',
        start: diagnostic.start ?? 0,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }),
    )
}

function ownedRoots(inventory: ModuleFileInventory): readonly string[] {
  return [
    inventory.api,
    ...inventory.apiFragments,
    inventory.code,
    inventory.internal,
    ...inventory.ports,
    ...inventory.capabilities,
    ...inventory.flows,
    ...inventory.laws,
    ...inventory.states,
    inventory.limits,
    inventory.layout,
    ...inventory.examples,
    ...inventory.benchmarks,
    ...inventory.packages,
    inventory.packageExceptions,
  ]
    .filter((file): file is NonNullable<typeof file> => file !== undefined)
    .map((file) => resolve(file.absolute))
}

function sourceHasAmbientEffects(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    options.target ?? ts.ScriptTarget.ES2022,
    true,
  )
  return typeScriptSourceHasAmbientEffects(source)
}

function compilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    resolveJsonModule: false,
    types: [],
    ignoreDeprecations: '6.0',
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function portable(path: string): string {
  return path.replaceAll('\\', '/')
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
