import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function qualifyResidentProject(typescript, root) {
  await mkdir(root)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { noLib: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'],
  }))
  await writeFile(join(root, 'helper.ts'), "export function first() { return 'first' }\nexport function second() { return 'second' }\n")
  await writeFile(join(root, 'barrel.ts'), "export { first as invoke } from './helper.js'\n")
  const consumer = "import { invoke } from './barrel.js'; export function value() { return invoke() }\n"
  await writeFile(join(root, 'index.ts'), consumer)
  const options = { root, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body', 'typescript.structure'] }
  const project = await typescript.openTypeScriptProject(options)
  const input = { path: 'index.ts', offset: consumer.indexOf('invoke()') }
  const inspect = async (read, position) => {
    const structure = await read.structure()
    return {
      navigation: await structure.symbolAt(position),
      dependencies: await structure.dependencies({ paths: [position.path] }),
    }
  }
  const resolvedValue = async (snapshot) => {
    const calls = await snapshot.calls({ paths: ['index.ts'] })
    assert.equal(calls.sites.length, 1)
    return (await snapshot.values()).value(calls.sites[0].occurrence.id).resolve()
  }
  try {
    const initial = await project.refresh()
    assert.equal(initial.transactions.length, 1)
    const before = await project.open(initial.generation)
    try {
      const original = await before.facts.facts('source')
      const values = await before.values()
      assert.equal(await before.values(), values)
      const originalNavigation = await before.compute(inspect, input)
      assert.equal(originalNavigation.navigation.target.kind, 'resolved')
      assert.equal(originalNavigation.navigation.symbols[0].name, 'first')
      assert.equal(originalNavigation.navigation.symbols[0].declarations[0].path, 'helper.ts')
      assert.deepEqual(originalNavigation.dependencies.dependencies.map(({ targetPath }) => targetPath), ['barrel.ts'])
      const originalValue = await resolvedValue(before)
      assert.equal(originalValue.kind, 'known')
      assert.deepEqual(originalValue.value, { kind: 'literal', value: 'first' })

      // The importing file stays byte-identical while a re-export changes both
      // canonical identity and runtime value. All installed hosts must follow it.
      await writeFile(join(root, 'barrel.ts'), "export { second as invoke } from './helper.js'\n")
      const edited = await project.refresh({ changed: ['barrel.ts'] })
      assert.notEqual(edited.generation.id, initial.generation.id)
      assert.equal((await project.refresh()).generation.id, edited.generation.id)
      assert.deepEqual((await project.refresh()).transactions, [])
      assert.deepEqual(await before.facts.facts('source'), original)
      assert.deepEqual(await before.compute(inspect, input), originalNavigation)
      assert.deepEqual(await resolvedValue(before), originalValue)

      const after = await project.open(edited.generation)
      try {
        const currentNavigation = await after.compute(inspect, input)
        assert.equal(currentNavigation.navigation.target.kind, 'resolved')
        assert.equal(currentNavigation.navigation.symbols[0].name, 'second')
        const currentValue = await resolvedValue(after)
        assert.equal(currentValue.kind, 'known')
        assert.deepEqual(currentValue.value, { kind: 'literal', value: 'second' })
        assert.equal(await readFile(join(root, 'index.ts'), 'utf8'), consumer)
        const cold = await typescript.openTypeScriptProject(options)
        try {
          assert.equal((await cold.refresh()).generation.id, edited.generation.id)
          const fresh = await cold.open()
          try {
            assert.deepEqual(await fresh.compute(inspect, input), currentNavigation)
            assert.deepEqual(await resolvedValue(fresh), currentValue)
          } finally { await fresh.dispose() }
        } finally { await cold.dispose() }
      } finally { await after.dispose() }
    } finally { await before.dispose() }
  } finally { await project.dispose() }
  return { structuralIdentity: true, values: ['first', 'second'], retainedSnapshot: true, freshParity: true }
}

