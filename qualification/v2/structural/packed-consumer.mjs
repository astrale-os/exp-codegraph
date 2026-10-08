import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const tarball = argument('--package')
const binary = argument('--native-binary')
if (!tarball || !binary) throw new Error('Usage: node packed-consumer.mjs --package <tgz> --native-binary <binary> [--dependency-root <qualified node_modules>]')
const dependencyRoot = resolve(argument('--dependency-root') ?? join(import.meta.dirname, '../../../node_modules'))
const root = await mkdtemp(join(tmpdir(), 'codegraph-packed-structural-'))
const packageRoot = join(root, 'node_modules/@astrale-os/codegraph')

try {
  await mkdir(packageRoot, { recursive: true })
  await execute('tar', ['-xzf', resolve(tarball), '--strip-components=1', '-C', packageRoot])
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  for (const name of [...Object.keys(manifest.dependencies ?? {}), '@types/node']) {
    const destination = join(root, 'node_modules', name)
    await mkdir(dirname(destination), { recursive: true })
    await symlink(await realpath(join(dependencyRoot, name)), destination, 'dir')
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await cp(join(import.meta.dirname, 'fixtures/no-spec'), join(root, 'project'), { recursive: true })
  await writeFile(join(root, 'consumer.ts'), `import { openTypeScriptProject, type TypeScriptSemanticReader } from '@astrale-os/codegraph/analysis/typescript'
import { readVerifiedSourceText } from '@astrale-os/codegraph/analysis'
const inspect = async (read: TypeScriptSemanticReader) => {
  const structure = await read.structure()
  const selected = await structure.symbolAt({ path: 'consumer.ts', offset: 120 })
  if (selected.source) void readVerifiedSourceText(selected.source, { read: async () => '' })
  return { selected, uses: await structure.references({ target: {
    path: 'consumer.ts', offset: 120, revision: selected.source?.revision,
  } }) }
}
void openTypeScriptProject
void inspect
`)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    noEmit: true, strict: true, module: 'NodeNext', moduleResolution: 'NodeNext',
    target: 'ES2022', lib: ['ES2022', 'DOM', 'ESNext.Disposable'], types: ['node'],
  }, files: ['consumer.ts'] }))
  const declarations = await execute(join(dependencyRoot, '.bin/tsgo'), ['--noEmit', '-p', join(root, 'tsconfig.json')], { cwd: root })
  if (declarations.stdout.trim() || declarations.stderr.trim()) throw new Error(`Unexpected declaration-check output: ${declarations.stdout}${declarations.stderr}`)
  await writeFile(join(root, 'consumer.mjs'), `import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openTypeScriptProject } from '@astrale-os/codegraph/analysis/typescript'

const root = join(import.meta.dirname, 'project')
const project = await openTypeScriptProject({ root, binary: process.argv[2], capabilities: ['typescript.source', 'typescript.structure'] })
const snapshots = []
const open = async () => { const snapshot = await project.open(); snapshots.push(snapshot); return snapshot }
let fresh
try {
  await project.refresh()
  const before = await open()
  const structure = await before.structure()
  const refs = await structure.references({ target: { path: 'api.ts', name: 'api' } })
  assert.equal(refs.references.length, 9)
  assert.equal(refs.target.kind, 'resolved')
  assert(refs.evidence.length > 0)
  const consumerText = await readFile(join(root, 'consumer.ts'), 'utf8')
  const position = { path: 'consumer.ts', offset: consumerText.indexOf('invoke(options') }
  assert(position.offset >= 0)
  const selected = await structure.symbolAt(position)
  assert.equal(selected.target.kind, 'resolved')
  assert.equal(selected.sites.length, 1)
  assert.equal(selected.symbols[0].name, 'api')
  assert.equal(selected.symbols[0].declarations[0].path, 'api.ts')
  assert.equal(selected.source.logicalPath, 'consumer.ts')
  const positionalUses = await structure.references({ target: { ...position, revision: selected.source.revision } })
  assert.deepEqual(positionalUses.references, refs.references)
  assert.deepEqual(positionalUses.target, refs.target)
  for (const ref of refs.references) {
    assert.match(ref.span.source, /^source:/)
    assert.match(ref.span.revision, /^source-revision:/)
  }
  assert.deepEqual((await structure.exports({ path: 'public.ts' })).exports.map(row => row.name).sort(), ['Options', 'renamed'])
  const edges = await structure.dependencies()
  assert.equal(edges.dependencies.length, 14)
  assert.equal(edges.completeness.kind, 'partial')
  assert.deepEqual((await structure.dependents({ path: 'api.ts', transitive: true })).dependents.map(row => row.path).sort(), ['barrel.ts', 'consumer.ts', 'cycle-a.ts', 'cycle-b.ts', 'public.ts'])
  let executions = 0
  const observe = async (read, path) => { executions++; return (await read.structure()).references({ target: { path: 'api.ts', name: 'unused' }, paths: [path] }) }
  const absent = await before.compute(observe, 'empty.ts')
  assert.equal(absent.references.length, 0)
  assert.equal(absent.completeness.kind, 'complete')
  assert.deepEqual(await before.compute(observe, 'empty.ts'), absent)
  assert.equal(executions, 1)
  await writeFile(join(root, 'empty.ts'), "import { unused } from './api.js'; export const value = { unused }\\n")
  await project.refresh({ changed: ['empty.ts'] })
  const after = await open()
  const changed = await after.compute(observe, 'empty.ts')
  assert.equal(changed.references.length, 2)
  assert.equal(executions, 2)
  assert.deepEqual(await before.compute(observe, 'empty.ts'), absent)
  fresh = await openTypeScriptProject({ root, binary: process.argv[2], capabilities: ['typescript.source', 'typescript.structure'] })
  await fresh.refresh()
  const cold = await fresh.open()
  snapshots.push(cold)
  assert.deepEqual(await cold.compute(observe, 'empty.ts'), changed)
  console.log(JSON.stringify({ references: refs.references.length, dependencies: edges.dependencies.length, exports: 2, positionalNavigation: true, trackedAbsenceInvalidated: true, pinnedSnapshotPreserved: true, coldEquality: true }))
} finally {
  await Promise.all(snapshots.map(snapshot => snapshot.dispose()))
  await fresh?.dispose()
  await project.dispose()
}
`)
  const runtime = await execute(process.execPath, [join(root, 'consumer.mjs'), resolve(binary)], { cwd: root })
  process.stdout.write(`${JSON.stringify({
    qualification: 'isolated-packed-structural-consumer',
    package: { name: manifest.name, version: manifest.version, file: resolve(tarball), sha256: createHash('sha256').update(await readFile(resolve(tarball))).digest('hex') },
    nativeOverride: { file: resolve(binary), sha256: createHash('sha256').update(await readFile(resolve(binary))).digest('hex') },
    dependencies: 'Linked ordinary dependencies from the qualified offline dependency tree.',
    declarations: 'Public exported declarations typechecked without source aliases.',
    runtime: JSON.parse(runtime.stdout),
    scope: 'Packed JavaScript, declarations and runtime API with an explicit native override; not a complete multi-platform native release.',
  }, null, 2)}\n`)
} finally {
  await rm(root, { recursive: true, force: true })
}
