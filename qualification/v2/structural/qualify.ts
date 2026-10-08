import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openTypeScriptProject } from '../../../analysis/typescript/index.ts'
import { inspectStructuralAPI } from './consumer.ts'
import { createStructuralOracle, orderLocations } from './oracle.ts'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const binary = argument('--native-binary')
if (!binary) throw new Error('Usage: node qualify.ts --native-binary <binary> [--calibrate-http-readiness <source-directory>]')
const root = await mkdtemp(join(tmpdir(), 'codegraph-structural-qualification-'))
let project: Awaited<ReturnType<typeof openTypeScriptProject>> | undefined
let pinned: Awaited<ReturnType<NonNullable<typeof project>['open']>> | undefined

try {
  const calibration = argument('--calibrate-http-readiness')
  const input = calibration
    ? { path: 'accept.ts', name: 'acceptHttpReadiness', module: 'accept.ts' }
    : { path: 'api.ts', name: 'api', module: 'api.ts' }
  if (calibration) {
    // Both source files are copied; the original repository remains read-only.
    await Promise.all(['accept.ts', 'index.ts'].map((path) => cp(resolve(calibration, path), join(root, path))))
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }))
  } else {
    await cp(resolve(import.meta.dirname, 'fixtures/no-spec'), root, { recursive: true })
  }
  const start = performance.now()
  project = await openTypeScriptProject({ root, binary: resolve(binary), capabilities: ['typescript.source', 'typescript.structure'] })
  await project.refresh()
  const coldMs = performance.now() - start
  pinned = await project.open()
  const inspectStart = performance.now()
  const report = await pinned.compute(inspectStructuralAPI, input)
  const inspectMs = performance.now() - inspectStart
  const hitStart = performance.now()
  assert.deepEqual(await pinned.compute(inspectStructuralAPI, input), report)
  const cacheHitMs = performance.now() - hitStart
  const oracle = createStructuralOracle(root)
  const expectedReferences = oracle.references(input.path, input.name).map(({ text: _text, ...location }) => location)
  const actualReferences = report.references.references.map(({ path, span }) => ({ path, start: span.start, end: span.end })).sort(orderLocations)
  assert.deepEqual(actualReferences, expectedReferences, 'Public API reference locations differ from the independent compiler oracle.')
  const expectedDependencies = oracle.imports().map(({ text: _text, ...edge }) => edge)
  const actualDependencies = report.dependencies.dependencies.map((edge) => ({
    path: edge.path, start: edge.span.start, end: edge.span.end, kind: edge.kind, typeOnly: edge.typeOnly,
    ...(edge.specifier === undefined ? {} : { specifier: edge.specifier }),
    ...(edge.targetPath === undefined ? {} : { targetPath: edge.targetPath }),
  })).sort(orderLocations)
  assert.deepEqual(actualDependencies, expectedDependencies, 'Public dependency locations differ from independent compiler resolution.')
  process.stdout.write(`${JSON.stringify({
    qualification: 'structural-public-consumer',
    corpus: calibration ? { kind: 'copied-real-files', source: resolve(calibration), files: ['accept.ts', 'index.ts'] } : { kind: 'no-spec-fixture' },
    timings: { coldMs, inspectMs, cacheHitMs },
    oracleAgreement: { references: actualReferences.length, dependencies: actualDependencies.length },
    exports: report.exports,
    references: report.references,
    dependencies: report.dependencies,
    direct: report.direct,
    transitive: report.transitive,
  }, null, 2)}\n`)
} finally {
  await pinned?.dispose()
  await project?.dispose()
  await rm(root, { recursive: true, force: true })
}
