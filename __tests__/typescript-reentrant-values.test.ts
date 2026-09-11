import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openTypeScriptProject, type SymbolicCallModel, type TypeScriptProject } from '../analysis/typescript/index.ts'

it('keeps each snapshot correct when a call model reenters an older evaluator before publishing its proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-reentrant-values-'))
  let project: TypeScriptProject | undefined
  try {
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] })),
      writeFile(join(root, 'helper.ts'), "export function value() { return 'old' }\n"),
      writeFile(join(root, 'index.ts'), "import { value } from './helper'; declare function record(value: string): unknown; export const result = record(value())\n"),
    ])
    project = await openTypeScriptProject({ root,
      ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    })
    await project.refresh()
    const previous = await project.open()
    const oldCalls = await previous.calls({ paths: ['index.ts'] })
    expect(oldCalls.sites).toHaveLength(2)
    const record = oldCalls.sites.find(({ call }) => call.arguments.length === 1)!
    const helper = oldCalls.sites.find(({ call }) => call.arguments.length === 0)!
    const oldGeneric = await previous.values()
    const nested: Promise<unknown>[] = []
    const model: SymbolicCallModel<string> = (context) => {
      if (context.call.arguments.length !== 1) return undefined
      const argument = context.argument(0)!.resolve()
      if (argument.kind !== 'known' || argument.value.kind !== 'literal' || typeof argument.value.value !== 'string') {
        return { kind: 'unknown', reason: 'The recorded argument must be a proved string.' }
      }
      // evaluate resolves synchronously before returning its promise. This nested
      // read belongs to the old pin; the outer argument belongs to its own pin.
      nested.push(oldGeneric.evaluate(helper.call.occurrence))
      return { kind: 'atom', value: argument.value.value }
    }
    const oldModeled = await previous.values({ call: model })

    await writeFile(join(root, 'helper.ts'), "export function value() { return 'new' }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const current = await project.open()
    const currentCalls = await current.calls({ paths: ['index.ts'] })
    expect(currentCalls.sites.find(({ call }) => call.arguments.length === 1)!.call.occurrence).toBe(record.call.occurrence)
    const newModeled = await current.values({ call: model })
    const recent = await newModeled.value(record.call.occurrence).resolve()
    expect(recent).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'new' } })
    expect(oldModeled.canReuse(recent)).toBe(false)
    expect(await oldModeled.value(record.call.occurrence).resolve()).toMatchObject({
      kind: 'known', value: { kind: 'atom', value: 'old' },
    })
    for (const result of await Promise.all(nested)) expect(result).toMatchObject({ kind: 'known', value: 'old' })
    expect(await newModeled.value(record.call.occurrence).resolve()).toMatchObject({
      kind: 'known', value: { kind: 'atom', value: 'new' },
    })
  } finally {
    await project?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
