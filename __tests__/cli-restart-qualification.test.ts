import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { qualifyCliRestart } from '../qualification/v2/application/cli-restart.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('separate-process CLI restart qualification', { timeout: 30_000 }, () => {
  // @evidence CLI-RESTART-PROCESS-BOUNDARY
  it('primes then interleaves distinct processes against one shared cache', async () => {
    const fixture = await createFixture(false)
    const evidence = await qualifyCliRestart({
      root: fixture.root,
      cli: fixture.cli,
      cacheDirectory: fixture.cache,
      scenarios: [
        { id: 'leaf', select: ['module'] },
        { id: 'multi', select: ['module', 'support'] },
      ],
      requireCleanGit: false,
    })

    expect(evidence.status).toBe('qualified')
    expect(evidence.violations).toEqual([])
    expect(evidence.scenarios.map(({ id, samples }) => [id, samples.length])).toEqual([
      ['whole', 5],
      ['leaf', 5],
      ['multi', 5],
    ])
    const pids = [
      evidence.cold.pid,
      ...evidence.scenarios.slice(1).map(({ prime }) => prime.pid),
      ...evidence.scenarios.flatMap(({ samples }) => samples.map(({ pid }) => pid)),
    ]
    expect(new Set(pids).size).toBe(pids.length)
    const order = (await readFile(join(fixture.cache, 'order.log'), 'utf8')).trim().split('\n')
    expect(order).toEqual([
      'whole',
      'module',
      'module,support',
      ...Array.from({ length: 5 }, () => ['whole', 'module', 'module,support']).flat(),
    ])
    expect(evidence.scenarios.every(({ p95Ms, limitMs }) => p95Ms < limitMs)).toBe(true)
  })

  it('fails when a warm process changes byte-exact CLI output', async () => {
    const fixture = await createFixture(true)
    const evidence = await qualifyCliRestart({
      root: fixture.root,
      cli: fixture.cli,
      cacheDirectory: fixture.cache,
      scenarios: [{ id: 'leaf', select: ['module'] }],
      requireCleanGit: false,
    })

    expect(evidence.status).toBe('failed')
    expect(evidence.violations).toContain(
      'whole warm sample 1 changed exit status or byte-exact output.',
    )
    expect(evidence.violations.some((value) => value.includes('leaf warm sample'))).toBe(true)
  })
})

async function createFixture(varyOutput: boolean): Promise<{
  root: string
  cli: string
  cache: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'codegraph-cli-restart-'))
  temporary.push(directory)
  const root = join(directory, 'root')
  const cache = join(directory, 'cache')
  const cli = join(directory, 'cg.mjs')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(root, { recursive: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/kernel' }), 'utf8')
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: '@fixture/codegraph', version: '0.0.0' }),
    'utf8',
  )
  await writeFile(
    cli,
    `import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const cache = process.env.ASTRALE_TYPESPEC_CACHE_DIR
if (!cache) throw new Error('missing cache')
const selected = process.argv.flatMap((value, index, values) => value === '--select' ? [values[index + 1]] : []).filter(Boolean)
await mkdir(join(cache, 'workspaces', 'fixture', 'application', 'manifests'), { recursive: true })
const counter = join(cache, 'counter')
let count = 0
try { count = Number(await readFile(counter, 'utf8')) } catch {}
count++
await writeFile(counter, String(count), 'utf8')
await appendFile(join(cache, 'order.log'), \`${"${selected.join(',') || 'whole'}"}\\n\`, 'utf8')
await writeFile(
  join(cache, 'workspaces', 'fixture', 'application', 'manifests', 'application-fixture.json'),
  JSON.stringify({
    format: 'astrale.codegraph.application-checkpoint',
    version: 1,
    producerFingerprint: 'fixture',
    scope: 'application-fixture',
    payload: { request: selected },
  }),
  'utf8',
)
await writeFile(
  join(cache, 'workspaces', 'fixture', 'application', 'manifests', 'cli-catalog-fixture.json'),
  JSON.stringify({
    format: 'astrale.codegraph.cli-check-catalog',
    version: 1,
    producerFingerprint: 'fixture',
    scope: 'cli-catalog-fixture',
    payload: { request: selected },
  }),
  'utf8',
)
const suffix = ${varyOutput ? 'String(count)' : "''"}
if (selected.length) process.stdout.write(\`Checked selected ${'${selected.length}'} specifications: 0 diagnostics.${'${suffix}'}\\n\`)
else process.stdout.write(\`Checked 1 specification: 0 diagnostics.${'${suffix}'}\\n\`)
`,
    'utf8',
  )
  return { root, cli, cache }
}
