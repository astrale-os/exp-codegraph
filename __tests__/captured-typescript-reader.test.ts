import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/process-session.ts'
import type { NativeCapturedAnalysisSource, NativeCapturedAnalysisPort, NativeCapturedAnalysisStamp, NativeAnalysisRequest } from '../analysis/protocol/model.ts'
import type { AnalysisGeneration } from '../analysis/generation/model.ts'
import type { AnalysisStore } from '../analysis/query/model.ts'
import { openCapturedTypeScriptReader, resolvePackagedNativeAnalysis, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/index.ts'
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
  const capture = () => current = { token: `capture-${++revision}`, generation: `epoch-${revision}`, sourceSnapshotDigest: String(revision).padStart(64, '0') }
  const source: NativeCapturedAnalysisSource = {
    semanticReaderRevision: 1,
    async openSemanticProjection(stamp) {
      expect(stamp).toEqual(current)
      const controller = new AbortController()
      const project = { root, config: 'tsconfig.json', capabilities: ['typescript.source', 'typescript.symbol', 'typescript.occurrence', 'typescript.structure', 'typescript.body-demand'] }
      const native = await factory.open(project)
      let closing: Promise<void> | undefined
      const port: NativeCapturedAnalysisPort = {
        project, signal: controller.signal, ownerSignal: lifetime.signal,
        onOwnerDispose(dispose) { ownerRegistrations++; closers.add(dispose) },
        async request(request, options) {
          controller.signal.throwIfAborted()
          if (stamp.token !== current.token) throw new Error('Retired capture must not select current compiler.')
          requests.push(structuredClone(request))
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
    registrations: () => ownerRegistrations, corruptAck: (value: boolean) => { malformedAck = value } }
}

async function inspect(read: TypeScriptSemanticReader, input: { paths: string[] }) {
  const inventory = await read.calls({ paths: input.paths })
  const values = await read.values()
  const result = []
  for (const site of inventory.sites) result.push(await values.value(site.occurrence.id).resolve())
  return { completeness: inventory.completeness.kind, values: result.map((value) => value.kind === 'known' && value.value.kind === 'literal' ? value.value.value : value.kind) }
}

describe('captured TypeScript session fact ownership', () => {
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
