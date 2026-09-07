import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/index.ts'
import {
  createBoundedValueEvaluator,
  createTypeScriptAnalysisService,
  createTypeScriptFactReader,
  type BoundedValueEvaluator,
} from '../analysis/typescript/index.ts'
import { resolveTtscNativeAnalysis } from '../analysis/typescript/ttsc/index.ts'
import type { OccurrenceId } from '../analysis/identity/index.ts'

const source = `
function concise() { const helper = () => 'concise'; return helper(); }
function forwarded() { const helper = (value: string) => value; return helper('forwarded'); }
function block() { const value = 'block'; return value; }
function binary() { return 1 + 2; }
function property() { const value = 'value'; return value.length; }
function element() { const value = 'value'; return value[0]; }
function rest(...values: string[]) { return values; }
function restCall() { return rest('first', 'second'); }
function select(second: string, third: string) { return third; }
function spreadCall(values: [string, string]) { return select(...values); }
function unrelated() { return select('unrelated', 'poison'); }
function probe(values: [string, string]) {
  concise(); forwarded(); block(); binary(); property(); element(); restCall(); spreadCall(values);
}
`

describe('bounded values from real TypeScript bodies', () => {
  let root: string
  let evaluator: BoundedValueEvaluator
  let limited: BoundedValueEvaluator
  let close: (() => Promise<void>) | undefined
  const calls = new Map<string, OccurrenceId>()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codegraph-values-'))
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { noLib: true, noEmit: true, strict: true },
        files: ['values.ts'],
      })),
      writeFile(join(root, 'values.ts'), source),
    ])
    const native = await resolveTtscNativeAnalysis({
      root: resolve(import.meta.dirname, '..'),
      config: 'tsconfig.json',
      cacheDirectory: join(tmpdir(), 'codegraph-test-ttsc'),
      ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    })
    const store = createMemoryAnalysisStore()
    const service = await createTypeScriptAnalysisService({
      project: { root, config: 'tsconfig.json', capabilities: ['typescript.body'] },
      sessions: createProcessNativeAnalysisSessionFactory({ command: native.command }),
      store,
    })
    try {
      const refreshed = await service.refresh()
      const query = await store.open(refreshed.generation.universe, refreshed.generation.id)
      close = async () => {
        await query.dispose()
        await service.dispose()
        await store.dispose()
      }
      try {
        for await (const fact of createTypeScriptFactReader(query).export('body')) {
          for (const call of fact.payload.body.calls) {
            const occurrence = fact.payload.body.occurrences.find((value) => value.id === call.occurrence)!
            calls.set(source.slice(occurrence.span.start, occurrence.span.end).trim(), call.occurrence)
          }
        }
        evaluator = await createBoundedValueEvaluator({ query })
        limited = await createBoundedValueEvaluator({ query, limits: { maximumSteps: 1 } })
      } catch (error) {
        await close()
        close = undefined
        throw error
      }
    } catch (error) {
      await service.dispose()
      await store.dispose()
      throw error
    }
  }, 120_000)

  afterAll(async () => {
    try {
      await close?.()
    } finally {
      if (root) await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['concise', 'forwarded', 'block'])('preserves a proven %s return', async (name) => {
    const result = await evaluator.evaluate(call(`${name}()`))
    expect(result).toMatchObject({ kind: 'known', value: name })
    expect(result.evidence.length).toBeGreaterThan(0)
  })

  it.each(['binary()', 'property()', 'element()', 'restCall()', 'spreadCall(values)'])(
    'does not manufacture a scalar value for %s',
    async (expression) => {
      const result = await evaluator.evaluate(call(expression))
      expect(result.kind).toBe('unknown')
      expect(result.evidence.length).toBeGreaterThan(0)
    },
  )

  it('preserves a reasoning budget failure through enclosing calls', async () => {
    const result = await limited.evaluate(call('block()'))
    expect(result).toMatchObject({
      kind: 'unknown',
      reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })],
      limits: { maximumSteps: 1 },
    })
  })

  it('propagates cancellation without caching a semantic conclusion', async () => {
    const reason = new Error('new source revision')
    await expect(evaluator.evaluate(call('block()'), { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    await expect(evaluator.evaluate(call('block()'))).resolves.toMatchObject({ kind: 'known', value: 'block' })
  })

  function call(expression: string): OccurrenceId {
    const occurrence = calls.get(expression)
    if (!occurrence) throw new Error(`Native analysis did not retain ${expression}.`)
    return occurrence
  }
})
