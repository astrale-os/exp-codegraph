import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { inventoryModuleFiles } from '../specification/module/inventory.ts'

const fixtures: string[] = []
const workerSpawns = vi.hoisted(() => [] as unknown[][])
const workerRequests = vi.hoisted(() => [] as unknown[])

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (...arguments_: unknown[]) => {
      workerSpawns.push(arguments_)
      const child = Reflect.apply(actual.spawn, actual, arguments_)
      const stdin = child.stdin as unknown as { end: (...values: unknown[]) => unknown }
      const end = stdin.end.bind(child.stdin)
      stdin.end = (...values: unknown[]) => {
        if (typeof values[0] === 'string') workerRequests.push(JSON.parse(values[0]))
        return end(...values)
      }
      return child
    },
  }
})

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('built TypeScript isolation workers', () => {
  it('executes separate built workers and preserves multi-group aggregation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codegraph-typescript-isolation-'))
    fixtures.push(root)
    for (const name of ['alpha', 'beta']) {
      const specification = join(root, name, '.spec')
      mkdirSync(specification, { recursive: true })
      writeFileSync(join(specification, 'api.d.ts'), `export interface ${name} {}\n`)
    }
    const [alpha, beta] = await Promise.all(
      ['alpha', 'beta'].map((name) => inventoryModuleFiles(root, join(root, name, '.spec'))),
    )
    const { analyzeModuleTypeScriptGroupsIsolated } =
      await import('../dist/specification/module/typescript-process.optimization.js')

    const alphaOnly = await analyzeModuleTypeScriptGroupsIsolated(root, [[alpha!]])
    const betaOnly = await analyzeModuleTypeScriptGroupsIsolated(root, [[beta!]])
    workerSpawns.length = 0
    workerRequests.length = 0
    const combined = await analyzeModuleTypeScriptGroupsIsolated(root, [[alpha!], [beta!]])

    expect(workerSpawns).toHaveLength(2)
    expect(workerSpawns.map(([, arguments_]) => arguments_)).toEqual([
      [expect.stringMatching(/^--max-old-space-size=/u), expect.stringMatching(/\.js$/u)],
      [expect.stringMatching(/^--max-old-space-size=/u), expect.stringMatching(/\.js$/u)],
    ])
    expect(workerRequests).toEqual(
      [
        { root, groups: [[alpha!]] },
        { root, groups: [[beta!]] },
      ].map((value) => JSON.parse(JSON.stringify(value))),
    )
    expect(combined.entries.map(({ key }) => key)).toEqual([
      alphaOnly.entries[0]!.key,
      betaOnly.entries[0]!.key,
    ])
    expect(combined.entries.every(({ analysis }) => analysis.diagnostics.length === 0)).toBe(true)
    expect(combined.programs).toBe(alphaOnly.programs + betaOnly.programs)
    expect(combined.programs).toBeGreaterThan(0)
    expect(combined.workerPeakResidentBytes).toBeGreaterThan(0)
    expect(combined.workerResidentUpperBoundBytes).toBe(combined.workerPeakResidentBytes)
  })
})
