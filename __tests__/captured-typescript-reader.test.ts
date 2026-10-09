import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/process-session.ts'
import type { NativeCapturedAnalysisSource, NativeCapturedAnalysisPort, NativeCapturedAnalysisStamp, NativeAnalysisRequest } from '../analysis/protocol/model.ts'
import type { AnalysisGeneration } from '../analysis/generation/model.ts'
import type { AnalysisStore } from '../analysis/query/model.ts'
import { openCapturedTypeScriptReader, openTypeScriptProject, resolvePackagedNativeAnalysis, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/index.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'
import * as projectionFactory from '../analysis/typescript/project/project.ts'
import * as memoryFactory from '../analysis/memory/store.ts'

// Authentic generic facts qualify the JS ownership join. The Go capture bridge
// has separate same-Program/epoch tests; this fixture is not an installed pair.
const candidate = process.env.CODEGRAPH_TEST_NATIVE_BINARY
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-captured-reader-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022' }, include: ['*.ts'] }))
  await writeFile(join(root, 'index.ts'), `import { helper } from './helper';export const value=helper();`)
  await writeFile(join(root, 'helper.ts'), `export function helper(){return 'before'}`)
  await writeFile(join(root, 'other.ts'), `export const other=1`)
  const command = (await resolvePackagedNativeAnalysis(candidate ? { binary: candidate } : {})).command
  const factory = createProcessNativeAnalysisSessionFactory({ command, payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS })
  const lifetime = new AbortController()
  const closers = new Set<() => Promise<void>>()
  const leases = new Set<NativeCapturedAnalysisPort>()
  const requests: NativeAnalysisRequest[] = []
  let revision = 0
  let current: NativeCapturedAnalysisStamp
  let ownerRegistrations = 0
  let malformedAck = false
  let rejectStructure = false
  const capture = () => current = { token: `capture-${++revision}`, generation: `epoch-${revision}`, sourceSnapshotDigest: String(revision).padStart(64, '0') }
  const source: NativeCapturedAnalysisSource = {
    semanticReaderRevision: 1,
    async openSemanticProjection(stamp, options) {
      expect(stamp).toEqual(current)
      const controller = new AbortController()
      const project = { root, config: 'tsconfig.json', capabilities: [...(options?.capabilities ?? ['typescript.source', 'typescript.body-demand'])] }
      const native = await factory.open(project)
      let closing: Promise<void> | undefined
      const port: NativeCapturedAnalysisPort = {
        project, signal: controller.signal, ownerSignal: lifetime.signal,
        onOwnerDispose(dispose) { ownerRegistrations++; closers.add(dispose) },
        async request(request, options) {
          controller.signal.throwIfAborted()
          if (stamp.token !== current.token) throw new Error('Retired capture must not select current compiler.')
          requests.push(structuredClone(request))
          if (rejectStructure && request.kind === 'refresh' && project.capabilities.includes('typescript.structure')) {
            throw new Error('Captured semantic projection exceeds its frame bound; use the resident streamed reader.')
          }
          const response = await native.request(request, options)
          if (malformedAck && request.kind === 'acknowledge') return { ...response, id: request.id + 1 }
          return response
        },
        dispose() {
          if (!closing) {
            controller.abort(new Error('Projection lease is disposed.'))
            leases.delete(port)
            closing = native.dispose()
          }
          return closing
        },
      }
      leases.add(port)
      return port
    },
  }
  const close = async () => {
    lifetime.abort(new Error('Producer session disposed.'))
    await Promise.all([...closers].map((dispose) => dispose()))
    await Promise.all([...leases].map((port) => port.dispose()))
  }
  cleanup.push(close)
  return { root, source, capture, close, requests, leases,
    registrations: () => ownerRegistrations, corruptAck: (value: boolean) => { malformedAck = value },
    rejectStructure: (value: boolean) => { rejectStructure = value } }
}

async function inspect(read: TypeScriptSemanticReader, input: { paths: string[] }) {
  const inventory = await read.calls({ paths: input.paths })
  const values = await read.values()
  const result = []
  for (const site of inventory.sites) result.push(await values.value(site.occurrence.id).resolve())
  return { completeness: inventory.completeness.kind, values: result.map((value) => value.kind === 'known' && value.value.kind === 'literal' ? value.value.value : value.kind) }
}

interface PropertyInput {
  readonly start: number
  readonly properties: readonly { readonly name: string; readonly invoke?: boolean }[]
}

async function inspectProperties(read: TypeScriptSemanticReader, input: PropertyInput) {
  const inventory = await read.calls({ paths: ['index.ts'] })
  const values = await read.values()
  const site = inventory.sites.find(({ occurrence }) => occurrence.span.start === input.start)
  if (!site) throw new Error('The selected call has no owned occurrence.')
  const value = values.value(site.occurrence.id)
  const describe = async (plan: typeof value) => {
    const result = await plan.resolve()
    if (result.kind !== 'known') return { kind: result.kind }
    if (result.value.kind === 'literal') return { kind: 'literal', value: result.value.value === undefined ? '<undefined>' : result.value.value }
    if (result.value.kind === 'object') return { kind: 'object', properties: [...result.value.properties].sort(), complete: result.value.complete }
    return { kind: result.value.kind }
  }
  const result = []
  for (const property of input.properties) {
    const selected = value.property(property.name)
    result.push({ name: property.name, proof: await describe(property.invoke ? selected.invoke() : selected) })
  }
  return { completeness: inventory.completeness.kind, value: await describe(value), properties: result }
}

describe('captured TypeScript session fact ownership', () => {
  it('restores the current default provider after rejected structure acquisition and can still demand a new body', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'other.ts'), `export function extra(){return 'additional'} extra();`)
    const capture = f.capture()
    const reader = await openCapturedTypeScriptReader(f.source, capture)
    const before = await reader.compute(inspect, { paths: ['index.ts'] })
    f.rejectStructure(true)
    await expect(openCapturedTypeScriptReader(f.source, capture, {
      capabilities: ['typescript.source', 'typescript.body-demand', 'typescript.structure'],
    })).rejects.toThrow('frame bound')
    expect(f.leases.size).toBe(1)
    expect(await reader.compute(inspect, { paths: ['index.ts'] })).toEqual(before)
    const requested = f.requests.length
    expect(await reader.compute(inspect, { paths: ['other.ts'] })).toEqual({ completeness: 'complete', values: ['additional'] })
    expect(f.requests.length).toBeGreaterThan(requested)
    expect(await reader.compute(inspect, { paths: ['index.ts'] })).toEqual(before)
    await reader.dispose()
    expect(f.leases.size).toBe(0)
  })

  it.each([
    { name: 'identifier, quoted, numeric, literal-computed and shorthand keys', expression: `{plain:'plain','quoted-key':'quoted',12:'numeric',['literal-key']:'computed',short}`, properties: ['plain', 'quoted-key', '12', 'literal-key', 'short'].map((name) => ({ name })) },
    { name: 'direct, quoted and literal-computed nested methods', expression: `{method(){return 'method'},'quoted-method'(){return 'quoted'},['literal-method'](){return 'computed'}}`, properties: ['method', 'quoted-method', 'literal-method'].map((name) => ({ name, invoke: true })) },
    { name: 'authored literal spelling equal to a synthesized legacy marker', expression: `{'�computed'(){return 'authored'}}`, properties: [{ name: '�computed', invoke: true }] },
    { name: 'opaque computed keys', expression: `{[opaque]:'unproven'}`, properties: [{ name: 'opaque' }, { name: '__computed' }] },
    { name: 'well-known symbol keys', expression: `{[Symbol.iterator](){return 'symbol'}}`, properties: [{ name: 'iterator', invoke: true }, { name: '__computed', invoke: true }] },
    { name: 'member values', expression: `({value:'member'}).value`, properties: [] },
    { name: 'private member uncertainty', expression: `new (class {#value='private';read(){return this.#value}})().read()`, properties: [] },
    { name: 'last write and shorthand shadowing', expression: `{plain:'first',...{plain:'last'},short}`, properties: [{ name: 'plain' }, { name: 'short' }] },
  ])('matches full and fresh projections for $name without a global declaration index', async ({ expression, properties }) => {
    const f = await fixture()
    const text = `declare const opaque:string;declare const Symbol:{readonly iterator:unique symbol};function shape(){const short='short';return ${expression}}shape();`
    await writeFile(join(f.root, 'index.ts'), text)
    const input = { start: text.lastIndexOf('shape()'), properties }
    const compact = await openCapturedTypeScriptReader(f.source, f.capture())
    const proof = await compact.compute(inspectProperties, input)
    const full = await openTypeScriptProject({ root: f.root, binary: candidate })
    try {
      await full.refresh()
      const snapshot = await full.open()
      try { expect(proof).toEqual(await snapshot.compute(inspectProperties, input)) }
      finally { await snapshot.dispose() }
    } finally { await full.dispose() }
    const fresh = await fixture()
    await writeFile(join(fresh.root, 'index.ts'), text)
    const oracle = await openCapturedTypeScriptReader(fresh.source, fresh.capture())
    expect(proof).toEqual(await oracle.compute(inspectProperties, input))
    if (expression.includes('[opaque]') || expression.includes('[Symbol.iterator]')) {
      expect(proof.value).toEqual({ kind: 'object', properties: [], complete: false })
      expect(proof.properties.every(({ proof }) => proof.kind === 'unknown')).toBe(true)
    }
    await compact.dispose(); await oracle.dispose()
  })

  it('invalidates a same-length property rename, keeps its old pin, and repairs to a fresh proof', async () => {
    const f = await fixture()
    const original = `function shape(){return {alpha:'value'}}shape();`
    await writeFile(join(f.root, 'index.ts'), original)
    const input = { start: original.lastIndexOf('shape()'), properties: [{ name: 'alpha' }, { name: 'bravo' }] }
    let executions = 0
    const observe = (read: TypeScriptSemanticReader, input: PropertyInput) => { executions++; return inspectProperties(read, input) }
    const old = await openCapturedTypeScriptReader(f.source, f.capture())
    const before = await old.compute(observe, input)
    const initialExecutions = executions
    const edited = original.replace('alpha', 'bravo')
    await writeFile(join(f.root, 'index.ts'), edited)
    const current = await openCapturedTypeScriptReader(f.source, f.capture())
    const after = await current.compute(observe, input)
    expect(executions).toBeGreaterThan(initialExecutions)
    expect(after.properties).toEqual([{ name: 'alpha', proof: { kind: 'literal', value: '<undefined>' } }, { name: 'bravo', proof: { kind: 'literal', value: 'value' } }])
    expect(await old.compute(observe, input)).toEqual(before)
    const fresh = await fixture()
    await writeFile(join(fresh.root, 'index.ts'), edited)
    const oracle = await openCapturedTypeScriptReader(fresh.source, fresh.capture())
    expect(after).toEqual(await oracle.compute(observe, input))
    await writeFile(join(f.root, 'index.ts'), original)
    const repaired = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await repaired.compute(observe, input)).toEqual(before)
    await Promise.all([old.dispose(), current.dispose(), oracle.dispose(), repaired.dispose()])
  })

  it('publishes explicit structure only to its lease and invalidates capability receipts while old pins remain coherent', async () => {
    const f = await fixture()
    const exports = async (read: TypeScriptSemanticReader, _input: null) => {
      const result = await (await read.structure()).exports({ path: 'helper.ts' })
      return { completeness: result.completeness.kind, names: result.exports.map((entry) => entry.name) }
    }
    const stamp = f.capture()
    const omitted = await openCapturedTypeScriptReader(f.source, stamp)
    expect(await omitted.compute(exports, null)).toEqual({ completeness: 'unavailable', names: [] })
    const complete = await openCapturedTypeScriptReader(f.source, stamp, {
      capabilities: ['typescript.source', 'typescript.body-demand', 'typescript.structure'],
    })
    expect(await complete.compute(exports, null)).toEqual({ completeness: 'complete', names: ['helper'] })
    const excluded = await openCapturedTypeScriptReader(f.source, stamp)
    expect(await excluded.compute(exports, null)).toEqual({ completeness: 'unavailable', names: [] })
    expect(await complete.compute(exports, null)).toEqual({ completeness: 'complete', names: ['helper'] })
    expect(await complete.compute(exports, null)).toEqual({ completeness: 'complete', names: ['helper'] })
    expect(f.registrations()).toBe(1)
    await Promise.all([omitted.dispose(), complete.dispose(), excluded.dispose()])
  })

  it('joins an in-flight newly opened pin before reader disposal resolves', async () => {
    const original = projectionFactory.createResidentTypeScriptProject
    let entered!: () => void, release!: () => void, opened = 0
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const pins = new Set<object>()
    vi.spyOn(projectionFactory, 'createResidentTypeScriptProject').mockImplementation((...args) => {
      const project = original(...args), open = project.open.bind(project)
      project.open = async (...args) => {
        const snapshot = await open(...args)
        pins.add(snapshot)
        const tracked = Object.freeze({ ...snapshot, dispose: async () => { pins.delete(snapshot); await snapshot.dispose() } })
        if (++opened === 2) { entered(); await held }
        return tracked
      }
      return project
    })
    const f = await fixture(), reader = await openCapturedTypeScriptReader(f.source, f.capture())
    const work = reader.compute(inspect, { paths: ['index.ts'] })
    const failure = expect(work).rejects.toThrow('disposed')
    await ready
    expect(pins.size).toBe(2)
    let disposed = false
    const closing = reader.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release(); await failure; await closing
    expect(pins.size).toBe(0)
    expect(f.leases.size).toBe(0)
    const repaired = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await repaired.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    await repaired.dispose()
    expect(pins.size).toBe(0)
  })

  it('reuses tracked observations across no-op and unrelated captures without an empty intermediate generation', async () => {
    const f = await fixture()
    let executions = 0
    const observe = (read: TypeScriptSemanticReader, input: { paths: string[] }) => { executions++; return inspect(read, input) }
    const first = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await first.compute(observe, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    const initial = executions
    expect(initial).toBeGreaterThan(1) // source selection, then the helper owner.
    await first.dispose()
    expect(f.leases.size).toBe(0)
    const second = await openCapturedTypeScriptReader(f.source, f.capture())
    const opened = f.requests.length
    expect(await second.compute(observe, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    expect(executions).toBe(initial)
    expect(f.requests).toHaveLength(opened)
    await second.dispose()
    await writeFile(join(f.root, 'other.ts'), 'export const other=2')
    const third = await openCapturedTypeScriptReader(f.source, f.capture())
    const before = f.requests.length
    expect(await third.compute(observe, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    expect(executions).toBe(initial)
    expect(f.requests).toHaveLength(before)
    expect(f.registrations()).toBe(1)
    expect(f.requests.filter((request) => request.kind === 'refresh').slice(-2).every((request) => request.kind === 'refresh' && request.bodyDemand!.paths.includes('index.ts') && request.bodyDemand!.owners!.length > 0)).toBe(true)
    await third.dispose()
  })

  it.each(['selected-body', 'resolution', 'missing-export', 'global-declaration', 'mutation', 'alias', 'escape'] as const)(
    'recertifies %s dependencies against a fresh owner without reusing a stale positive', async (change) => {
      const f = await fixture()
      if (change === 'resolution') {
        await writeFile(join(f.root, 'helper.ts'), `import {selected} from '#selected';export function helper(){return selected()}`)
        await writeFile(join(f.root, 'target-a.ts'), `export function selected(){return 'before'}`)
        await writeFile(join(f.root, 'target-b.ts'), `export function selected(){return 'edited'}`)
        await writeFile(join(f.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', paths: { '#selected': ['./target-a.ts'] } }, include: ['*.ts'] }))
      } else if (change === 'missing-export') {
        await writeFile(join(f.root, 'helper.ts'), `import {selected} from './target';export function helper(){return selected()}`)
        await writeFile(join(f.root, 'target.ts'), 'export const unrelated=1')
      } else if (change === 'global-declaration') {
        await writeFile(join(f.root, 'helper.ts'), 'export function helper(){return FLAG}')
        await writeFile(join(f.root, 'globals.d.ts'), `declare const FLAG:'before'`)
      } else if (['mutation', 'alias', 'escape'].includes(change)) {
        await writeFile(join(f.root, 'helper.ts'), `export const state={value:'before'};export function helper(){return state.value}`)
      }
      let executions = 0
      const observe = (read: TypeScriptSemanticReader, input: { paths: string[] }) => { executions++; return inspect(read, input) }
      const before = await openCapturedTypeScriptReader(f.source, f.capture())
      const original = await before.compute(observe, { paths: ['index.ts'] })
      const previousExecutions = executions
      await before.dispose()
      if (change === 'selected-body') await writeFile(join(f.root, 'helper.ts'), `export function helper(){return 'edited'}`)
      if (change === 'resolution') await writeFile(join(f.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', paths: { '#selected': ['./target-b.ts'] } }, include: ['*.ts'] }))
      if (change === 'missing-export') await writeFile(join(f.root, 'target.ts'), `export function selected(){return 'edited'}`)
      if (change === 'global-declaration') await writeFile(join(f.root, 'globals.d.ts'), 'declare const FLAG:number')
      if (change === 'mutation') await writeFile(join(f.root, 'other.ts'), `import {state} from './helper';state.value='edited'`)
      if (change === 'alias') await writeFile(join(f.root, 'other.ts'), `import {state} from './helper';const alias=state;alias.value='edited'`)
      if (change === 'escape') await writeFile(join(f.root, 'other.ts'), `import {state} from './helper';declare function external(input:unknown):void;external(state)`)
      const current = await openCapturedTypeScriptReader(f.source, f.capture())
      const result = await current.compute(observe, { paths: ['index.ts'] })
      if (['selected-body', 'resolution', 'missing-export'].includes(change)) {
        expect(result.values).toEqual(['edited'])
        expect(executions).toBeGreaterThan(previousExecutions)
      } else {
        expect(result.values).toEqual(['unknown'])
        if (original.values[0] !== 'unknown') expect(executions).toBeGreaterThan(previousExecutions)
      }
      const fresh = await openCapturedTypeScriptReader({ ...f.source }, f.capture())
      expect(await fresh.compute(inspect, { paths: ['index.ts'] })).toEqual(result)
      await fresh.dispose(); await current.dispose()
    },
  )

  it('bounds active capture leases and fact pins while retaining one session owner', async () => {
    const makeStore = memoryFactory.createMemoryAnalysisStore, stores: AnalysisStore[] = []
    const makeProject = projectionFactory.createResidentTypeScriptProject, generations: AnalysisGeneration[] = []
    vi.spyOn(memoryFactory, 'createMemoryAnalysisStore').mockImplementation((...args) => {
      const store = makeStore(...args); stores.push(store); return store
    })
    vi.spyOn(projectionFactory, 'createResidentTypeScriptProject').mockImplementation((...args) => {
      const project = makeProject(...args), open = project.open.bind(project)
      project.open = async (...args) => { const snapshot = await open(...args); generations.push(snapshot.generation); return snapshot }
      return project
    })
    const f = await fixture(), observe = vi.fn(inspect)
    let original: Awaited<ReturnType<typeof inspect>> | undefined
    const pinned = await openCapturedTypeScriptReader(f.source, f.capture())
    original = await pinned.compute(observe, { paths: ['index.ts'] })
    const oldest = generations.at(-1)!
    for (let capture = 0; capture < 16; capture++) {
      await writeFile(join(f.root, 'other.ts'), `export const other=${capture}`)
      const reader = await openCapturedTypeScriptReader(f.source, f.capture())
      const result = await reader.compute(observe, { paths: ['index.ts'] })
      original ??= result
      expect(result).toEqual(original)
      expect(f.leases.size).toBe(1) // provider replacement closes the retired port.
      await reader.dispose()
      expect(f.leases.size).toBe(0)
    }
    expect(observe).toHaveBeenCalledTimes(3) // only the original deferred materialization.
    expect(f.registrations()).toBe(1)
    expect(stores).toHaveLength(1)
    const retained = await stores[0]!.open(oldest.universe, oldest.id)
    await retained.dispose()
    expect(await pinned.compute(inspect, { paths: ['index.ts'] })).toEqual(original)
    await pinned.dispose()
    // Looking at an old pin touches that universe's LRU slot. Two subsequent
    // captures may retire it only after its last explicit lease is released.
    for (const value of [20, 21]) {
      await writeFile(join(f.root, 'other.ts'), `export const other=${value}`)
      const next = await openCapturedTypeScriptReader(f.source, f.capture())
      expect(await next.compute(observe, { paths: ['index.ts'] })).toEqual(original)
      await next.dispose()
    }
    await expect(stores[0]!.open(oldest.universe, oldest.id)).rejects.toThrow(/not retained|No analysis generation/)
    await f.close()
    await expect(stores[0]!.current(oldest.universe)).rejects.toThrow('disposed')
    await expect(openCapturedTypeScriptReader(f.source, f.capture())).rejects.toThrow('disposed')
    expect(f.leases.size).toBe(0)
  })

  it('keeps old materialized pins coherent and refuses unresolved old demand without consulting CURRENT', async () => {
    const f = await fixture()
    const old = await openCapturedTypeScriptReader(f.source, f.capture())
    const before = await old.compute(inspect, { paths: ['index.ts'] })
    await writeFile(join(f.root, 'helper.ts'), `export function helper(){return 'edited'}`)
    const current = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await current.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['edited'] })
    expect(await old.compute(inspect, { paths: ['index.ts'] })).toEqual(before)
    const requests = f.requests.length
    await expect(old.compute(inspect, { paths: ['other.ts'] })).rejects.toThrow('retired capture')
    expect(f.requests).toHaveLength(requests)
    expect(await current.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['edited'] })
    await old.dispose(); await current.dispose()
  })

  it('cannot poison restored observations with a failed candidate and matches a fresh owner', async () => {
    const f = await fixture()
    const first = await openCapturedTypeScriptReader(f.source, f.capture())
    const original = await first.compute(inspect, { paths: ['index.ts'] })
    await first.dispose()
    await writeFile(join(f.root, 'helper.ts'), `export function helper(){return 'unsealed'}`)
    const failedPolicy = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await failedPolicy.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['unsealed'] })
    // Private fact publication is coherent; downstream seal deliberately fails.
    await failedPolicy.dispose()
    await writeFile(join(f.root, 'helper.ts'), `export function helper(){return 'before'}`)
    const restored = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await restored.compute(inspect, { paths: ['index.ts'] })).toEqual(original)
    const freshSource = { ...f.source }
    const fresh = await openCapturedTypeScriptReader(freshSource, f.capture())
    expect(await fresh.compute(inspect, { paths: ['index.ts'] })).toEqual(original)
    await restored.dispose(); await fresh.dispose()
  })

  it('captures queued plain inputs and releases every lease on cancellation and session disposal', async () => {
    const f = await fixture()
    const reader = await openCapturedTypeScriptReader(f.source, f.capture())
    await reader.compute(inspect, { paths: ['index.ts'] })
    let entered!: () => void, release!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const blocked = reader.compute(async () => { entered(); await held; return 'done' }, null)
    await ready
    const input = { paths: ['index.ts'] }
    const queued = reader.compute(inspect, input)
    input.paths[0] = 'other.ts'
    release()
    expect(await blocked).toBe('done')
    expect(await queued).toEqual({ completeness: 'complete', values: ['before'] })
    const controller = new AbortController()
    const pending = reader.compute(async () => new Promise(() => {}), null, { signal: controller.signal })
    controller.abort(new Error('cancelled computation'))
    await expect(pending).rejects.toThrow('cancelled computation')
    expect(await reader.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    await f.close()
    expect(f.leases.size).toBe(0)
    await expect(reader.compute(inspect, { paths: ['index.ts'] })).rejects.toThrow('disposed')
    await reader.dispose()
  })

  it('rejects unowned acknowledgement and recovers with a fresh capture on the same fact owner', async () => {
    const f = await fixture()
    f.corruptAck(true)
    await expect(openCapturedTypeScriptReader(f.source, f.capture())).rejects.toThrow('acknowledgement')
    expect(f.leases.size).toBe(0)
    f.corruptAck(false)
    const reader = await openCapturedTypeScriptReader(f.source, f.capture())
    expect(await reader.compute(inspect, { paths: ['index.ts'] })).toEqual({ completeness: 'complete', values: ['before'] })
    expect(f.registrations()).toBe(1)
    await reader.dispose()
  })
})
