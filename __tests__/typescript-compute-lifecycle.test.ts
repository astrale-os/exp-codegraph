import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openTypeScriptProject,
  type BoundedValueEvaluator,
  type SymbolicValuePlan,
  type TypeScriptProject,
  type TypeScriptSemanticReader,
} from '../analysis/typescript/index.ts'

const roots: string[] = []
const projects: TypeScriptProject[] = []
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture(helper = "export function value() { return { status: 'before' } }\n") {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-compute-lifecycle-'))
  roots.push(root)
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] })),
    writeFile(join(root, 'helper.ts'), helper),
    writeFile(join(root, 'index.ts'), "import { value } from './helper'; export const result = value()\n"),
    writeFile(join(root, 'unrelated.ts'), 'export const unrelated = 1\n'),
  ])
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
  })
  projects.push(project)
  await project.refresh()
  return { root, project, snapshot: await project.open() }
}

async function status(read: TypeScriptSemanticReader) {
  const calls = await read.calls({ paths: ['index.ts'] })
  expect(calls.sites).toHaveLength(1)
  const values = await read.values()
  const proof = await values.value(calls.sites[0]!.call.occurrence).property('status').resolve()
  // Public data only: the proof's private ownership metadata does not escape.
  return { ...proof }
}

describe('semantic computation public lifecycle', () => {
  it('captures the input before yielding and owns deeply frozen results on cold reads and hits', async () => {
    const { snapshot } = await fixture()
    let executions = 0
    let retained: { nested: { value: string }; paths: string[] } | undefined
    const observe = async (read: TypeScriptSemanticReader, input: { nested: { value: string }; paths: string[] }) => {
      executions++
      expect(Object.isFrozen(input)).toBe(true)
      expect(Object.isFrozen(input.nested)).toBe(true)
      expect(Object.isFrozen(input.paths)).toBe(true)
      await read.calls({ paths: input.paths })
      retained = { nested: { value: input.nested.value }, paths: [...input.paths] }
      return retained
    }
    const input = { nested: { value: 'captured' }, paths: ['index.ts'] }
    const pending = snapshot.compute(observe, input)
    input.nested.value = 'mutated after compute'
    input.paths.push('helper.ts')
    const first = await pending
    expect(first).toEqual({ nested: { value: 'captured' }, paths: ['index.ts'] })
    expect(first).not.toBe(retained)
    retained!.nested.value = 'mutated by producer'
    const hit = await snapshot.compute(observe, { nested: { value: 'captured' }, paths: ['index.ts'] })
    expect(executions).toBe(1)
    expect(hit).toEqual(first)
    expect(hit).not.toBe(first)
    for (const value of [first, hit]) {
      expect(Object.isFrozen(value)).toBe(true)
      expect(Object.isFrozen(value.nested)).toBe(true)
      expect(Object.isFrozen(value.paths)).toBe(true)
      expect(() => { value.nested.value = 'consumer mutation' }).toThrow()
    }
  })

  it('preserves distinctions observable by the callback in portable cache inputs', async () => {
    const { snapshot } = await fixture()
    let executions = 0
    type Input = { optional?: undefined; number: number; list: unknown[]; left: object; right: object }
    const observe = (_read: TypeScriptSemanticReader, input: Input) => {
      executions++
      return { optional: Object.hasOwn(input, 'optional'), negativeZero: Object.is(input.number, -0),
        firstElement: Object.hasOwn(input.list, 0), sameObject: input.left === input.right }
    }
    const shared = {}
    const inputs: Input[] = [
      { number: 0, list: [undefined], left: {}, right: {} },
      { optional: undefined, number: 0, list: [undefined], left: {}, right: {} },
      { number: -0, list: [undefined], left: {}, right: {} },
      { number: 0, list: new Array(1), left: {}, right: {} },
      { number: 0, list: [undefined], left: shared, right: shared },
    ]
    const expected = inputs.map((input) => ({ optional: Object.hasOwn(input, 'optional'),
      negativeZero: Object.is(input.number, -0), firstElement: Object.hasOwn(input.list, 0), sameObject: input.left === input.right }))
    for (const [index, input] of inputs.entries()) expect(await snapshot.compute(observe, input)).toEqual(expected[index])
    for (const [index, input] of inputs.entries()) expect(await snapshot.compute(observe, input)).toEqual(expected[index])
    expect(executions).toBe(inputs.length)
    const other = () => ({ optional: 'another callback' })
    expect(await snapshot.compute(other, inputs[0])).toEqual({ optional: 'another callback' })
  })

  it('captures dependencies from already cached proofs and invalidates only after a relevant edit', async () => {
    const { root, project, snapshot } = await fixture()
    const warmed = await status(snapshot)
    expect(warmed).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'before' } })
    let executions = 0
    const observe = (read: TypeScriptSemanticReader) => { executions++; return status(read) }
    expect(await snapshot.compute(observe, null)).toEqual(warmed)
    expect(await snapshot.compute(observe, null)).toEqual(warmed)
    expect(executions).toBe(1)
    await writeFile(join(root, 'unrelated.ts'), 'export const unrelated = 2\n')
    await project.refresh({ changed: ['unrelated.ts'] })
    const unrelated = await project.open()
    expect(await unrelated.compute(observe, null)).toEqual(warmed)
    expect(executions).toBe(1)
    await writeFile(join(root, 'helper.ts'), "export function value() { return { status: 'after' } }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const after = await project.open()
    const changed = await after.compute(observe, null)
    expect(changed).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'after' } })
    expect(changed).toEqual(await status(after))
    expect(executions).toBe(2)
    expect(await snapshot.compute(observe, null)).toEqual(warmed)
    expect(executions).toBe(3)
    expect(await after.compute(observe, null)).toEqual(changed)
    expect(executions).toBe(3)
  })

  it.each([
    { name: 'an absent property', helper: 'export function value() { return {} }\n', kind: 'known' },
    { name: 'a missing function body', helper: 'export declare function value(): { status: string }\n', kind: 'unsupported' },
    { name: 'a missing initializer', helper: 'export function value() { let result: { status: string }; return result }\n', kind: 'unknown' },
  ])('invalidates $name when the missing semantic evidence appears', async ({ helper, kind }) => {
    const { root, project, snapshot } = await fixture(helper)
    let executions = 0
    const observe = (read: TypeScriptSemanticReader) => { executions++; return status(read) }
    const first = await snapshot.compute(observe, null)
    expect(first.kind).toBe(kind)
    if (kind === 'known') expect(first).toMatchObject({ value: { kind: 'literal', value: undefined } })
    expect(await snapshot.compute(observe, null)).toEqual(first)
    expect(executions).toBe(1)
    await writeFile(join(root, 'helper.ts'), "export function value() { return { status: 'available' } }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const after = await project.open()
    const changed = await after.compute(observe, null)
    expect(changed).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'available' } })
    expect(changed).toEqual(await status(after))
    expect(executions).toBe(2)
  })

  it('never publishes a late old-generation completion over the current result', async () => {
    const { root, project, snapshot } = await fixture()
    const entered = deferred()
    const release = deferred()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      const execution = ++executions
      const result = await status(read)
      if (execution === 1) { entered.resolve(); await release.promise }
      return result
    }
    const old = snapshot.compute(observe, null)
    try {
      await entered.promise
      await writeFile(join(root, 'helper.ts'), "export function value() { return { status: 'current' } }\n")
      await project.refresh({ changed: ['helper.ts'] })
      const current = await project.open()
      const fresh = await current.compute(observe, null)
      expect(fresh).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'current' } })
      release.resolve()
      expect(await old).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'before' } })
      expect(await current.compute(observe, null)).toEqual(fresh)
      expect(executions).toBe(2)
    } finally { release.resolve(); await old.catch(() => {}) }
  })

  it('keeps cancellation local to its execution, including another caller of the same computation', async () => {
    const { snapshot } = await fixture()
    const entered = deferred()
    const release = deferred()
    const caller = new AbortController()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      const execution = ++executions
      const result = await status(read)
      if (execution === 1) { entered.resolve(); await release.promise }
      return result
    }
    const pending = snapshot.compute(observe, null, { signal: caller.signal })
    const rejected = expect(pending).rejects.toThrow('cancel this caller')
    try {
      await entered.promise
      const other = await snapshot.compute(observe, null)
      caller.abort(new Error('cancel this caller'))
      release.resolve()
      await rejected
      expect(await snapshot.compute(observe, null)).toEqual(other)
      expect(executions).toBe(2)
      await expect(snapshot.compute(observe, null, { signal: caller.signal })).rejects.toThrow('cancel this caller')
      expect(executions).toBe(2)
    } finally { release.resolve(); await pending.catch(() => {}) }
  })

  it('rejects cancellation before an arbitrary observer await finishes and permits a fresh computation', async () => {
    const { snapshot } = await fixture()
    const entered = deferred(), release = deferred()
    const controller = new AbortController()
    let escaped!: TypeScriptSemanticReader
    const pending = snapshot.compute(async (read) => {
      escaped = read
      const result = await status(read)
      entered.resolve()
      await release.promise
      return result
    }, null, { signal: controller.signal })
    const finished = pending.then(() => 'unexpected success', (error: unknown) => error)
    try {
      await entered.promise
      const reason = new Error('stop without waiting for observer')
      controller.abort(reason)
      const nextTurn = new Promise<string>((resolve) => setImmediate(() => resolve('still waiting')))
      expect(await Promise.race([finished, nextTurn])).toBe(reason)
      await expect(escaped.calls()).rejects.toThrow()
      expect(await snapshot.compute(status, null)).toMatchObject({ kind: 'known' })
    } finally { release.resolve(); await finished }
  })

  it('expires escaped readers, evaluators and plans after success and rejection', async () => {
    const { snapshot } = await fixture()
    let escapedRead!: TypeScriptSemanticReader
    let escapedValues!: BoundedValueEvaluator
    let escapedPlan!: SymbolicValuePlan
    const observe = async (read: TypeScriptSemanticReader, fail: boolean) => {
      escapedRead = read
      const calls = await read.calls({ paths: ['index.ts'] })
      escapedValues = await read.values()
      escapedPlan = escapedValues.value(calls.sites[0]!.call.occurrence)
      await escapedPlan.resolve()
      if (fail) throw new Error('observer rejected')
      return { complete: true }
    }
    for (const fail of [false, true]) {
      if (fail) await expect(snapshot.compute(observe, fail)).rejects.toThrow('observer rejected')
      else expect(await snapshot.compute(observe, fail)).toEqual({ complete: true })
      await expect(escapedRead.calls()).rejects.toThrow()
      await expect(escapedRead.values()).rejects.toThrow()
      await expect(escapedPlan.resolve()).rejects.toThrow()
      expect(() => escapedPlan.property('status')).toThrow()
      const calls = await snapshot.calls({ paths: ['index.ts'] })
      expect(() => escapedValues.value(calls.sites[0]!.call.occurrence)).toThrow()
      expect(await status(snapshot)).toMatchObject({ kind: 'known' })
    }
  })

  it('rejects a pending computation when its snapshot is disposed', async () => {
    const { project, snapshot } = await fixture()
    const entered = deferred()
    const release = deferred()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      const execution = ++executions
      const result = await status(read)
      if (execution === 1) { entered.resolve(); await release.promise }
      return result
    }
    const pending = snapshot.compute(observe, null)
    const rejected = expect(pending).rejects.toThrow('disposed')
    try {
      await entered.promise
      await snapshot.dispose()
      release.resolve()
      await rejected
      const fresh = await project.open()
      expect(await fresh.compute(observe, null)).toMatchObject({ kind: 'known' })
      expect(executions).toBe(2)
    } finally { release.resolve(); await pending.catch(() => {}) }
  })

  it('executes nonportable data normally without invoking getters during admission or retaining instances', async () => {
    const { snapshot } = await fixture()
    let getters = 0
    let executions = 0
    const input = { get value() { getters++; return 'read by callback' } }
    const observe = (_read: TypeScriptSemanticReader, data: { value: string }) => {
      executions++
      return { value: data.value }
    }
    for (let index = 0; index < 2; index++) expect(await snapshot.compute(observe, input)).toEqual({ value: 'read by callback' })
    expect(executions).toBe(2)
    expect(getters).toBe(2)
    class Result { constructor(readonly value: number) {} }
    let instanceExecutions = 0
    const instances = () => { instanceExecutions++; return new Result(42) }
    const first = await snapshot.compute(instances, null)
    const second = await snapshot.compute(instances, null)
    expect(first).toBeInstanceOf(Result)
    expect(second).toBeInstanceOf(Result)
    expect(second).not.toBe(first)
    expect(instanceExecutions).toBe(2)
  })

  it('does not retain a fallback after the callback catches a failed semantic read', async () => {
    const { snapshot } = await fixture()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      executions++
      try { await read.calls({ signal: AbortSignal.abort(new Error('read interrupted')) }) }
      catch { return { complete: false } }
      return { complete: true }
    }
    expect(await snapshot.compute(observe, null)).toEqual({ complete: false })
    expect(await snapshot.compute(observe, null)).toEqual({ complete: false })
    expect(executions).toBe(2)
  })

  it('keeps exact outputs and admits later requests under aggregate result pressure', async () => {
    const { snapshot } = await fixture()
    const executions = new Map<number, number>()
    const observe = async (read: TypeScriptSemanticReader, id: number) => {
      executions.set(id, (executions.get(id) ?? 0) + 1)
      const calls = await read.calls({ paths: ['index.ts'] })
      return { id, count: calls.sites.length, payload: String(id).repeat(2 * 1024 * 1024) }
    }
    const first = await snapshot.compute(observe, 0)
    for (let id = 1; id < 6; id++) {
      const result = await snapshot.compute(observe, id)
      expect(result.id).toBe(id)
      expect(result.count).toBe(1)
      expect(result.payload).toBe(String(id).repeat(2 * 1024 * 1024))
    }
    const lastExecutions = executions.get(5)
    expect((await snapshot.compute(observe, 5)).id).toBe(5)
    expect(executions.get(5)).toBe(lastExecutions)
    expect(await snapshot.compute(observe, 0)).toEqual(first)
    expect(executions.get(0)).toBe(2)
    expect(first.payload).toBe('0'.repeat(2 * 1024 * 1024))
  })
})
