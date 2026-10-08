import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { openTypeScriptProject, type TypeScriptProjectSnapshot, type TypeScriptSemanticReader } from '../../../analysis/typescript/index.ts'
import { inspectStructuralAPI } from './consumer.ts'
import { createStructuralOracle, orderLocations } from './oracle.ts'

const execute = promisify(execFile)
const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const binary = argument('--native-binary')
if (!binary) throw new Error('Usage: node repeat-edits.ts --native-binary <binary> [--edits <positive count>]')
const nativeExecutable = resolve(binary)
const edits = Number(argument('--edits') ?? 24)
if (!Number.isSafeInteger(edits) || edits < 1) throw new Error('--edits must be a positive integer.')
const root = await mkdtemp(join(tmpdir(), 'codegraph-structural-repeat-'))
const input = { path: 'api.ts', name: 'api', module: 'api.ts' }
const options = { root, binary: nativeExecutable, capabilities: ['typescript.source', 'typescript.structure'] }
let project: Awaited<ReturnType<typeof openTypeScriptProject>> | undefined
let pinned: Awaited<ReturnType<NonNullable<typeof project>['open']>> | undefined
let executions = 0
const observe = async (read: TypeScriptSemanticReader, value: typeof input) => {
  executions++
  return inspectStructuralAPI(read, value)
}

async function memory() {
  const node = process.memoryUsage()
  // Native sessions are direct children. This is observational qualification
  // evidence, not a machine-dependent pass/fail memory threshold.
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,comm='])
  const children = stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u)
    return match && Number(match[2]) === process.pid && match[4] === nativeExecutable
      ? [{ pid: Number(match[1]), rssBytes: Number(match[3]) * 1024, executable: match[4] }] : []
  })
  return { nodeRSSBytes: node.rss, nodeHeapUsedBytes: node.heapUsed, nativeChildren: children }
}

try {
  await cp(join(import.meta.dirname, 'fixtures/no-spec'), root, { recursive: true })
  project = await openTypeScriptProject(options)
  await project.refresh()
  pinned = await project.open()
  const baseline = await pinned.compute(inspectStructuralAPI, input)
  const samples: unknown[] = [{ edit: 0, ...await memory() }]
  let hits = 0
  for (let index = 1; index <= edits; index++) {
    await writeFile(join(root, 'repeat.ts'), `import { api } from './api.js'; export const value = { api }; // edit ${index}\n`)
    await project.refresh({ changed: ['repeat.ts'] })
    const current: TypeScriptProjectSnapshot = await project.open()
    try {
      const report: Awaited<ReturnType<typeof inspectStructuralAPI>> = await current.compute(observe, input)
      assert.equal(report.references.references.length, baseline.references.references.length + 2)
      assert.deepEqual(await current.compute(observe, input), report)
      assert.equal(executions, index)
      hits++
      const oracle = createStructuralOracle(root)
      const actual = report.references.references.map(({ path, span }) => ({ path, start: span.start, end: span.end })).sort(orderLocations)
      assert.deepEqual(actual, oracle.references('api.ts', 'api').map(({ text: _text, ...location }) => location))
      samples.push({ edit: index, callbackExecutions: executions, cacheHits: hits, ...await memory() })
    } finally { await current.dispose() }
  }
  await rm(join(root, 'repeat.ts'))
  await project.refresh({ changes: [{ path: 'repeat.ts', kind: 'unlink' }] })
  const final = await project.open()
  const fresh = await openTypeScriptProject(options)
  try {
    await fresh.refresh()
    const cold = await fresh.open()
    try {
      assert.deepEqual(await final.compute(inspectStructuralAPI, input), await cold.compute(inspectStructuralAPI, input))
      assert.deepEqual(await final.compute(inspectStructuralAPI, input), baseline)
      assert.deepEqual(await pinned.compute(inspectStructuralAPI, input), baseline)
    } finally { await cold.dispose() }
  } finally { await final.dispose(); await fresh.dispose() }
  process.stdout.write(`${JSON.stringify({ qualification: 'structural-repeat-edits', edits, callbackExecutions: executions,
    cacheHits: hits, oracleEveryEdit: true, deletionColdEquality: true, originalSnapshotPreserved: true,
    memoryInterpretation: 'Observed Node and native-session RSS without pass/fail thresholds; the Node process also runs the independent compiler oracle and retains one pinned original snapshot.', samples }, null, 2)}\n`)
} finally {
  await pinned?.dispose()
  await project?.dispose()
  await rm(root, { recursive: true, force: true })
}
