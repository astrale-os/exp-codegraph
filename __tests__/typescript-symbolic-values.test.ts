import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type SymbolicCallModel, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { OccurrenceId, SymbolId } from '../analysis/identity/index.ts'

const source = `
import { helper, shared } from './helper'
declare function marker(value: string): unknown
declare const opaque: object
declare const flag: boolean
function capture(value: unknown) { return () => value }
function rest(...values: unknown[]) { return values }
function first(value: unknown) { return value }
const base = { build: capture(marker('closed')), project: () => 'view' }
export const definition = () => ({ ...base })
export const laterExplicit = () => ({ ...opaque, build: () => marker('explicit') })
export const laterOpaque = () => ({ build: () => marker('hidden'), ...opaque })
export const asyncDefinition = async () => ({ build: () => marker('async') })
async function asyncLiteral() { return 'promise-result' }
function* generatorLiteral() { return 'iterator-result' }
function* generatorRequest() { return marker('iterator-request') }
export const asyncCall = asyncLiteral()
export const generatorCall = generatorLiteral()
export const generatorDefinition = () => ({ build: generatorRequest })
export const restDefinition = () => ({ build: () => rest(marker('rest')) })
export const spreadDefinition = () => ({ build: () => first(...[marker('spread')]) })
export const branch = () => flag ? marker('left') : marker('right')
export const dependent = () => ({ build: helper })
export const crossMutation = () => shared
export const direct = marker('direct')
export const nestedIdentity = first(first('nested'))
export const compound = () => { let value: any = ''; value += marker('compound'); return value }
export const mutatedObject = () => {
  const object = { build: () => marker('obsolete') }
  object.build = () => 'changed'
  return object
}
export const mutatedAlias = () => {
  const object = { build: () => marker('obsolete-alias') }
  const alias = object
  alias.build = () => 'changed'
  return object
}
`

describe('symbolic values through the public project API', () => {
  let root: string
  let project: TypeScriptProject
  let snapshot: TypeScriptProjectSnapshot
  let model: SymbolicCallModel<string>
  const declarations = new Map<string, OccurrenceId>()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codegraph-symbolic-'))
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, noEmit: true }, files: ['index.ts', 'helper.ts', 'mutator.ts'] })),
      writeFile(join(root, 'index.ts'), source),
      writeFile(join(root, 'helper.ts'), "export function helper() { return 'old' }\nexport const shared = { build: () => 'stable' }\n"),
      writeFile(join(root, 'mutator.ts'), 'export {}\n'),
    ])
    project = await openTypeScriptProject({ root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    await project.refresh()
    snapshot = await project.open()
    let marker: SymbolId | undefined
    for await (const fact of snapshot.facts.export('symbol')) if (fact.payload.name === 'marker') marker = fact.payload.symbol
    expect(marker).toBeDefined()
    model = (context) => {
      if (context.call.target !== marker) return
      const value = context.argument(0)
      return value?.kind === 'known' && value.value.kind === 'literal' && typeof value.value.value === 'string'
        ? { kind: 'atom', value: value.value.value }
        : { kind: 'unknown', reason: 'Marker argument is not a known string.' }
    }
    for await (const fact of snapshot.facts.export('body')) {
      for (const occurrence of fact.payload.body.occurrences) {
        if (occurrence.syntax !== 'VariableDeclaration') continue
        const text = source.slice(occurrence.span.start, occurrence.span.end)
        const name = /^([A-Za-z]+)\s*=/.exec(text)?.[1]
        if (name) declarations.set(name, occurrence.id)
      }
    }
  })

  afterAll(async () => { await project?.dispose(); if (root) await rm(root, { recursive: true, force: true }) })

  it('retains closure arguments, lazy properties and helper-returned functions', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const definition = values.value(declaration('definition')).invoke()
    const request = await definition.property('build').invoke().resolve()
    expect(request).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'closed' } })
    expect(request.evidence.length).toBeGreaterThan(1)
    expect(await definition.property('project').resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', execution: 'sync', parameterCount: 0 } })
    expect(await definition.property('project').invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'view' } })
    expect(await definition.property('absent').resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: undefined } })
    expect(await values.evaluate(declaration('nestedIdentity'))).toMatchObject({ kind: 'known', value: 'nested' })
  })

  it('keeps object spread overwrite order conservative', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('laterExplicit')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'explicit' } })
    expect(await values.value(declaration('laterOpaque')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'unknown' })
  })

  it.each(['restDefinition', 'spreadDefinition', 'asyncDefinition', 'generatorDefinition'])('does not manufacture synchronous scalar transfers for %s', async (name) => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration(name)).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it('keeps execution metadata while refusing Promise and Iterator scalar results', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('asyncDefinition')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', execution: 'async' } })
    for (const name of ['asyncCall', 'generatorCall']) {
      expect(await values.evaluate(declaration(name))).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_EXECUTION_UNSUPPORTED' })] })
    }
  })

  it('keeps alternative, step and cancellation boundaries independent between proofs', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const plan = values.value(declaration('branch')).invoke()
    expect(await plan.resolve()).toMatchObject({ kind: 'ambiguous', values: expect.arrayContaining([{ kind: 'atom', value: 'left' }, { kind: 'atom', value: 'right' }]) })
    expect(await plan.resolve({ limits: { maximumAlternatives: 1 } })).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_ALTERNATIVE_LIMIT' })] })
    expect(await plan.resolve({ limits: { maximumSteps: 1 } })).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })] })
    await expect(plan.resolve({ signal: AbortSignal.abort(new Error('superseded')) })).rejects.toThrow('superseded')
    expect(await plan.resolve()).toMatchObject({ kind: 'ambiguous' })
  })

  it('shares one immutable index across models without mixing hooks or budgets', async () => {
    const reader = await project.open()
    const reads = vi.spyOn(reader.query, 'export')
    const first = await reader.values({ call: model })
    const otherModel: SymbolicCallModel<string> = () => ({ kind: 'atom', value: 'different' })
    const second = await reader.values({ call: otherModel })
    expect(await reader.values({ call: model })).toBe(first)
    expect(second).not.toBe(first)
    const proof = await first.value(declaration('direct')).resolve()
    expect(await second.value(declaration('direct')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'different' } })
    expect(first.canReuse(proof)).toBe(true)
    expect(second.canReuse(proof)).toBe(false)
    expect((await reader.values({ call: model, limits: { maximumSteps: 1 } })).canReuse(proof)).toBe(false)
    expect(reads.mock.calls).toHaveLength(2)
    reads.mockRestore()
    await reader.dispose()
  })

  it('does not let a custom model overwrite exhausted operand budgets', async () => {
    const values = await snapshot.values({ limits: { maximumSteps: 2 }, call: (context) => {
      context.argument(0)
      return { kind: 'atom', value: 'cannot erase a hard limit' }
    } })
    expect(await values.value(declaration('direct')).resolve()).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })] })
  })

  it('does not mistake a compound assignment operand for the assigned value', async () => {
    const values = await snapshot.values({ call: model })
    expect(await values.value(declaration('compound')).invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it.each(['mutatedObject', 'mutatedAlias'])('does not claim the initializer is still effective for %s', async (name) => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration(name)).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it('invalidates a previously absent write in an independent module and recovers after removal', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const before = await values.value(declaration('crossMutation')).invoke().property('build').invoke().resolve()
    expect(before).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'stable' } })
    await writeFile(join(root, 'mutator.ts'), "import { shared } from './helper'; shared.build = () => 'changed'\n")
    await project.refresh({ changed: ['mutator.ts'] })
    const mutated = await project.open()
    const next = await mutated.values({ call: model, limits: { maximumDepth: 64 } })
    expect(next.canReuse(before)).toBe(false)
    const proof = await next.value(declaration('crossMutation')).invoke().property('build').invoke().resolve()
    expect(proof).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_MUTATION_UNSUPPORTED' })] })
    await writeFile(join(root, 'mutator.ts'), 'export {}\n')
    await project.refresh({ changed: ['mutator.ts'] })
    const repaired = await project.open()
    const recovered = await repaired.values({ call: model, limits: { maximumDepth: 64 } })
    expect(recovered.canReuse(proof)).toBe(false)
    expect(recovered.canReuse(before)).toBe(true)
    await mutated.dispose()
    await repaired.dispose()
  })

  it('invalidates semantic payload changes and newly available bodies while reusing unrelated evidence', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const plan = values.value(declaration('dependent')).invoke().property('build').invoke()
    const before = await plan.resolve()
    const unrelated = await values.value(declaration('direct')).resolve()
    expect(before).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'old' } })
    await writeFile(join(root, 'helper.ts'), "export declare function helper(): string\n")
    await project.refresh({ changed: ['helper.ts'] })
    const missing = await project.open()
    const next = await missing.values({ call: model, limits: { maximumDepth: 64 } })
    expect(next.canReuse(before)).toBe(false)
    expect(next.canReuse(unrelated)).toBe(true)
    const absent = await next.value(declaration('dependent')).invoke().property('build').invoke().resolve()
    expect(absent.kind).not.toBe('known')
    await writeFile(join(root, 'helper.ts'), "export function helper() { return 'new' }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const restored = await project.open()
    const final = await restored.values({ call: model, limits: { maximumDepth: 64 } })
    expect(final.canReuse(absent)).toBe(false)
    expect(await final.value(declaration('dependent')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'new' } })
    expect(await plan.resolve()).toEqual(before)
    await missing.dispose()
    await restored.dispose()
  })

  function declaration(name: string): OccurrenceId {
    const id = declarations.get(name)
    if (!id) throw new Error(`Missing variable ${name}.`)
    return id
  }
})
