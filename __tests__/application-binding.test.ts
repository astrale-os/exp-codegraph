import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compileApplicationModuleBindings,
} from '../compiler/index.ts'
import { compileApplicationModuleBindingsIsolated } from '../compiler/application-binding-process.optimization.ts'
import type { ApplicationModuleBindingRequest } from '../analysis/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('explicit application module binding', () => {
  it('proves exact exports and TypeScript assignability without declaration graph extraction', async () => {
    const root = await fixture(
      `
export interface User { readonly id: string }
export declare function load(id: string): Promise<User>
export declare const VERSION: 'v1'
`,
      `
import type { User } from './.spec/api.js'
export type { User } from './.spec/api.js'
export async function load(id: string): Promise<User> { return { id } }
export const VERSION = 'v1' as const
`,
      true,
    )

    const compilation = compileApplicationModuleBindings({ root, requests: [request()] })

    expect(compilation.programs).toBe(1)
    expect(compilation.facts).toHaveLength(1)
    expect(compilation.facts[0]?.diagnostics).toEqual([])
    expect(compilation.facts[0]?.exports.map((entry) => [entry.path.join('.'), entry.status])).toEqual([
      ['User', 'pass'],
      ['VERSION', 'pass'],
      ['load', 'pass'],
    ])
  })

  it('reports missing, undeclared, namespace, and assignability drift explicitly', async () => {
    const root = await fixture(
      `
export interface User { readonly id: string }
export declare function load(id: string): User
export declare const VERSION: 'v1'
`,
      `
export type User = { readonly id: number }
export const load = 42
export const EXTRA = true
`,
    )

    const fact = compileApplicationModuleBindings({ root, requests: [request()] }).facts[0]!

    expect(fact.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'MODULE_EXPORT_MISSING',
      'MODULE_EXPORT_UNDECLARED',
      'MODULE_VALUE_BINDING_MISSING',
      'MODULE_EXPORT_TYPE_BINDING_MISSING',
    ])
    expect(fact.exports.map((entry) => [entry.path.join('.'), entry.status])).toEqual([
      ['EXTRA', 'undeclared'],
      ['User', 'incompatible'],
      ['VERSION', 'missing'],
      ['load', 'incompatible'],
    ])
  })

  it('isolates compatible compiler projects and reports their peak residency', async () => {
    const root = await fixture(
      `export declare const version: 'v1'`,
      `export const version = 'v1' as const`,
      true,
    )

    const compilation = await compileApplicationModuleBindingsIsolated({
      root,
      requests: [request()],
    })

    expect(compilation.facts[0]?.diagnostics).toEqual([])
    expect(compilation.workerPeakResidentBytes).toBeGreaterThan(0)
    expect(compilation.workerResidentUpperBoundBytes).toBe(
      compilation.workerPeakResidentBytes,
    )
  })
})

function request(): ApplicationModuleBindingRequest {
  return {
    specification: 'specification:fixture',
    source: 'module/.spec/api.d.ts',
    target: {
      id: 'fixture',
      name: 'fixture',
      project: 'tsconfig.json',
      root: 'module',
      entrypoint: 'module/index.ts',
      facades: [],
      aliases: [],
      internals: [],
    },
  }
}

async function fixture(
  contract: string,
  implementation: string,
  bind = false,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-binding-'))
  roots.push(root)
  await mkdir(join(root, 'module', '.spec'), { recursive: true })
  await Promise.all([
    writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true } }),
      'utf8',
    ),
    writeFile(join(root, 'module', '.spec', 'api.d.ts'), contract, 'utf8'),
    writeFile(join(root, 'module', 'index.ts'), implementation, 'utf8'),
    ...(bind
      ? [
          writeFile(
            join(root, 'module', 'implementation.contract.ts'),
            `import type * as contract from './.spec/api.js'\nimport * as implementation from './index.js'\nimplementation satisfies typeof contract\n`,
            'utf8',
          ),
        ]
      : []),
  ])
  return root
}
