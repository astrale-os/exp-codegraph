import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  compileSpecificationSnapshot,
  compileSpecificationSnapshots,
  type SpecificationCompilationPhase,
} from '../specification/index.ts'
import { specificationApiCompiler } from '../compiler/default.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('immutable normative specification snapshots', () => {
  /** @evidence SPECIFICATION-COMPILER-WORK-OBSERVABILITY */
  it('reports actual bounded compiler sessions and programs for a shared corpus wave', async () => {
    const current = await fixture({
      'left/.spec/api.d.ts': 'export interface Left { readonly value: string }\n',
      'right/.spec/api.d.ts': 'export interface Right { readonly value: number }\n',
    })
    fixtures.push(current)
    const phases: SpecificationCompilationPhase[] = []

    const snapshots = await compileSpecificationSnapshots(
      current.root,
      [join(current.root, 'left/.spec'), join(current.root, 'right/.spec')],
      {
        onPhase: (phase) => {
          phases.push(phase)
          throw new Error('diagnostic observer fixture')
        },
      },
    )

    expect(snapshots).toHaveLength(2)
    expect(phases.find(({ phase }) => phase === 'declarations')).toMatchObject({
      items: 2,
      programs: 1,
      sessions: 1,
      retries: 0,
      fallbacks: 0,
      workerPeakResidentBytes: expect.any(Number),
      workerResidentUpperBoundBytes: expect.any(Number),
    })
    expect(
      phases.find(({ phase }) => phase === 'declarations')?.workerResidentUpperBoundBytes,
    ).toBeGreaterThan(0)
    expect(
      phases.find(({ phase }) => phase === 'declarations')?.workerResidentUpperBoundBytes,
    ).toBe(
      phases.find(({ phase }) => phase === 'declarations')?.workerPeakResidentBytes,
    )
    expect(phases.find(({ phase }) => phase === 'typescript')).toMatchObject({
      items: 2,
      programs: 1,
      sessions: 1,
    })
  })

  it('compiles normative APIs with the authored V2 declaration surface', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export type ParameterValue = bigint | Uint8Array
export type SocketConstructor = new (url: string | URL) => WebSocket
`,
    })
    fixtures.push(current)

    const snapshot = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const model = snapshot.module.api?.model

    expect(snapshot.diagnostics).toEqual([])
    expect(model?.version).toBe(2)
    expect(
      model?.surface.declarations.find(({ name }) => name === 'ParameterValue')?.valueType,
    ).toMatchObject({
      kind: 'union',
      types: expect.arrayContaining([{ kind: 'primitive', name: 'bigint' }]),
    })
    expect(
      model?.surface.declarations.find(({ name }) => name === 'SocketConstructor')?.valueType,
    ).toMatchObject({ kind: 'constructor' })
  })

  it('separates authored meaning from test, layout, implementation, and presentation observations', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
      'module/.spec/laws/value.ts': `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const VALUE_PRESENT = defineLaw({
  id: 'VALUE-PRESENT',
  statement: 'The value remains present.',
  tests: [{ file: '__tests__/missing.test.ts', id: 'VALUE-PRESENT-EVIDENCE' }],
})
`,
      'module/.spec/layout.ts': `import { defineLayout } from '@astrale-os/codegraph/authoring'
export default defineLayout({
  entries: ['src/', 'src/missing.ts'],
  exact: true,
  ignore: ['src/generated/**'],
})
`,
      'module/.spec/architecture.md': '# Initial rationale\n',
      'module/src/extra.ts': 'export const extra = true\n',
    })
    fixtures.push(current)

    const directory = join(current.root, 'module/.spec')
    const snapshot = await compileSpecificationSnapshot(current.root, directory)

    expect(snapshot.format).toBe('astrale.typespec.specification')
    expect(snapshot.version).toBe(2)
    expect(snapshot.id).toMatch(/^specification:[a-f0-9]{64}$/u)
    expect(snapshot.diagnostics).toEqual([])
    expect(snapshot.module).not.toHaveProperty('binding')
    expect(snapshot).not.toHaveProperty('architecture')
    expect(snapshot).not.toHaveProperty('history')
    expect(snapshot).not.toHaveProperty('verificationRevision')
    expect(snapshot.layout).toMatchObject({
      exact: true,
      ignore: ['src/generated/**'],
      entries: [
        { path: 'src/', kind: 'directory' },
        { path: 'src/missing.ts', kind: 'file' },
      ],
    })
    expect(snapshot.layout).not.toHaveProperty('observation')
    expect(snapshot.laws[0]?.definitions[0]?.tests).toEqual([
      { file: '__tests__/missing.test.ts', id: 'VALUE-PRESENT-EVIDENCE' },
    ])
    expect(snapshot.laws[0]?.definitions[0]).not.toHaveProperty('testEvidence')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.laws[0]?.definitions[0])).toBe(true)
    expect(() => {
      ;(snapshot.module as { name: string }).name = 'changed'
    }).toThrow(TypeError)

    await current.write('module/.spec/architecture.md', '# Revised rationale only\n')
    const afterRationale = await compileSpecificationSnapshot(current.root, directory)
    expect(afterRationale.id).toBe(snapshot.id)
    expect(afterRationale.revision).toBe(snapshot.revision)
  })

  it('restores unchanged declaration results for a private resource delta', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { value: Missing }\n',
      'module/.spec/layout.ts':
        "import { defineLayout } from '@astrale-os/codegraph/authoring'\nexport default defineLayout(['owned.ts'])\n",
      'module/owned.ts': 'export {}\n',
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')
    const previous = await compileSpecificationSnapshots(current.root, [directory])
    await current.write(
      'module/.spec/layout.ts',
      "import { defineLayout } from '@astrale-os/codegraph/authoring'\nexport default defineLayout(['owned.ts', 'other.ts'])\n",
    )
    const compile = vi.spyOn(specificationApiCompiler, 'compile')

    const restored = await compileSpecificationSnapshots(current.root, [directory], {
      previous,
      changed: ['module/.spec/layout.ts'],
    })
    expect(compile).not.toHaveBeenCalled()

    const canonical = await compileSpecificationSnapshots(current.root, [directory])
    expect(compile).toHaveBeenCalled()
    expect(restored).toEqual(canonical)

    compile.mockClear()
    await current.write('module/.spec/api.d.ts', 'export interface API { revised: Missing }\n')
    await compileSpecificationSnapshots(current.root, [directory], {
      previous: canonical,
      changed: ['module/.spec/api.d.ts'],
    })
    expect(compile).toHaveBeenCalled()
    compile.mockRestore()
  })

  it('reuses shared authoring ASTs without changing standalone syntax diagnostics', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/laws/broken.ts':
        "import { defineLaw } from '@astrale-os/codegraph/authoring'\nexport const BROKEN = defineLaw({\n",
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')

    const canonical = await compileSpecificationSnapshot(current.root, directory)
    const [batched] = await compileSpecificationSnapshots(current.root, [directory])

    expect(batched).toEqual(canonical)
    expect(batched?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/^MODULE_TYPESCRIPT_/u) }),
      ]),
    )
  })

  it('accepts the imported authoring helper identity and rejects a same-spelled local function', async () => {
    const valid = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/laws/valid.ts': `import { defineLaw as law } from '@astrale-os/codegraph/authoring'
export const VALID_LAW = law({ id: 'VALID-LAW', statement: 'Imported identity.' })
`,
    })
    const collision = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/laws/collision.ts': `const defineLaw = (value: unknown) => value
export const COLLISION_LAW = defineLaw({ id: 'COLLISION-LAW', statement: 'Wrong identity.' })
`,
    })
    fixtures.push(valid, collision)

    expect(
      (await compileSpecificationSnapshot(valid.root, join(valid.root, 'module/.spec')))
        .diagnostics,
    ).toEqual([])
    expect(
      (
        await compileSpecificationSnapshot(
          collision.root,
          join(collision.root, 'module/.spec'),
        )
      ).diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(
      expect.arrayContaining([
        'MODULE_DESCRIPTOR_STATEMENT_INVALID',
        'MODULE_DESCRIPTOR_EXPORT_INVALID',
      ]),
    )
  })

  it('embeds package-root dependency intent in every nested semantic module snapshot', async () => {
    const current = await fixture({
      'package/package.json': JSON.stringify({ name: '@fixture/package', dependencies: { zod: '1.0.0' } }),
      'package/.spec/api.d.ts': 'export interface PackageAPI {}\n',
      'package/.spec/packages/zod.ts': `import { definePackage } from '@astrale-os/codegraph/authoring'
export default definePackage({ package: 'zod', purpose: 'Validates package input.' })
`,
      'package/child/.spec/api.d.ts': 'export interface ChildAPI {}\n',
    })
    fixtures.push(current)

    const snapshot = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'package/child/.spec'),
    )
    expect(snapshot.packages).toEqual([])
    expect(snapshot.module.packages).toEqual(['zod'])
    expect(snapshot.module.packageAuthority).toMatchObject({
      source: 'package/.spec/api.d.ts',
      packages: [{ package: 'zod', purpose: 'Validates package input.' }],
      packagePatterns: [],
    })
    expect(Object.isFrozen(snapshot.module.packageAuthority.packages)).toBe(true)

    const before = snapshot.id
    await current.write(
      'package/.spec/packages/zod.ts',
      `import { definePackage } from '@astrale-os/codegraph/authoring'
export default definePackage({ package: 'zod', purpose: 'Revised package intent.' })
`,
    )
    expect(
      (
        await compileSpecificationSnapshot(
          current.root,
          join(current.root, 'package/child/.spec'),
        )
      ).id,
    ).not.toBe(before)
  })
})
