import { createHash } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import ts from 'typescript'

import { stableJson } from '../../../analysis/identity/model.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/index.ts'
import {
  MODULE_DEPENDENCIES_PROFILE_ID,
  MODULE_STRUCTURE_PROFILE_ID,
  MODULE_SURFACE_PROFILE_ID,
  SPECIFICATION_VALIDITY_PROFILE_ID,
} from '../../../conformance/index.ts'
import { discoverModuleBinding } from '../../../specification/module/binding.ts'

const root = resolve(requiredArgument('--root'))
const cacheDirectory = resolve(requiredArgument('--cache'))
const nativeBinary = resolve(requiredArgument('--native-binary'))
const output = resolve(requiredArgument('--output'))
const diagnosticsMode = optionalArgument('--diagnostics') ?? 'whole'
if (!['whole', 'roots', 'compare'].includes(diagnosticsMode)) {
  throw new Error('--diagnostics must be whole, roots, or compare.')
}
const configuredTargets = repeatedArgument('--target')
const targets = configuredTargets.length
  ? configuredTargets
  : ['backend/falkordb/engine/query', 'backend/falkordb/stores']

const admitted = await Promise.all(targets.map(admitTarget))
const binding = measureBindings(admitted, diagnosticsMode as DiagnosticsMode)
if (process.argv.includes('--prototype-only')) {
  const body = {
    format: 'astrale.codegraph.explicit-spec-binding-prototype' as const,
    version: 1 as const,
    subject: { root, targets },
    prototype: binding,
    scope: {
      covered: [
        'exact exported names',
        'type and value namespace presence',
        'bidirectional declared-type assignability',
        'implementation-to-contract value assignability',
        'TypeScript error diagnostics',
      ],
      excluded: ['current structural verifier', 'dependency policy', 'source-location diagnostics'],
    },
  }
  const evidence = { ...body, evidenceSha256: digest(stableJson(body)) }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} else {
  const service = await createNodeTypeSpecApplicationService({
  root,
  cacheDirectory,
  persistence: 'memory',
  native: { binary: nativeBinary },
  })

  try {
  const currentStarted = performance.now()
  const current = await service.refresh({
    requestedCapabilities: ['declaration-models'],
    qualify: true,
    compilerAnalysis: true,
    requestedProfiles: [
      SPECIFICATION_VALIDITY_PROFILE_ID,
      MODULE_STRUCTURE_PROFILE_ID,
      MODULE_SURFACE_PROFILE_ID,
      MODULE_DEPENDENCIES_PROFILE_ID,
    ],
    exclude: [],
    select: [...targets],
    focused: true,
    includeDependents: false,
    requireCompleteLayout: false,
    requireExactLayout: false,
  })
  const currentMilliseconds = performance.now() - currentStarted
  const decisions = admitted.map((target) => {
    const prototype = binding.modules.find((module) => module.target === target.target)!
    const qualification = current.snapshot.qualifications.find(
      (candidate) => candidate.specification.source === target.source,
    )
    const profiles = [
      MODULE_STRUCTURE_PROFILE_ID,
      MODULE_SURFACE_PROFILE_ID,
      MODULE_DEPENDENCIES_PROFILE_ID,
    ].map((profile) => {
      const result = qualification?.profiles.find((candidate) => candidate.id === profile)
      return {
        profile,
        status: result?.status ?? 'missing',
        diagnostics: result?.rules.flatMap((rule) =>
          rule.diagnostics.map((diagnostic) => diagnostic.code),
        ).sort() ?? [],
      }
    })
    const bindingProfiles = profiles.filter(
      (profile) => profile.profile !== MODULE_DEPENDENCIES_PROFILE_ID,
    )
    const currentBindingPass = bindingProfiles.every((profile) => profile.status === 'pass')
    const dependencyProfile = profiles.find(
      (profile) => profile.profile === MODULE_DEPENDENCIES_PROFILE_ID,
    )!
    return {
      target: target.target,
      prototypePass: prototype.status === 'pass',
      currentBindingPass,
      decisionEqual: (prototype.status === 'pass') === currentBindingPass,
      dependencyPolicyStatus: dependencyProfile.status,
      profiles,
      prototypeDiagnostics: prototype.diagnostics,
    }
  })
  const body = {
    format: 'astrale.codegraph.explicit-spec-binding-experiment' as const,
    version: 1 as const,
    subject: {
      root,
      inventory: current.snapshot.inventory,
      application: current.snapshot.id,
      targets,
    },
    prototype: binding,
    currentVerifier: {
      milliseconds: round(currentMilliseconds),
      selectedSpecifications: current.snapshot.specifications.length,
      qualifications: current.snapshot.qualifications.length,
    },
    decisions,
    decisionsEqual: decisions.every((decision) => decision.decisionEqual),
    positiveControlsSatisfied: decisions.every(
      (decision) => decision.currentBindingPass && decision.prototypePass,
    ),
    scope: {
      covered: [
        'exact exported names',
        'type and value namespace presence',
        'bidirectional declared-type assignability',
        'implementation-to-contract value assignability',
        'TypeScript error diagnostics',
      ],
      notYetCovered: [
        'dependency policy',
        'authored error-code evidence',
        'fine-grained identity and source-location diagnostics',
        'all selected owners and adversarial negative holdouts',
      ],
    },
  }
  const evidence = { ...body, evidenceSha256: digest(stableJson(body)) }
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  } finally {
    await service.dispose()
  }
}

interface AdmittedTarget {
  readonly target: string
  readonly source: string
  readonly spec: string
  readonly implementation: string
  readonly project: string
}

interface BindingModuleResult {
  readonly target: string
  readonly status: 'pass' | 'fail' | 'error'
  readonly exports: number
  readonly diagnostics: readonly string[]
}

type DiagnosticsMode = 'whole' | 'roots' | 'compare'

async function admitTarget(target: string): Promise<AdmittedTarget> {
  const specDirectory = resolve(root, target, '.spec')
  const source = portable(relative(root, resolve(specDirectory, 'api.d.ts')))
  const discovered = await discoverModuleBinding(root, specDirectory, source)
  if (discovered.diagnostics.length || !discovered.binding) {
    throw new Error(
      `Cannot bind ${target}: ${discovered.diagnostics.map((entry) => entry.message).join('; ')}`,
    )
  }
  return {
    target,
    source,
    spec: resolve(specDirectory, 'api.d.ts'),
    implementation: resolve(specDirectory, discovered.binding.entrypoint),
    project: resolve(specDirectory, discovered.binding.project),
  }
}

function measureBindings(targets: readonly AdmittedTarget[], diagnosticsMode: DiagnosticsMode): {
  readonly milliseconds: number
  readonly programMilliseconds: number
  readonly diagnosticsMilliseconds: number
  readonly diagnosticsMode: DiagnosticsMode
  readonly wholeDiagnosticsMilliseconds?: number
  readonly rootDiagnosticsMilliseconds?: number
  readonly rootDiagnosticsEqual?: boolean
  readonly comparisonMilliseconds: number
  readonly sourceFiles: number
  readonly maximumRssMiB: number
  readonly modules: readonly BindingModuleResult[]
} {
  const started = performance.now()
  const projects = [...new Set(targets.map((target) => target.project))]
  if (projects.length !== 1) throw new Error('Prototype targets must share one compiler project.')
  const config = ts.readConfigFile(projects[0]!, ts.sys.readFile)
  if (config.error) throw new Error(formatDiagnostic(config.error))
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(projects[0]!),
    { noEmit: true },
    projects[0],
  )
  if (parsed.errors.length) throw new Error(parsed.errors.map(formatDiagnostic).join('\n'))
  let phase = performance.now()
  const program = ts.createProgram({
    rootNames: targets.flatMap((target) => [target.spec, target.implementation]),
    options: parsed.options,
  })
  const checker = program.getTypeChecker()
  const programMilliseconds = performance.now() - phase
  phase = performance.now()
  const rootFiles = targets.flatMap((target) => [target.spec, target.implementation])
  const wholeStarted = performance.now()
  const wholeDiagnostics = diagnosticsMode === 'roots' ? undefined : collectWholeDiagnostics(program)
  const wholeDiagnosticsMilliseconds = performance.now() - wholeStarted
  const rootsStarted = performance.now()
  const rootDiagnostics =
    diagnosticsMode === 'whole' ? undefined : collectRootDiagnostics(program, rootFiles)
  const rootDiagnosticsMilliseconds = performance.now() - rootsStarted
  const diagnosticsByFile = rootDiagnostics ?? wholeDiagnostics!
  const rootDiagnosticsEqual =
    diagnosticsMode === 'compare'
      ? diagnosticsEqual(wholeDiagnostics!, rootDiagnostics!, rootFiles)
      : undefined
  if (rootDiagnosticsEqual === false) {
    throw new Error('Root-scoped diagnostics differ from whole-program diagnostics for binding roots.')
  }
  const diagnosticsMilliseconds = performance.now() - phase
  phase = performance.now()
  const modules = targets.map((target): BindingModuleResult => {
    const diagnostics = [target.spec, target.implementation]
      .flatMap((file) => diagnosticsByFile.get(resolve(file)) ?? [])
      .sort()
    const specification = moduleExports(program, checker, target.spec)
    const implementation = moduleExports(program, checker, target.implementation)
    const names = [...new Set([...specification.keys(), ...implementation.keys()])].sort()
    for (const name of names) {
      const expected = specification.get(name)
      const actual = implementation.get(name)
      if (!expected) {
        diagnostics.push(`EXPORT_UNDECLARED:${name}`)
        continue
      }
      if (!actual) {
        diagnostics.push(`EXPORT_MISSING:${name}`)
        continue
      }
      const expectedTarget = resolveAlias(checker, expected)
      const actualTarget = resolveAlias(checker, actual)
      const expectedType = hasType(expectedTarget)
      const actualType = hasType(actualTarget)
      const expectedValue = hasValue(expectedTarget)
      const actualValue = hasValue(actualTarget)
      if (expectedType !== actualType) diagnostics.push(`EXPORT_TYPE_NAMESPACE:${name}`)
      if (expectedValue !== actualValue) diagnostics.push(`EXPORT_VALUE_NAMESPACE:${name}`)
      if (expectedType && actualType) {
        const expectedDeclared = checker.getDeclaredTypeOfSymbol(expectedTarget)
        const actualDeclared = checker.getDeclaredTypeOfSymbol(actualTarget)
        if (
          !checker.isTypeAssignableTo(actualDeclared, expectedDeclared) ||
          !checker.isTypeAssignableTo(expectedDeclared, actualDeclared)
        ) {
          diagnostics.push(`EXPORT_TYPE_INCOMPATIBLE:${name}`)
        }
      }
      if (expectedValue && actualValue) {
        const expectedValueType = checker.getTypeOfSymbolAtLocation(
          expectedTarget,
          expectedTarget.valueDeclaration ?? expectedTarget.declarations![0]!,
        )
        const actualValueType = checker.getTypeOfSymbolAtLocation(
          actualTarget,
          actualTarget.valueDeclaration ?? actualTarget.declarations![0]!,
        )
        if (!checker.isTypeAssignableTo(actualValueType, expectedValueType)) {
          diagnostics.push(`EXPORT_VALUE_INCOMPATIBLE:${name}`)
        }
      }
    }
    const canonical = [...new Set(diagnostics)].sort()
    return {
      target: target.target,
      status: canonical.some((diagnostic) => /^\d+:/u.test(diagnostic))
        ? 'error'
        : canonical.length
          ? 'fail'
          : 'pass',
      exports: specification.size,
      diagnostics: canonical,
    }
  })
  const comparisonMilliseconds = performance.now() - phase
  return {
    milliseconds: round(performance.now() - started),
    programMilliseconds: round(programMilliseconds),
    diagnosticsMilliseconds: round(diagnosticsMilliseconds),
    diagnosticsMode,
    ...(diagnosticsMode === 'roots'
      ? { rootDiagnosticsMilliseconds: round(rootDiagnosticsMilliseconds) }
      : diagnosticsMode === 'whole'
        ? { wholeDiagnosticsMilliseconds: round(wholeDiagnosticsMilliseconds) }
        : {
            wholeDiagnosticsMilliseconds: round(wholeDiagnosticsMilliseconds),
            rootDiagnosticsMilliseconds: round(rootDiagnosticsMilliseconds),
            rootDiagnosticsEqual,
          }),
    comparisonMilliseconds: round(comparisonMilliseconds),
    sourceFiles: program.getSourceFiles().length,
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
    modules,
  }
}

function collectWholeDiagnostics(program: ts.Program): ReadonlyMap<string, readonly string[]> {
  return collectDiagnostics(ts.getPreEmitDiagnostics(program))
}

function collectRootDiagnostics(
  program: ts.Program,
  files: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const diagnostics: ts.Diagnostic[] = []
  for (const file of [...new Set(files.map((value) => resolve(value)))].sort()) {
    const source = program.getSourceFile(file)
    if (!source) throw new Error(`Binding root is absent from the compiler program: ${file}`)
    diagnostics.push(...ts.getPreEmitDiagnostics(program, source))
  }
  return collectDiagnostics(diagnostics)
}

function collectDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
): ReadonlyMap<string, readonly string[]> {
  const byFile = new Map<string, string[]>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    const file = diagnostic.file ? resolve(diagnostic.file.fileName) : '.'
    const values = byFile.get(file) ?? []
    values.push(`${diagnostic.code}:${formatDiagnostic(diagnostic)}`)
    byFile.set(file, values)
  }
  for (const [file, values] of byFile) byFile.set(file, [...new Set(values)].sort())
  return byFile
}

function diagnosticsEqual(
  whole: ReadonlyMap<string, readonly string[]>,
  roots: ReadonlyMap<string, readonly string[]>,
  files: readonly string[],
): boolean {
  return [...new Set(files.map((value) => resolve(value)))].every(
    (file) => stableJson(whole.get(file) ?? []) === stableJson(roots.get(file) ?? []),
  )
}

function moduleExports(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: string,
): ReadonlyMap<string, ts.Symbol> {
  const source = program.getSourceFile(resolve(file)) ?? program.getSourceFile(file)
  const symbol = source && checker.getSymbolAtLocation(source)
  if (!symbol) throw new Error(`No module symbol exists for ${file}.`)
  return new Map(checker.getExportsOfModule(symbol).map((entry) => [entry.getName(), entry]))
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
}

function hasType(symbol: ts.Symbol): boolean {
  return (symbol.flags & ts.SymbolFlags.Type) !== 0
}

function hasValue(symbol: ts.Symbol): boolean {
  return (symbol.flags & ts.SymbolFlags.Value) !== 0
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
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
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function repeatedArgument(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== name) continue
    const value = process.argv[index + 1]
    if (!value) throw new Error(`${name} requires a value.`)
    values.push(value)
  }
  return values
}
