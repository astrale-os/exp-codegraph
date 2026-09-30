import { mkdtemp, mkdir, writeFile, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createMemoryAnalysisStore, createProcessNativeAnalysisSessionFactory, type AnalysisStore } from '../analysis/index.ts'
import { createTypeScriptAnalysisService, openTypeScriptProject, resolvePackagedNativeAnalysis } from '../analysis/typescript/index.ts'

/** @evidence TYPESCRIPT-COMPILER-INPUT-DISCOVERY */
it('discovers compiler-owned dependencies and failed resolutions without source hints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-discovery-'))
  const write = (path: string, source: string) => writeFile(join(root, path), source)
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }, files: ['index.ts'] }))
  await write('index.ts', "import { helper } from './aux/helper'; export const value = helper()\n")
  await mkdir(join(root, 'aux'))
  await write('aux/helper.ts', "export const helper = () => 'first'\n")
  const project = await openTypeScriptProject({ root, binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY })
  const refresh = async () => {
    const update = await project.refresh({ discover: true })
    const cold = await openTypeScriptProject({ root, binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY })
    try {
      const fresh = await cold.refresh()
      expect(update.generation.id).toBe(fresh.generation.id)
      const [resident, independent] = await Promise.all([project.open(update.generation), cold.open(fresh.generation)])
      try {
        expect(await resident.facts.facts('source')).toEqual(await independent.facts.facts('source'))
        expect(await resident.facts.facts('body')).toEqual(await independent.facts.facts('body'))
      } finally { await resident.dispose(); await independent.dispose() }
    } finally { await cold.dispose() }
    return update
  }
  try {
    let current = await refresh()
    const pinned = await project.open(current.generation)
    try {
      const original = await pinned.facts.facts('source')
      const previous = await stat(join(root, 'aux/helper.ts'))
      await write('aux/helper.ts', "export const helper = () => 'other'\n")
      await utimes(join(root, 'aux/helper.ts'), previous.atime, previous.mtime)
      let next = await refresh()
      expect(next.generation.id).not.toBe(current.generation.id)
      expect(await pinned.facts.facts('source')).toEqual(original)
      current = next
      await rm(join(root, 'aux/helper.ts'))
      next = await refresh()
      expect(next.generation.id).not.toBe(current.generation.id)
      current = next
      await write('aux/helper.ts', "export const helper = () => 'again'\n")
      next = await refresh()
      expect(next.generation.id).not.toBe(current.generation.id)
      current = next
      await write('index.ts', "import { helper } from './missing/deep/helper'; export const value = helper()\n")
      next = await refresh()
      expect(next.generation.id).not.toBe(current.generation.id)
      current = next
      await mkdir(join(root, 'missing/deep'), { recursive: true })
      await write('missing/deep/helper.ts', "export const helper = () => 'restored'\n")
      next = await refresh()
      expect(next.generation.id).not.toBe(current.generation.id)
      current = next
      await write('tsconfig.json', '{ invalid configuration')
      await expect(refresh()).rejects.toThrow()
      expect(await pinned.facts.facts('source')).toEqual(original)
      await write('tsconfig.json', JSON.stringify({ compilerOptions: { noLib: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }, files: ['index.ts'] }))
      expect((await refresh()).generation.id).toBe(current.generation.id)
      expect((await refresh()).transactions).toEqual([])
    } finally { await pinned.dispose() }
  } finally { await project.dispose(); await rm(root, { recursive: true, force: true }) }
})


/** @evidence TYPESCRIPT-DISCOVERY-REPLAY */
it('reconciles an unpublished replay before returning discovered compiler inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-discovery-replay-'))
  const backing = createMemoryAnalysisStore()
  let rejectCommit = false
  const store: AnalysisStore = {
    current: backing.current.bind(backing), open: backing.open.bind(backing),
    async commit(transaction, options) {
      if (rejectCommit) { rejectCommit = false; throw new Error('publication interrupted') }
      return backing.commit(transaction, options)
    },
    dispose: backing.dispose.bind(backing),
  }
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true }, files: ['index.ts'] }))
  await writeFile(join(root, 'index.ts'), "import { helper } from './helper'; export const value = helper()")
  await writeFile(join(root, 'helper.ts'), "export const helper = () => 'first'")
  const service = await createTypeScriptAnalysisService({ project: { root, config: 'tsconfig.json', capabilities: ['typescript.source', 'typescript.body'] }, store,
    sessions: createProcessNativeAnalysisSessionFactory({ command: (await resolvePackagedNativeAnalysis(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {})).command }) })
  try {
    const initial = await service.refresh({ discover: true })
    const pinned = await backing.open(initial.generation.universe, initial.generation.id)
    try {
      const old = await pinned.facts()
      rejectCommit = true
      await writeFile(join(root, 'helper.ts'), "export const helper = () => 'second'")
      await expect(service.refresh({ discover: true })).rejects.toThrow('publication interrupted')
      await writeFile(join(root, 'helper.ts'), "export const helper = () => 'third'")
      const recovered = await service.refresh({ discover: true })
      const fresh = await openTypeScriptProject({ root, binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY, capabilities: ['typescript.source', 'typescript.body'] })
      try { expect(recovered.generation.id).toBe((await fresh.refresh()).generation.id) }
      finally { await fresh.dispose() }
      expect(await pinned.facts()).toEqual(old)
      expect((await service.refresh({ discover: true })).transaction).toBeUndefined()
    } finally { await pinned.dispose() }
  } finally { await service.dispose(); await backing.dispose(); await rm(root, { recursive: true, force: true }) }
})
