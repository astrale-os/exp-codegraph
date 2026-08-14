import { readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  initializeModuleSpecification,
  compileSpecificationSnapshot,
  MINIMUM_MODULE_SPEC,
} from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('module specification initialization', () => {
  it('creates only the irreducible public declaration contract', async () => {
    const current = await fixture({})
    fixtures.push(current)
    const module = join(current.root, 'new-module')

    const api = await initializeModuleSpecification(module)
    const spec = await compileSpecificationSnapshot(current.root, join(module, '.spec'))

    expect(api).toBe(join(module, '.spec/api.d.ts'))
    expect(await readFile(api, 'utf8')).toBe(MINIMUM_MODULE_SPEC)
    expect(spec.format).toBe('astrale.typespec.specification')
    expect(spec.diagnostics).toEqual([])
    expect(spec).toMatchObject({
      capabilities: [],
      flows: [],
      laws: [],
      states: [],
      benchmarks: [],
      packages: [],
    })
  })

  it('never overwrites an existing public contract', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface Existing {}\n',
    })
    fixtures.push(current)

    await expect(initializeModuleSpecification(join(current.root, 'module'))).rejects.toThrow(
      'already exists',
    )
    expect(await readFile(join(current.root, 'module/.spec/api.d.ts'), 'utf8')).toBe(
      'export interface Existing {}\n',
    )
  })

  it('does not initialize through a symbolic specification directory', async () => {
    const external = await fixture({})
    const current = await fixture({})
    fixtures.push(external, current)
    await symlink(external.root, join(current.root, '.spec'))

    await expect(initializeModuleSpecification(current.root)).rejects.toThrow(
      'cannot be a symbolic link',
    )
    await expect(readFile(join(external.root, 'api.d.ts'), 'utf8')).rejects.toThrow()
  })
})
