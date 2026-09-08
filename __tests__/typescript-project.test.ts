import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProcessNativeAnalysisSessionFactory, createMemoryAnalysisStore, type AnalysisStore } from '../analysis/index.ts'
import { openTypeScriptProject as openProject, resolvePackagedNativeAnalysis as resolvePackaged, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/index.ts'

// Source regressions run against the just-built candidate. Default package resolution
// is qualified independently after all target artifacts have been assembled and packed.
const candidate = process.env.CODEGRAPH_TEST_NATIVE_BINARY
const resolvePackagedNativeAnalysis = () => resolvePackaged(candidate ? { binary: candidate } : {})
const openTypeScriptProject: typeof openProject = (options) => openProject({
  ...options,
  ...(candidate && !options.sessions ? { binary: candidate } : {}),
})

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

  it('keeps the committed generation after semantic budget rejection and repairs with exact fresh identities', async () => {
    const root = await fixture()
    const native = await resolvePackagedNativeAnalysis()
    const store = createMemoryAnalysisStore()
    const project = await openTypeScriptProject({ root, store, sessions: createProcessNativeAnalysisSessionFactory({
      command: native.command, maximumTransactionBytes: 64 * 1024,
      payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS,
    }) })
    try {
      const initial = await project.refresh()
      const pinned = await project.open(initial.generation)
      try {
        const original = await pinned.facts.facts('body')
        // Escaped semantic JSON exceeds admission even though its canonical
        // spelling and physical string table are substantially smaller.
        await writeFile(join(root, 'index.ts'), `export function value() { return '${'<&>'.repeat(10_000)}' }\n`)
        await expect(project.refresh({ changed: ['index.ts'] })).rejects.toThrow('semantic fact payloads exceed')
        expect(await store.current(initial.generation.universe)).toEqual(initial.generation)
        expect(await pinned.facts.facts('body')).toEqual(original)
        await writeFile(join(root, 'index.ts'), "export function value() { return 'repaired' }\n")
        const repaired = await project.refresh({ changed: ['index.ts'] })
        expect(repaired.generation.id).not.toBe(initial.generation.id)
        const fresh = await openTypeScriptProject({ root })
        try { expect((await fresh.refresh()).generation.id).toBe(repaired.generation.id) }
        finally { await fresh.dispose() }
        expect(await pinned.facts.facts('body')).toEqual(original)
        expect((await project.refresh()).transactions).toEqual([])
      } finally { await pinned.dispose() }
    } finally { await project.dispose(); await store.dispose() }
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

  it('bounds owned universe retention through repeated configuration edits and keeps the current and explicit readers pinned', async () => {
    const root = await fixture()
    const project = await openTypeScriptProject({ root })
    try {
      const initial = await project.refresh()
      const pinned = await project.open(initial.generation)
      const generations = [initial.generation]
      for (let index = 0; index < 5; index++) {
        await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', maxNodeModuleJsDepth: index + 1 }, include: ['*.ts'] }))
        generations.push((await project.refresh({ changed: ['tsconfig.json'] })).generation)
      }
      expect(new Set(generations.map((generation) => generation.universe)).size).toBe(6)
      expect((await pinned.facts.facts('source')).facts).toHaveLength(1)
      await expect(project.open(generations[1]!)).rejects.toThrow('universe')
      const current = await project.open()
      expect(current.generation).toEqual(generations.at(-1))
      await current.dispose()
      await pinned.dispose()
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', maxNodeModuleJsDepth: 6 }, include: ['*.ts'] }))
      const next = await project.refresh({ changed: ['tsconfig.json'] })
      await expect(project.open(initial.generation)).rejects.toThrow('universe')
      const retained = await project.open(next.generation)
      expect((await retained.facts.facts('source')).facts).toHaveLength(1)
      await retained.dispose()
      // Reverting to an evicted universe recovers from a complete native snapshot.
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022' }, include: ['*.ts'] }))
      const restored = await project.refresh({ changed: ['tsconfig.json'] })
      expect(restored.generation.universe).toBe(initial.generation.universe)
      const rebuilt = await project.open()
      expect((await rebuilt.facts.facts('source')).facts).toHaveLength(1)
      await rebuilt.dispose()
      const cold = await openTypeScriptProject({ root })
      try { expect(restored.generation.id).toBe((await cold.refresh()).generation.id) }
      finally { await cold.dispose() }
      expect((await project.refresh()).transactions).toEqual([])
    } finally { await project.dispose() }
  })

  it.each([
    ['direct alias', 'export const factory: () => string = first;', "import { factory } from './helper.js'; export const result = factory();"],
    ['alias chain', 'const middle: () => string = first; export const factory: () => string = middle;', "import { factory } from './helper.js'; export const result = factory();"],
    ['namespace', 'export const factory: () => string = first;', "import * as helpers from './helper.js'; export const result = helpers.factory();"],
    ['declared namespace', 'export namespace helpers { export const factory: () => string = first; }', "import { helpers } from './helper.js'; export const result = helpers.factory();"],
    ['annotated object member', 'export const api: {fn:()=>string} = {fn:first};', "import { api } from './helper.js'; export const result = api.fn();"],
    ['callback argument', 'export const factory: () => string = first;', "import { factory } from './helper.js'; declare function consume(value:()=>string):void; consume(factory);"],
  ])('revalidates runtime callable reads hidden by unchanged declaration emit: %s', async (variant, definition, caller) => {
    const root = await fixture()
    const helper = `import { first } from './first.js'; import { second } from './second.js'; ${definition}\n`
    await Promise.all([
      writeFile(join(root, 'first.ts'), "export function first(): string { return 'first' }\n"),
      writeFile(join(root, 'second.ts'), "export function second(): string { return 'second' }\n"),
      writeFile(join(root, 'helper.ts'), helper),
      writeFile(join(root, 'index.ts'), caller!),
    ])
    const options = { root, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] as const }
    const project = await openTypeScriptProject(options)
    try {
      const initial = await project.refresh()
      const pinned = await project.open(initial.generation)
      try {
        const original = (await pinned.calls({ paths: ['index.ts'] })).sites
        expect(original).toHaveLength(1)
        await writeFile(join(root, 'helper.ts'), helper.replace('= first', '= second').replace('fn:first', 'fn:second'))
        const changed = await project.refresh({ changed: ['helper.ts'] })
        const snapshot = await project.open()
        try {
          const sites = (await snapshot.calls({ paths: ['index.ts'] })).sites
          expect(sites).toHaveLength(1)
          if (variant === 'callback argument') {
            expect(sites[0]!.call.callbacks).not.toEqual(original[0]!.call.callbacks)
          } else {
            const values = await snapshot.values()
            expect(await values.value(sites[0]!.occurrence.id).resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'second' } })
            if (variant !== 'annotated object member') expect(sites[0]!.call.target).not.toBe(original[0]!.call.target)
          }
          const cold = await openTypeScriptProject(options)
          try { expect((await cold.refresh()).generation.id).toBe(changed.generation.id) }
          finally { await cold.dispose() }
          expect((await pinned.calls({ paths: ['index.ts'] })).sites).toEqual(original)
        } finally { await snapshot.dispose() }
      } finally { await pinned.dispose() }
    } finally { await project.dispose() }
  })

  // These lifecycle scenarios repeatedly compare resident edits with independent
  // cold compilers. Their timeout bounds qualification, not native request latency.
  it('updates unchanged callable proofs, avoids private body fanout and removes vanished expression reads', async () => {
    const root = await fixture()
    const declarations = "export function first(): string { return 'first' }\nexport function second(): string { return 'second' }\n"
    const alias = (target: string) => `import { first, second } from './functions.js'; export const alias: () => string = ${target};\n`
    const choose = (target: string) => `import { alias as left } from './left.js'; import { alias as right } from './right.js'; export const factory: () => string = ${target};\n`
    const caller = "import { factory } from './helper.js'; export const result = factory();\n"
    await Promise.all([
      writeFile(join(root, 'functions.ts'), declarations),
      writeFile(join(root, 'left.ts'), alias('first')),
      writeFile(join(root, 'right.ts'), alias('first')),
      writeFile(join(root, 'helper.ts'), choose('left')),
      writeFile(join(root, 'index.ts'), caller),
    ])
    const events: import('../analysis/profiling/index.ts').AnalysisTelemetryEvent[] = []
    const native = await resolvePackagedNativeAnalysis()
    const options = { root, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] as const }
    const project = await openTypeScriptProject({ ...options, sessions: createProcessNativeAnalysisSessionFactory({ command: native.command, telemetry: (event) => events.push(event) }) })
    const metrics = (phase: string) => events.find((event) => event.component === 'native' && event.phase === phase)?.metrics
    const edit = async (file: string, text: string) => {
      events.length = 0
      await writeFile(join(root, file), text)
      const update = await project.refresh({ changed: [file] })
      const cold = await openTypeScriptProject(options)
      try { expect((await cold.refresh()).generation.id).toBe(update.generation.id) }
      finally { await cold.dispose() }
      return update
    }
    try {
      await project.refresh()
      await edit('functions.ts', declarations.replace("return 'first'", "return 'private body edit'"))
      expect(metrics('compiler.callable-reads')).toMatchObject({ invalidatedOwners: 0 })
      expect(metrics('projection.source-inventory')).toMatchObject({ hashedSources: 1 })
      // Same target, different dependency path: right.ts must become a read.
      await edit('helper.ts', choose('right'))
      expect(metrics('compiler.callable-reads')).toMatchObject({ invalidatedOwners: 0 })
      expect(metrics('projection.source-inventory')).toMatchObject({ hashedSources: 1 })
      await edit('right.ts', alias('second'))
      expect(metrics('compiler.callable-reads')).toMatchObject({ invalidatedOwners: 1 })
      expect(metrics('projection.source-inventory')).toMatchObject({ hashedSources: 2 })
      // A missing target and repair remain exact even with the same annotation.
      await edit('right.ts', alias('missing'))
      await edit('right.ts', alias('second'))
      // Replacing the owning source clears its old positional observations.
      await edit('index.ts', 'export const result: string = "removed";\n')
      await edit('right.ts', alias('first'))
      expect(metrics('compiler.callable-reads')).toBeUndefined()
      await edit('index.ts', caller)
      await edit('right.ts', alias('second'))
      expect(metrics('compiler.callable-reads')).toMatchObject({ invalidatedOwners: 1 })
      // A source disappearing and returning rebuilds the read index with the
      // committed generation; no stale positional or reverse reads survive.
      await rm(join(root, 'right.ts'))
      const removed = await project.refresh({ changes: [{ path: 'right.ts', kind: 'unlink' }] })
      const coldWithoutRight = await openTypeScriptProject(options)
      try { expect((await coldWithoutRight.refresh()).generation.id).toBe(removed.generation.id) }
      finally { await coldWithoutRight.dispose() }
      await writeFile(join(root, 'right.ts'), alias('first'))
      const restored = await project.refresh({ changes: [{ path: 'right.ts', kind: 'add' }] })
      const coldWithRight = await openTypeScriptProject(options)
      try { expect((await coldWithRight.refresh()).generation.id).toBe(restored.generation.id) }
      finally { await coldWithRight.dispose() }
      await edit('right.ts', alias('second'))
      expect(metrics('compiler.callable-reads')).toMatchObject({ invalidatedOwners: 1 })
    } finally { await project.dispose() }
  }, 30_000)

  it('keeps source membership within one universe and refreshes negative resolutions without renaming existing symbols', async () => {
    const root = await fixture()
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true }, include: ['*.ts'] }))
    await writeFile(join(root, 'index.ts'), `import { helper } from './helper.js'
export function stable() { return 42 }
export function value() { return helper() }
`)
    const options = { root, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body', 'typescript.diagnostic'] as const }
    const project = await openTypeScriptProject(options)
    try {
      const initial = await project.refresh()
      const pinned = await project.open(initial.generation)
      const originalSymbols = (await pinned.facts.facts('symbol')).facts
      const stable = originalSymbols.find((fact) => fact.payload.name === 'stable')!.payload.symbol
      const missing = (await pinned.facts.facts('diagnostic')).facts.filter((fact) => String(fact.payload.code) === '2307')
      expect(missing).toHaveLength(1)
      const inspect = async (count: number, unresolved: boolean) => {
        const snapshot = await project.open()
        try {
          expect((await snapshot.facts.facts('source')).facts).toHaveLength(count)
          expect((await snapshot.facts.facts('symbol')).facts.find((fact) => fact.payload.name === 'stable')!.payload.symbol).toBe(stable)
          expect((await snapshot.facts.facts('diagnostic')).facts.some((fact) => String(fact.payload.code) === '2307')).toBe(unresolved)
        } finally { await snapshot.dispose() }
      }
      const freshParity = async (id: string) => {
        const cold = await openTypeScriptProject(options)
        try { expect((await cold.refresh()).generation.id).toBe(id) }
        finally { await cold.dispose() }
      }
      await writeFile(join(root, 'helper.ts'), "export function helper() { return 'resolved' }\n")
      const added = await project.refresh({ changed: ['helper.ts'] })
      expect(added.generation.universe).toBe(initial.generation.universe)
      expect(added.generation.sequence).toBeGreaterThan(initial.generation.sequence)
      expect(added.generation.sourceManifest).not.toBe(initial.generation.sourceManifest)
      await inspect(2, false)
      await freshParity(added.generation.id)
      expect((await pinned.facts.facts('symbol')).facts).toEqual(originalSymbols)
      expect((await pinned.facts.facts('diagnostic')).facts.filter((fact) => String(fact.payload.code) === '2307')).toEqual(missing)
      await writeFile(join(root, 'unrelated.ts'), 'export const unrelated = true\n')
      const unrelated = await project.refresh({ changed: ['unrelated.ts'] })
      expect(unrelated.generation.universe).toBe(initial.generation.universe)
      await inspect(3, false)
      await freshParity(unrelated.generation.id)
      await rm(join(root, 'helper.ts'))
      const removed = await project.refresh({ changed: ['helper.ts'] })
      expect(removed.generation.universe).toBe(initial.generation.universe)
      await inspect(2, true)
      await freshParity(removed.generation.id)
      await rm(join(root, 'unrelated.ts'))
      const repaired = await project.refresh({ changed: ['unrelated.ts'] })
      expect(repaired.generation.id).toBe(initial.generation.id)
      await inspect(1, true)
      await freshParity(repaired.generation.id)
      await pinned.dispose()
    } finally { await project.dispose() }
  }, 30_000)

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
