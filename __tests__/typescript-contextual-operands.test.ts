import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  openTypeScriptProject,
  type SymbolicCallModel,
  type SymbolicOperandPlan,
  type SymbolicValue,
  type TypeScriptProject,
  type TypeScriptProjectSnapshot,
  type ValueResult,
} from '../analysis/typescript/index.ts'
import type { OccurrenceId } from '../analysis/identity/index.ts'

const source = `
import { integration, provider } from '@fixture/platform'
import { route, transparent } from '@fixture/http'
import { configuration } from './helper'
function operationsFor(name: string) { const deploy = () => name; return { deploy } }
function register(name: string) {
  return integration({ id: name, operations: operationsFor(name) })
}
function provide(name: string) {
  return provider({ id: name }, operationsFor(name))
}
function routed(path: string) { return route(configuration(path)) }
const router = { prefix: '/api', send: route }
export const service = register('service-hosting')
export const binding = provide('cloudflare')
export const endpoint = routed('/health')
export const member = router.send({ path: '/member', handler: () => 'member' })
export const budgeted = route({ path: 'bounded', handler: () => 'bounded' })
const fabricated = ((options: unknown) => 'local') as typeof route
export const fake = fabricated({ path: '/fake', handler: () => 'fake' })
export const independent = provider({ id: 'independent' }, operationsFor('independent'))
function capture(value: string) { return () => value }
function wrap(value: string) { return transparent({ handler: capture(value) }) }
export const wrapped = wrap('preserved')
export const wrappedFunction = transparent(capture('function'))
`
const helper = "export function configuration(path: string) { return { path, handler: () => path } }\n"

describe('contextual operands through the public project API', () => {
  let root: string
  let project: TypeScriptProject
  let snapshot: TypeScriptProjectSnapshot
  const declarations = new Map<string, OccurrenceId>()

  const model: SymbolicCallModel<string> = (context) => {
    const callee = context.callee().resolve()
    if (callee.kind !== 'known' || callee.value.kind !== 'external') return
    const origin = callee.value.symbolOrigin
    if (origin?.file !== 'index.d.ts' || origin.path.length !== 1) return
    if (origin.package === '@fixture/http' && origin.path[0] === 'transparent') return context.argument(0)
    if (origin.package === '@fixture/platform') {
      const input = context.argument(0)
      const id = literal(input?.property('id').resolve())
      const implementation = origin.path[0] === 'integration'
        ? input?.property('operations') : context.argument(1)
      const method = implementation?.property('deploy')
      const shape = method?.resolve()
      const returned = literal(method?.invoke().resolve())
      return typeof id === 'string' && typeof returned === 'string' &&
        shape?.kind === 'known' && shape.value.kind === 'function'
        ? { kind: 'atom', value: `${id}:${returned}` }
        : { kind: 'unknown', reason: 'The declaration or its implementation is opaque.' }
    }
    if (origin.package === '@fixture/http' && origin.path[0] === 'route') {
      const options = context.argument(0)
      const path = literal(options?.property('path').resolve())
      const handler = literal(options?.property('handler').invoke().resolve())
      const middleware = options?.property('middleware').resolve()
      const prefix = context.receiver()?.property('prefix').resolve()
      return typeof path === 'string' && typeof handler === 'string' && middleware?.kind === 'known'
        ? { kind: 'atom', value: `${literal(prefix) ?? ''}${path}:${handler}:${literal(middleware) ?? 'none'}` }
        : { kind: 'unknown', reason: 'The route configuration is opaque.' }
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codegraph-operands-'))
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, noEmit: true }, files: ['index.ts', 'helper.ts'] })),
      writeFile(join(root, 'index.ts'), source),
      writeFile(join(root, 'helper.ts'), helper),
    ])
    for (const [name, declaration] of [
      ['platform', 'export declare function integration(options: any): unknown\nexport declare function provider(definition: any, implementation: any): unknown\n'],
      ['http', 'export declare function route(options: any): unknown\nexport declare function transparent<Value>(value: Value): Value\n'],
    ]) {
      const directory = join(root, 'node_modules/@fixture', name!)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, types: 'index.d.ts' }))
      await writeFile(join(directory, 'index.d.ts'), declaration!)
    }
    project = await openTypeScriptProject({ root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    await project.refresh()
    snapshot = await project.open()
    for await (const fact of snapshot.facts.export('body')) {
      for (const occurrence of fact.payload.body.occurrences) {
        if (occurrence.syntax !== 'VariableDeclaration') continue
        const name = /^([A-Za-z]+)\s*=/.exec(source.slice(occurrence.span.start, occurrence.span.end))?.[1]
        if (name) declarations.set(name, occurrence.id)
      }
    }
  })

  afterAll(async () => {
    await project?.dispose()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('navigates declaration options and helper-returned methods without losing closure arguments', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    for (const [name, expected] of [['service', 'service-hosting:service-hosting'], ['binding', 'cloudflare:cloudflare']]) {
      const proof = await values.value(declaration(name!)).resolve()
      expect(proof).toMatchObject({ kind: 'known', value: { kind: 'atom', value: expected } })
      expect(proof.evidence.length).toBeGreaterThan(1)
    }
  })

  it('uses the same operands for a route boundary, including its actual receiver', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('endpoint')).resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'atom', value: '/health:/health:none' } })
    expect(await values.value(declaration('member')).resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'atom', value: '/api/member:member:none' } })
    expect(await values.value(declaration('fake')).resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'local' } })
  })

  it('charges every operand resolution to one cumulative budget and keeps other proofs independent', async () => {
    const read = (count: number): SymbolicCallModel<string> => (context) => {
      const operand = context.argument(0)?.property('path')
      for (let index = 0; index < count; index += 1) operand?.resolve()
      return { kind: 'atom', value: 'a model cannot erase exhaustion' }
    }
    const one = await snapshot.values({ call: read(1), limits: { maximumSteps: 16 } })
    const repeated = await snapshot.values({ call: read(20), limits: { maximumSteps: 16 } })
    expect(await one.value(declaration('budgeted')).resolve()).toMatchObject({ kind: 'known' })
    expect(await repeated.value(declaration('budgeted')).resolve()).toMatchObject({
      kind: 'unknown', reasons: expect.arrayContaining([expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })]),
    })
    expect(await repeated.value(declaration('budgeted')).resolve({ limits: { maximumSteps: 256 } })).toMatchObject({ kind: 'known' })
    expect(await one.value(declaration('budgeted')).resolve()).toMatchObject({ kind: 'known' })
  })

  it('transfers a modeled operand without materializing its object or captured function', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('wrapped')).property('handler').invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'preserved' } })
    expect(await values.value(declaration('wrappedFunction')).invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'function' } })
    expect(await values.value(declaration('wrapped')).property('handler').invoke().resolve({ limits: { maximumSteps: 4 } }))
      .toMatchObject({ kind: 'unknown', reasons: expect.arrayContaining([expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })]) })
  })

  it('keeps operand navigation lazy and does not reset depth inside a model', async () => {
    const lazy = await snapshot.values({ limits: { maximumSteps: 2 }, call: (context) => {
      context.argument(0)?.property('path').invoke()
      return { kind: 'atom', value: 'not demanded' }
    } })
    expect(await lazy.value(declaration('budgeted')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'not demanded' } })
    const bounded = await snapshot.values({ call: model, limits: { maximumDepth: 3 } })
    expect(await bounded.value(declaration('service')).resolve()).toMatchObject({
      kind: 'unknown', reasons: expect.arrayContaining([expect.objectContaining({ code: 'VALUE_DEPTH_LIMIT' })]),
    })
    expect(await bounded.value(declaration('service')).resolve({ limits: { maximumDepth: 64 } })).toMatchObject({ kind: 'known' })
  })

  it('ends the operand lifetime when its synchronous hook returns or throws', async () => {
    let retained: SymbolicOperandPlan<string> | undefined
    const values = await snapshot.values({ call: (context) => {
      retained = context.argument(0)?.property('path')
      return { kind: 'atom', value: 'done' }
    } })
    await values.value(declaration('budgeted')).resolve()
    expect(() => retained?.resolve()).toThrow('during its call model')
    const failure = await snapshot.values({ call: (context) => {
      retained = context.argument(0)
      throw new Error('model failure')
    } })
    await expect(failure.value(declaration('budgeted')).resolve()).rejects.toThrow('model failure')
    expect(() => retained?.property('path').resolve()).toThrow('during its call model')
    const invalidTransfer = await snapshot.values({ call: () => retained })
    await expect(invalidTransfer.value(declaration('budgeted')).resolve()).rejects.toThrow('operand from its active proof')
  })

  it('invalidates negative properties and missing helper bodies read inside a model', async () => {
    const options = { call: model, limits: { maximumDepth: 64 } }
    const values = await snapshot.values(options)
    const before = await values.value(declaration('endpoint')).resolve()
    const unrelated = await values.value(declaration('independent')).resolve()
    expect(before).toMatchObject({ kind: 'known', value: { kind: 'atom', value: '/health:/health:none' } })
    await writeFile(join(root, 'helper.ts'), helper.replace('path, handler:', "path, middleware: 'auth', handler:"))
    await project.refresh({ changed: ['helper.ts'] })
    const added = await project.open()
    const changed = await added.values(options)
    expect(changed.canReuse(before)).toBe(false)
    expect(changed.canReuse(unrelated)).toBe(true)
    expect(await changed.value(declaration('endpoint')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: '/health:/health:auth' } })
    await writeFile(join(root, 'helper.ts'), 'export declare function configuration(path: string): any\n')
    await project.refresh({ changed: ['helper.ts'] })
    const missing = await project.open()
    const absentValues = await missing.values(options)
    const absent = await absentValues.value(declaration('endpoint')).resolve()
    expect(absent.kind).toBe('unknown')
    expect(absentValues.canReuse(absent)).toBe(true)
    await writeFile(join(root, 'helper.ts'), helper)
    await project.refresh({ changed: ['helper.ts'] })
    const repaired = await project.open()
    const restored = await repaired.values(options)
    expect(restored.canReuse(absent)).toBe(false)
    expect(restored.canReuse(before)).toBe(true)
    expect(await restored.value(declaration('endpoint')).resolve()).toEqual(before)
    expect(await values.value(declaration('endpoint')).resolve()).toEqual(before)
    await Promise.all([added.dispose(), missing.dispose(), repaired.dispose()])
  })

  function declaration(name: string): OccurrenceId {
    const id = declarations.get(name)
    if (!id) throw new Error(`Missing variable ${name}.`)
    return id
  }
})

function literal(result: ValueResult<SymbolicValue<string>> | undefined): unknown {
  return result?.kind === 'known' && result.value.kind === 'literal' ? result.value.value : undefined
}
