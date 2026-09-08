import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openTypeScriptProject, type SymbolicCallModel, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'

it('reuses thousands of real demands while invalidating changed shared helper proofs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-demand-reuse-'))
  const count = 4096
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true }, include: ['*.ts'] }))
  await writeFile(join(root, 'helper.ts'), 'export function label(value: string): string { return value }\n')
  await writeFile(join(root, 'unrelated.ts'), "export const other = 'initial'\n")
  const library = join(root, 'node_modules/@fixture/demands')
  await mkdir(library, { recursive: true })
  await writeFile(join(library, 'package.json'), JSON.stringify({ name: '@fixture/demands', types: 'index.d.ts' }))
  await writeFile(join(library, 'index.d.ts'), 'export declare function emitValue(value: string): unknown\n')
  await writeFile(join(root, 'demands.ts'), [
    "import { label } from './helper'",
    "import { emitValue } from '@fixture/demands'",
    ...Array.from({ length: count }, (_, index) => `export const demand${index} = emitValue(label('value${index}'))`),
  ].join('\n'))
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.project', 'typescript.source', 'typescript.symbol', 'typescript.body'],
  })
  try {
    await project.refresh()
    const first = await project.open()
    let executions = 0
    const model: SymbolicCallModel<string> = context => {
      if (context.call.targetOrigin?.package !== '@fixture/demands') return
      const callee = context.callee().resolve()
      if (callee.kind !== 'known' || callee.value.kind !== 'external' || callee.value.symbolOrigin?.package !== '@fixture/demands') return
      executions++
      const argument = context.argument(0)!.resolve()
      return argument.kind === 'known' && argument.value.kind === 'literal' && typeof argument.value.value === 'string'
        ? { kind: 'atom', value: argument.value.value }
        : { kind: 'unknown', reason: 'The modeled argument is unresolved.' }
    }
    const resolve = async (snapshot: TypeScriptProjectSnapshot, expected?: string) => {
      const calls = await snapshot.calls({ paths: ['demands.ts'] })
      const demands = calls.sites.filter(({ call }) => call.targetOrigin?.package === '@fixture/demands')
      expect(demands).toHaveLength(count)
      const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
      for (const [index, { call }] of demands.entries()) {
        const result = await values.value(call.occurrence).resolve()
        expect(result).toMatchObject({ kind: 'known', value: { kind: 'atom', value: expected ?? `value${index}` } })
      }
      return { values, first: demands[0]!.call.occurrence }
    }
    const { values, first: occurrence } = await resolve(first)
    expect(executions).toBe(count)
    // New plan objects and a different reader still consume the same project-owned proofs.
    await first.dispose()
    const warm = await project.open()
    await resolve(warm)
    expect(executions).toBe(count)
    await warm.dispose()
    await writeFile(join(root, 'unrelated.ts'), "export const other = 'independent'\n")
    await project.refresh({ changed: ['unrelated.ts'] })
    const added = await project.open()
    await resolve(added)
    expect(executions).toBe(count)
    await added.dispose()
    await writeFile(join(root, 'helper.ts'), "export function label(value: string): string { return 'changed' }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const changed = await project.open()
    await resolve(changed, 'changed')
    expect(executions).toBe(count * 2)
    await changed.dispose()
    // Root membership changes preserve independent symbols and their demanded proofs.
    await writeFile(join(root, 'added.ts'), 'export const added = true\n')
    await project.refresh({ changed: ['added.ts'] })
    const created = await project.open()
    await resolve(created, 'changed')
    expect(executions).toBe(count * 2)
    await created.dispose()
    await rm(join(root, 'added.ts'))
    await project.refresh({ changed: ['added.ts'] })
    const removed = await project.open()
    await resolve(removed, 'changed')
    expect(executions).toBe(count * 2)
    await removed.dispose()
    // Retained evaluators still represent their old immutable input after newer revisions.
    expect(await values.value(occurrence).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'value0' } })
    expect(await values.value(occurrence).resolve({ limits: { maximumSteps: 1 } })).toMatchObject({ kind: 'unknown' })
    await expect(values.value(occurrence).resolve({ signal: AbortSignal.abort(new Error('stop cached demand')) })).rejects.toThrow('stop cached demand')
  } finally { await project.dispose(); await rm(root, { recursive: true, force: true }) }
}, 60_000)
