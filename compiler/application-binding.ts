import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import type { DeclarationTypeScriptProject } from '../typescript/surface/project.ts'
import type {
  ApplicationModuleBindingCompilation,
  ApplicationModuleBindingDiagnostic,
  ApplicationModuleBindingExport,
  ApplicationModuleBindingExportFacet,
  ApplicationModuleBindingFact,
  ApplicationModuleBindingRequest,
} from '../analysis/binding/index.ts'

import { observePublicSurface } from '../typescript/surface/observe.ts'
import { resolveAlias } from '../typescript/surface/symbol.ts'
import {
  indexProjectBindings,
  observeDependencies,
  observeErrorCodes,
  observeExpectedErrorCodes,
  readPackageIntent,
  resolvedModule,
  type ProjectBindingIndex,
} from './application-binding-evidence.ts'

/** Compile compact explicit bindings without constructing an implementation declaration graph. */
export function compileApplicationModuleBindings(options: {
  readonly root: string
  readonly requests: readonly ApplicationModuleBindingRequest[]
  readonly ownershipRequests?: readonly ApplicationModuleBindingRequest[]
}): ApplicationModuleBindingCompilation {
  const started = performance.now()
  const selected = new Set(options.requests.map((request) => request.specification))
  const selectedProjects = new Set(options.requests.map((request) => request.target.project))
  const ownershipRequests = options.ownershipRequests ?? options.requests
  const compilationRequests = ownershipRequests.filter((request) =>
    selectedProjects.has(request.target.project),
  )
  const groups = new Map<string, ApplicationModuleBindingRequest[]>()
  for (const request of compilationRequests) {
    const group = groups.get(request.target.project) ?? []
    group.push(request)
    groups.set(request.target.project, group)
  }
  const facts: ApplicationModuleBindingFact[] = []
  const work = {
    programMs: 0,
    diagnosticsMs: 0,
    surfaceMs: 0,
    exportsMs: 0,
    dependenciesMs: 0,
    evidenceMs: 0,
  }
  let sourceFiles = 0
  for (const [project, requests] of [...groups].sort(([left], [right]) => compare(left, right))) {
    const compilation = compileProject(options.root, project, requests, ownershipRequests, work)
    facts.push(...compilation.facts.filter((fact) => selected.has(fact.specification)))
    sourceFiles += compilation.sourceFiles
  }
  return {
    facts: facts.sort((left, right) => compare(left.target.id, right.target.id)),
    programs: groups.size,
    sourceFiles,
    durationMs: round(performance.now() - started),
    programMs: round(work.programMs),
    diagnosticsMs: round(work.diagnosticsMs),
    surfaceMs: round(work.surfaceMs),
    exportsMs: round(work.exportsMs),
    dependenciesMs: round(work.dependenciesMs),
    evidenceMs: round(work.evidenceMs),
    workerPeakResidentBytes: 0,
    workerResidentUpperBoundBytes: 0,
  }
}

interface MutableBindingWork {
  programMs: number
  diagnosticsMs: number
  surfaceMs: number
  exportsMs: number
  dependenciesMs: number
  evidenceMs: number
}

function compileProject(
  root: string,
  projectPath: string,
  requests: readonly ApplicationModuleBindingRequest[],
  allRequests: readonly ApplicationModuleBindingRequest[],
  work: MutableBindingWork,
): { readonly facts: readonly ApplicationModuleBindingFact[]; readonly sourceFiles: number } {
  const configFile = resolve(root, projectPath)
  const config = ts.readConfigFile(configFile, ts.sys.readFile)
  const configError = config.error
  if (configError) {
    return {
      facts: requests.map((request) =>
        failedFact(root, request, [compilerDiagnostic(root, configError)]),
      ),
      sourceFiles: 0,
    }
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configFile),
    { noEmit: true },
    configFile,
  )
  if (parsed.errors.length) {
    const diagnostics = parsed.errors.map((diagnostic) => compilerDiagnostic(root, diagnostic))
    return {
      facts: requests.map((request) => failedFact(root, request, diagnostics)),
      sourceFiles: 0,
    }
  }
  const roots = requests.flatMap((request) => [
    resolve(root, request.source),
    resolve(root, request.target.entrypoint),
    ...(existsSync(bindingFile(root, request)) ? [bindingFile(root, request)] : []),
  ])
  let phase = performance.now()
  const program = ts.createProgram({
    rootNames: [...new Set(roots)].sort(compare),
    options: parsed.options,
  })
  work.programMs += performance.now() - phase
  const checker = program.getTypeChecker()
  const project: DeclarationTypeScriptProject = {
    configFile,
    program,
    checker,
    issues: [],
  }
  const index = indexProjectBindings(root, program, allRequests)
  return {
    facts: requests.map((request) =>
      bindModule(root, program, project, request, index, work),
    ),
    sourceFiles: program.getSourceFiles().length,
  }
}

function bindModule(
  root: string,
  program: ts.Program,
  project: DeclarationTypeScriptProject,
  request: ApplicationModuleBindingRequest,
  index: ProjectBindingIndex,
  work: MutableBindingWork,
): ApplicationModuleBindingFact {
  const source = resolve(root, request.source)
  const implementation = resolve(root, request.target.entrypoint)
  const binding = bindingFile(root, request)
  let phase = performance.now()
  const diagnostics = [source, implementation]
    .flatMap((file) => diagnosticsForFile(root, program, file))
  if (existsSync(binding)) diagnostics.push(...diagnosticsForFile(root, program, binding))
  work.diagnosticsMs += performance.now() - phase
  phase = performance.now()
  const contractSurface = observePublicSurface(root, project, source, {
    explicitExportsOnly: true,
    ownedFiles: new Set(),
  })
  const implementationSurface = observePublicSurface(root, project, implementation, {
    ownedFiles: new Set(),
  })
  work.surfaceMs += performance.now() - phase
  diagnostics.push(
    ...contractSurface.issues.map((issue) => issueDiagnostic(request.source, issue.code, issue.message)),
    ...implementationSurface.issues.map((issue) =>
      issueDiagnostic(request.target.entrypoint, issue.code, issue.message),
    ),
  )
  phase = performance.now()
  const expected = new Map(contractSurface.exports.map((value) => [exportKey(value.path), value]))
  const actual = new Map(implementationSurface.exports.map((value) => [exportKey(value.path), value]))
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort(compare)
  let exports = paths.map((path) => {
    const contract = expected.get(path)
    const observed = actual.get(path)
    if (!contract) {
      diagnostics.push(bindingDiagnostic(
        root,
        request.target.entrypoint,
        'MODULE_EXPORT_UNDECLARED',
        `Public export is not declared by the module specification: ${path}`,
        path,
      ))
      return exportResult(
        observed!,
        emptyFacet(),
        facetOf(project.checker, program, implementation, observed!),
        'undeclared',
      )
    }
    if (!observed) {
      diagnostics.push(bindingDiagnostic(
        root,
        request.source,
        'MODULE_EXPORT_MISSING',
        `Specified export is absent: ${path}`,
        path,
      ))
      return exportResult(
        contract,
        facetOf(project.checker, program, source, contract),
        emptyFacet(),
        'missing',
      )
    }
    const contractFacet = facetOf(project.checker, program, source, contract)
    const implementationFacet = facetOf(
      project.checker,
      program,
      implementation,
      observed,
    )
    const compatible = compareExport(
      root,
      project.checker,
      program,
      source,
      implementation,
      path,
      contractFacet,
      implementationFacet,
      diagnostics,
    )
    return exportResult(
      contract,
      contractFacet,
      implementationFacet,
      compatible ? 'pass' : 'incompatible',
    )
  })
  const contractHasValues = exports.some((entry) => entry.contract.value)
  const valueCompatible = !contractHasValues || explicitValueBinding(root, program, request)
  if (!valueCompatible && exports.some((entry) => entry.contract.value)) {
    diagnostics.push(bindingDiagnostic(
      root,
      binding,
      existsSync(binding) ? 'MODULE_VALUE_BINDING_INVALID' : 'MODULE_VALUE_BINDING_MISSING',
      existsSync(binding)
        ? 'implementation.contract.ts must bind the implementation namespace to the authoritative .spec namespace with satisfies.'
        : 'Runtime exports require an implementation.contract.ts binding to the authoritative .spec namespace.',
      '<module>',
    ))
    exports = exports.map((entry) =>
      entry.contract.value && entry.status === 'pass'
        ? { ...entry, status: 'incompatible' as const }
        : entry,
    )
  }
  work.exportsMs += performance.now() - phase
  phase = performance.now()
  const files = (index.sourcesByOwner.get(request.target.id) ?? [])
    .map((file) => portable(relative(root, file.fileName)))
    .sort(compare)
  const packageIntent = readPackageIntent(resolve(root, request.target.root))
  const dependencies = observeDependencies(
    root,
    program,
    request,
    index,
    implementationSurface.exports,
  )
  work.dependenciesMs += performance.now() - phase
  phase = performance.now()
  const errorCodes = observeErrorCodes(request, index)
  work.evidenceMs += performance.now() - phase
  return {
    specification: request.specification,
    target: request.target,
    exports,
    dependencies,
    declaredPackages: packageIntent.declared,
    developmentPackages: packageIntent.development,
    errorCodes,
    expectedErrorCodes: observeExpectedErrorCodes(program, source),
    files,
    diagnostics: deduplicateDiagnostics(diagnostics),
  }
}

function compareExport(
  root: string,
  checker: ts.TypeChecker,
  program: ts.Program,
  contractFile: string,
  implementationFile: string,
  path: string,
  contract: ApplicationModuleBindingExportFacet,
  implementation: ApplicationModuleBindingExportFacet,
  diagnostics: ApplicationModuleBindingDiagnostic[],
): boolean {
  let compatible = true
  const mismatch = (code: string, message: string, expected?: string, actual?: string) => {
    compatible = false
    diagnostics.push(bindingDiagnostic(root, implementationFile, code, message, path, expected, actual))
  }
  if (contract.typeOnly !== implementation.typeOnly) {
    mismatch(
      'MODULE_EXPORT_TYPE_MODE_MISMATCH',
      `Export type/value mode differs for ${path}.`,
      contract.typeOnly ? 'type-only export' : 'runtime export',
      implementation.typeOnly ? 'type-only export' : 'runtime export',
    )
  }
  if (contract.type !== implementation.type) {
    mismatch('MODULE_EXPORT_TYPE_NAMESPACE_MISMATCH', `Type namespace differs for ${path}.`)
  }
  if (contract.value !== implementation.value) {
    mismatch('MODULE_EXPORT_VALUE_NAMESPACE_MISMATCH', `Value namespace differs for ${path}.`)
  }
  if (contract.type && implementation.type) {
    const expected = exportSymbol(checker, program, contractFile, path)
    const actual = rawExportSymbol(checker, program, implementationFile, path)
    if (!expected || !actual || !explicitTypeBinding(checker, actual, expected)) {
      mismatch(
        'MODULE_EXPORT_TYPE_BINDING_MISSING',
        `Type export must resolve explicitly to the authoritative specification identity: ${path}.`,
      )
    }
  }
  return compatible
}

function explicitTypeBinding(
  checker: ts.TypeChecker,
  actual: ts.Symbol,
  expected: ts.Symbol,
): boolean {
  if (resolveAlias(checker, actual) === expected) return true
  return Boolean(
    actual.declarations?.some((declaration) => {
      if (!ts.isTypeAliasDeclaration(declaration)) return false
      const target = checker.getSymbolAtLocation(
        ts.isTypeReferenceNode(declaration.type)
          ? declaration.type.typeName
          : declaration.type,
      )
      return target !== undefined && resolveAlias(checker, target) === expected
    }),
  )
}

function explicitValueBinding(
  root: string,
  program: ts.Program,
  request: ApplicationModuleBindingRequest,
): boolean {
  const file = bindingFile(root, request)
  const source = program.getSourceFile(file)
  if (!source) return false
  let contract: string | undefined
  let implementation: string | undefined
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const namespace = statement.importClause?.namedBindings
    if (!namespace || !ts.isNamespaceImport(namespace)) continue
    const resolved = resolvedModule(program, statement.moduleSpecifier, source)?.resolvedFileName
    if (!resolved) continue
    if (resolve(resolved) === resolve(root, request.source) && statement.importClause?.isTypeOnly) {
      contract = namespace.name.text
    }
    if (
      resolve(resolved) === resolve(root, request.target.entrypoint) &&
      !statement.importClause?.isTypeOnly
    ) {
      implementation = namespace.name.text
    }
  }
  if (!contract || !implementation) return false
  return source.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isSatisfiesExpression(statement.expression)) {
      return false
    }
    const expression = statement.expression
    return (
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === implementation &&
      ts.isTypeQueryNode(expression.type) &&
      ts.isIdentifier(expression.type.exprName) &&
      expression.type.exprName.text === contract
    )
  })
}

function bindingFile(root: string, request: ApplicationModuleBindingRequest): string {
  return resolve(root, request.target.root, 'implementation.contract.ts')
}

function exportSymbol(
  checker: ts.TypeChecker,
  program: ts.Program,
  file: string,
  path: string,
): ts.Symbol | undefined {
  const source = program.getSourceFile(resolve(file)) ?? program.getSourceFile(file)
  let symbol = source && checker.getSymbolAtLocation(source)
  for (const segment of path.split('.')) {
    if (!symbol) return
    const exported = checker.getExportsOfModule(symbol).find((candidate) => candidate.getName() === segment)
    symbol = exported && resolveAlias(checker, exported)
  }
  return symbol
}

function rawExportSymbol(
  checker: ts.TypeChecker,
  program: ts.Program,
  file: string,
  path: string,
): ts.Symbol | undefined {
  const source = program.getSourceFile(resolve(file)) ?? program.getSourceFile(file)
  let symbol = source && checker.getSymbolAtLocation(source)
  const segments = path.split('.')
  for (const [index, segment] of segments.entries()) {
    if (!symbol) return
    const exported = checker.getExportsOfModule(resolveAlias(checker, symbol))
      .find((candidate) => candidate.getName() === segment)
    symbol = index === segments.length - 1 ? exported : exported && resolveAlias(checker, exported)
  }
  return symbol
}

function facetOf(
  checker: ts.TypeChecker,
  program: ts.Program,
  file: string,
  value: { readonly path: readonly string[]; readonly typeOnly: boolean },
): ApplicationModuleBindingExportFacet {
  const symbol = exportSymbol(checker, program, file, exportKey(value.path))
  return {
    type: Boolean(symbol && (symbol.flags & ts.SymbolFlags.Type) !== 0),
    value: Boolean(symbol && !value.typeOnly && (symbol.flags & ts.SymbolFlags.Value) !== 0),
    typeOnly: value.typeOnly,
  }
}

function emptyFacet(): ApplicationModuleBindingExportFacet {
  return { type: false, value: false, typeOnly: false }
}

function exportResult(
  value: { readonly path: readonly string[]; readonly name: string },
  contract: ApplicationModuleBindingExportFacet,
  implementation: ApplicationModuleBindingExportFacet,
  status: ApplicationModuleBindingExport['status'],
): ApplicationModuleBindingExport {
  return { path: value.path, name: value.name, contract, implementation, status }
}

function diagnosticsForFile(
  root: string,
  program: ts.Program,
  file: string,
): ApplicationModuleBindingDiagnostic[] {
  const source = program.getSourceFile(resolve(file)) ?? program.getSourceFile(file)
  if (!source) {
    return [bindingDiagnostic(root, file, 'MODULE_ENTRYPOINT_NOT_IN_PROJECT', 'Binding root is absent from the compiler Program.')]
  }
  return ts.getPreEmitDiagnostics(program, source)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => compilerDiagnostic(root, diagnostic))
}

function compilerDiagnostic(root: string, diagnostic: ts.Diagnostic): ApplicationModuleBindingDiagnostic {
  const source = diagnostic.file
  const position = source && diagnostic.start !== undefined
    ? source.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined
  return {
    code: `TYPESCRIPT_${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    file: source ? portable(relative(root, source.fileName)) : '.',
    line: (position?.line ?? 0) + 1,
    column: (position?.character ?? 0) + 1,
  }
}

function issueDiagnostic(file: string, code: string, message: string): ApplicationModuleBindingDiagnostic {
  return { code, message, file, line: 1, column: 1 }
}

function bindingDiagnostic(
  root: string,
  file: string,
  code: string,
  message: string,
  exportPath?: string,
  expected?: string,
  actual?: string,
): ApplicationModuleBindingDiagnostic {
  return {
    code,
    message,
    file: portable(relative(root, resolve(file))),
    line: 1,
    column: 1,
    ...(exportPath ? { exportPath } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  }
}

function failedFact(
  _root: string,
  request: ApplicationModuleBindingRequest,
  diagnostics: readonly ApplicationModuleBindingDiagnostic[],
): ApplicationModuleBindingFact {
  return {
    specification: request.specification,
    target: request.target,
    exports: [],
    dependencies: [],
    declaredPackages: [],
    developmentPackages: [],
    errorCodes: [],
    expectedErrorCodes: [],
    files: [],
    diagnostics,
  }
}

function deduplicateDiagnostics(
  values: readonly ApplicationModuleBindingDiagnostic[],
): ApplicationModuleBindingDiagnostic[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()].sort(
    (left, right) => compare(
      `${left.file}\0${left.line}\0${left.column}\0${left.code}\0${left.exportPath ?? ''}`,
      `${right.file}\0${right.line}\0${right.column}\0${right.code}\0${right.exportPath ?? ''}`,
    ),
  )
}

function exportKey(path: readonly string[]): string {
  return path.join('.')
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
