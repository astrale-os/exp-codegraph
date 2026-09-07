import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProcessNativeAnalysisSessionFactory, createMemoryAnalysisStore, type AnalysisStore } from '../analysis/index.ts'
import { openTypeScriptProject, resolvePackagedNativeAnalysis } from '../analysis/typescript/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-project-'))
  roots.push(root)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022' }, include: ['*.ts'] }))
  await writeFile(join(root, 'index.ts'), "export function value() { return 'first' }\n")
  return root
}

describe('resident TypeScript project public API', () => {
  it('pins readers across edits, shares evaluators by budget and serializes refresh', async () => {
    const root = await fixture()
    const project = await openTypeScriptProject({ root })
    try {
      const initial = await project.refresh()
      expect(initial.transactions).toHaveLength(1)
      const before = await project.open(initial.generation)
      const original = await before.facts.facts('source')
      const evaluator = await before.values()
      expect(await before.values({ limits: { maximumSteps: 2_000 } })).toBe(evaluator)
      expect(await before.values({ limits: { maximumSteps: 10 } })).not.toBe(evaluator)
      await writeFile(join(root, 'index.ts'), "export function value() { return 'second' }\n")
      const [edited, unchanged] = await Promise.all([
        project.refresh({ changed: ['index.ts'] }), project.refresh(),
      ])
      expect(edited.generation.id).not.toBe(initial.generation.id)
      expect(unchanged.generation.id).toBe(edited.generation.id)
      expect(unchanged.changedSources).toEqual([])
      expect(unchanged.transactions).toEqual([])
      expect(await before.facts.facts('source')).toEqual(original)
      const after = await project.open(edited.generation)
      expect((await after.facts.facts('source')).facts[0]!.payload.revision)
        .not.toBe(original.facts[0]!.payload.revision)
      await after.dispose()
      await before.dispose()
      await expect(before.values()).rejects.toThrow('disposed')
    } finally { await project.dispose() }
    await expect(project.refresh()).rejects.toThrow('disposed')
  })

  it('reopens the native process after a request failure and keeps caller stores available', async () => {
    const root = await fixture()
    const native = await resolvePackagedNativeAnalysis()
    const factory = createProcessNativeAnalysisSessionFactory({ command: native.command })
    let opens = 0
    let fail = true
    const store = createMemoryAnalysisStore()
    const project = await openTypeScriptProject({ root, store, sessions: {
      async open(descriptor, options) {
        opens++
        const session = await factory.open(descriptor, options)
        return {
          request(request, requestOptions) {
            if (fail) { fail = false; return Promise.reject(new Error('transient native failure')) }
            return session.request(request, requestOptions)
          },
          acknowledge: session.acknowledge?.bind(session),
          dispose: () => session.dispose(),
        }
      },
    } })
    try {
      await expect(project.refresh()).rejects.toThrow('transient native failure')
      const recovered = await project.refresh()
      expect(opens).toBe(2)
      await project.dispose()
      const pinned = await store.open(recovered.generation.universe, recovered.generation.id)
      expect((await pinned.facts()).facts.length).toBeGreaterThan(0)
      await pinned.dispose()
    } finally { await project.dispose(); await store.dispose() }
  })

  it('cancels an in-flight open when the project is disposed', async () => {
    let opening!: () => void
    const started = new Promise<void>((resolve) => { opening = resolve })
    const project = await openTypeScriptProject({ root: await fixture(), sessions: {
      async open(_descriptor, options) {
        opening()
        return new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
        })
      },
    } })
    const refresh = project.refresh()
    const rejected = expect(refresh).rejects.toThrow('disposed')
    await started
    await project.dispose()
    await rejected
  })

  it('does not keep a completed opening request signal attached to the resident process', async () => {
    const project = await openTypeScriptProject({ root: await fixture() })
    try {
      const caller = new AbortController()
      const initial = await project.refresh({ signal: caller.signal })
      caller.abort(new Error('caller finished'))
      expect((await project.refresh()).generation.id).toBe(initial.generation.id)
    } finally { await project.dispose() }
  })

  it('retains every exact committed transaction across post-commit failures', async () => {
    const root = await fixture()
    const native = await resolvePackagedNativeAnalysis()
    const factory = createProcessNativeAnalysisSessionFactory({ command: native.command })
    const mirror = createMemoryAnalysisStore()
    let failures = 0
    let opens = 0
    const project = await openTypeScriptProject({ root, sessions: {
      async open(descriptor, options) {
        opens++
        const session = await factory.open(descriptor, options)
        return {
          request: session.request.bind(session),
          async acknowledge(acknowledgement, requestOptions) {
            if (failures > 0) {
              failures--
              throw new Error('acknowledgement interrupted after commit')
            }
            await session.acknowledge?.(acknowledgement, requestOptions)
          },
          dispose: () => session.dispose(),
        }
      },
    } })
    try {
      const initial = await project.refresh()
      for (const transaction of initial.transactions) await mirror.commit(transaction)
      for (const value of ['second', 'third']) {
        failures = 1
        await writeFile(join(root, 'index.ts'), `export function value() { return '${value}' }\n`)
        await expect(project.refresh({ changed: ['index.ts'] })).rejects.toThrow('acknowledgement interrupted')
      }
      const recovered = await project.refresh()
      expect(opens).toBe(3)
      expect(recovered.transactions).toHaveLength(2)
      expect(recovered.changedSources).toEqual(initial.changedSources)
      expect(recovered.transactions[0]!.base).toBe(initial.generation.id)
      expect(recovered.transactions[1]!.base).toBe(recovered.transactions[0]!.next.id)
      for (const transaction of recovered.transactions) await mirror.commit(transaction)
      expect(await mirror.current(recovered.generation.universe)).toEqual(recovered.generation)
      expect((await project.refresh()).transactions).toEqual([])
    } finally { await project.dispose(); await mirror.dispose() }
  })

  it('opens exact old universe readers after configuration changes and restoration', async () => {
    const root = await fixture()
    const project = await openTypeScriptProject({ root })
    try {
      const initial = await project.refresh()
      const configuration = JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', strict: true }, include: ['*.ts'] })
      await writeFile(join(root, 'tsconfig.json'), configuration)
      const changed = await project.refresh({ changed: ['tsconfig.json'] })
      expect(changed.generation.universe).not.toBe(initial.generation.universe)
      const original = await project.open(initial.generation)
      expect(original.generation).toEqual(initial.generation)
      await original.dispose()
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022' }, include: ['*.ts'] }))
      const restored = await project.refresh({ changed: ['tsconfig.json'] })
      expect(restored.generation).toEqual(initial.generation)
      const other = await project.open(changed.generation)
      expect(other.generation).toEqual(changed.generation)
      await other.dispose()
    } finally { await project.dispose() }
  })

  it('releases a delayed reader instead of returning it after disposal', async () => {
    const backing = createMemoryAnalysisStore()
    const opened = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let delay = false
    const store: AnalysisStore = {
      current: (universe) => backing.current(universe),
      commit: (transaction, options) => backing.commit(transaction, options),
      snapshotSet: (generations, inventory) => backing.snapshotSet(generations, inventory),
      dispose: () => backing.dispose(),
      async open(universe, generation) {
        const query = await backing.open(universe, generation)
        if (delay) { opened.resolve(); await release.promise }
        return query
      },
    }
    const project = await openTypeScriptProject({ root: await fixture(), store })
    try {
      await project.refresh()
      delay = true
      const pending = expect(project.open()).rejects.toThrow('disposed')
      await opened.promise
      const closed = project.dispose()
      release.resolve()
      await Promise.all([pending, closed])
    } finally { release.resolve(); await project.dispose(); await backing.dispose() }
  })

  it('recovers after an active request is cancelled and preserves existing readers', async () => {
    const root = await fixture()
    const native = await resolvePackagedNativeAnalysis()
    const factory = createProcessNativeAnalysisSessionFactory({ command: native.command })
    const started = Promise.withResolvers<void>()
    let pause = false
    let opens = 0
    const project = await openTypeScriptProject({ root, sessions: {
      async open(descriptor, options) {
        opens++
        const session = await factory.open(descriptor, options)
        return {
          request(request, requestOptions) {
            if (!pause) return session.request(request, requestOptions)
            pause = false
            started.resolve()
            return new Promise((_resolve, reject) => {
              requestOptions!.signal!.addEventListener('abort', () => reject(requestOptions!.signal!.reason), { once: true })
            })
          },
          acknowledge: session.acknowledge?.bind(session),
          dispose: () => session.dispose(),
        }
      },
    } })
    try {
      const initial = await project.refresh()
      const reader = await project.open(initial.generation)
      const before = await reader.facts.facts('source')
      const controller = new AbortController()
      pause = true
      const rejected = expect(project.refresh({ signal: controller.signal })).rejects.toThrow('superseded')
      await started.promise
      controller.abort(new Error('superseded'))
      await rejected
      expect(await reader.facts.facts('source')).toEqual(before)
      const recovered = await project.refresh()
      expect(recovered.generation).toEqual(initial.generation)
      expect(recovered.transactions).toEqual([])
      expect(opens).toBe(2)
      await reader.dispose()
    } finally { await project.dispose() }
  })
})
