import { realpath, symlink } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  TypeSpecApplicationRefreshOptions,
  TypeSpecApplicationSnapshot,
} from '../application/index.ts'

import {
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../application/discovery/index.ts'
import { createTypeSpecApplicationService } from '../application/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
})

describe('V2 application discovery and selection', () => {
  it('discovers only convention anchors in deterministic source order', async () => {
    const current = await fixture({
      'zeta/.spec/api.d.ts': 'export interface Zeta {}\n',
      'alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
      'product/artifacts/.spec/api.d.ts': 'export interface ProductArtifacts {}\n',
      'node_modules/hidden/.spec/api.d.ts': 'export interface Hidden {}\n',
      'dist/generated/.spec/api.d.ts': 'export interface Generated {}\n',
      '__tests__/fixture/.spec/api.d.ts': 'export interface FixtureOnly {}\n',
      '.scratch/.spec/api.d.ts': 'export interface ScratchOnly {}\n',
      '.history/archived/.spec/api.d.ts': 'export interface Archived {}\n',
      'qualification/evidence/archive/.spec/api.d.ts': 'export interface Evidence {}\n',
      'evidence/artifacts/run/.spec/api.d.ts': 'export interface GeneratedEvidence {}\n',
      'benchmark/artifacts/run/.spec/api.d.ts': 'export interface Benchmark {}\n',
    })
    fixtures.push(current)

    expect(await relativeDirectories(current.root)).toEqual([
      'alpha/.spec',
      'product/artifacts/.spec',
      'zeta/.spec',
    ])
    await expect(relativeDirectories(join(current.root, 'qualification/evidence'))).resolves.toEqual([
      'archive/.spec',
    ])
    await expect(relativeDirectories(join(current.root, 'evidence/artifacts'))).resolves.toEqual([
      'run/.spec',
    ])
    await expect(relativeDirectories(join(current.root, 'benchmark/artifacts'))).resolves.toEqual([
      'run/.spec',
    ])
  })

  it('ignores symlinked directories and validates explicit exclusions', async () => {
    const external = await fixture({ '.spec/api.d.ts': 'export interface Outside {}\n' })
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
      'generated/cache/.spec/api.d.ts': 'export interface Generated {}\n',
      'archive/legacy/.spec/api.d.ts': 'export interface Archived {}\n',
    })
    fixtures.push(external, current)
    await symlink(external.root, join(current.root, 'linked'))

    const directories = await discoverSpecificationDirectories(current.root, {
      exclude: ['generated', 'archive'],
    })
    expect(directories.map((directory) => relative(current.root, directory))).toEqual([
      'alpha/.spec',
    ])
    await expect(
      discoverSpecificationDirectories(current.root, { exclude: ['../outside'] }),
    ).rejects.toThrow('escapes')
    await expect(resolveApplicationRoot(current.root)).resolves.toBe(await realpath(current.root))
  })

  it('isolates an invalid declaration without hiding valid siblings', async () => {
    const current = await fixture({
      'broken/.spec/api.d.ts': 'export interface Broken { value: Missing }\n',
      'healthy/.spec/api.d.ts': 'export interface Healthy {}\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root)
    expect(snapshot.specifications.map((specification) => specification.source)).toEqual([
      'broken/.spec/api.d.ts',
      'healthy/.spec/api.d.ts',
    ])
    expect(snapshot.specifications[0]?.diagnostics).not.toHaveLength(0)
    expect(snapshot.specifications[1]?.diagnostics).toHaveLength(0)
  })

  it('selects owner trees while retaining the full compiled corpus', async () => {
    const current = await fixture({
      'runtime/boot/.spec/api.d.ts': 'export interface Boot {}\n',
      'runtime/schema/.spec/api.d.ts': 'export interface Schema {}\n',
      'core/.spec/api.d.ts': 'export interface Core {}\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root, { select: ['runtime'], focused: true })
    expect(snapshot.specifications).toHaveLength(2)
    expect(snapshot.selection).toMatchObject({
      kind: 'focused',
      requested: ['runtime'],
      selected: [
        'runtime/boot/.spec/api.d.ts',
        'runtime/schema/.spec/api.d.ts',
      ],
    })
  })

  it('loads transitive contract owners as selection support', async () => {
    const current = await fixture({
      'owner/.spec/api.d.ts': 'export interface Owner { readonly id: string }\n',
      'middle/.spec/api.d.ts':
        "import type { Owner } from '../../owner/.spec/api.js'\nexport interface Middle { readonly owner: Owner }\n",
      'consumer/.spec/api.d.ts':
        "import type { Middle } from '../../middle/.spec/api.js'\nexport interface Use { readonly middle: Middle }\n",
      'unrelated/.spec/api.d.ts': 'export interface Unrelated {}\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root, { select: ['consumer'], focused: true })
    expect(snapshot.specifications.map((specification) => specification.source)).toEqual([
      'consumer/.spec/api.d.ts',
      'middle/.spec/api.d.ts',
      'owner/.spec/api.d.ts',
    ])
    expect(snapshot.selection).toMatchObject({
      selected: ['consumer/.spec/api.d.ts'],
      support: ['middle/.spec/api.d.ts', 'owner/.spec/api.d.ts'],
    })
  })

  it('selects the nearest nested owner for an implementation path', async () => {
    const current = await fixture({
      'runtime/.spec/api.d.ts': 'export interface Runtime {}\n',
      'runtime/query/.spec/api.d.ts': 'export interface Query {}\n',
      'runtime/query/planner/.spec/api.d.ts': 'export interface Planner {}\n',
      'runtime/query/planner/index.ts': 'export const planner = true\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root, {
      select: ['runtime/query/planner/index.ts'],
      focused: true,
    })
    expect(snapshot.specifications.map((specification) => specification.source)).toEqual([
      'runtime/query/planner/.spec/api.d.ts',
    ])
  })

  it('roots reverse dependents in changed owners instead of unrelated support', async () => {
    const current = await fixture({
      'common/.spec/api.d.ts': 'export interface Common { readonly id: string }\n',
      'changed/.spec/api.d.ts':
        "import type { Common } from '../../common/.spec/api.js'\nexport interface Changed { readonly common: Common }\n",
      'leaf/.spec/api.d.ts':
        "import type { Changed } from '../../changed/.spec/api.js'\nexport interface Leaf { readonly changed: Changed }\n",
      'unrelated/.spec/api.d.ts':
        "import type { Common } from '../../common/.spec/api.js'\nexport interface Unrelated { readonly common: Common }\n",
    })
    fixtures.push(current)

    const snapshot = await application(current.root, {
      select: ['changed'],
      focused: true,
      includeDependents: true,
    })
    expect(snapshot.specifications.map((specification) => specification.source)).toEqual([
      'changed/.spec/api.d.ts',
      'common/.spec/api.d.ts',
      'leaf/.spec/api.d.ts',
    ])
  })

  it('terminates cyclic closure and retains unresolved declaration diagnostics', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts':
        "import type { Beta } from '../../beta/.spec/api.js'\nimport type { Missing } from '../../missing/.spec/api.js'\nexport interface Alpha { beta: Beta; missing: Missing }\n",
      'beta/.spec/api.d.ts':
        "import type { Alpha } from '../../alpha/.spec/api.js'\nexport interface Beta { alpha?: Alpha }\n",
      'unrelated/.spec/api.d.ts': 'export interface Unrelated {}\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root, {
      select: ['alpha'],
      focused: true,
      includeDependents: true,
    })
    expect(snapshot.specifications.map((specification) => specification.source)).toEqual([
      'alpha/.spec/api.d.ts',
      'beta/.spec/api.d.ts',
    ])
    expect(snapshot.specifications.flatMap((value) => value.diagnostics)).toContainEqual(
      expect.objectContaining({ code: 'API_TYPESCRIPT_TS2307', file: 'alpha/.spec/api.d.ts' }),
    )
  })

  it('rejects empty and escaping selections generically', async () => {
    const current = await fixture({
      'runtime/boot/.spec/api.d.ts': 'export interface Boot {}\n',
    })
    fixtures.push(current)

    const empty = await application(current.root, { select: ['missing'], focused: true })
    const escaping = await application(current.root, { select: ['../outside'], focused: true })
    expect(empty.diagnostics.map(({ code }) => code)).toContain('SELECTION_EMPTY')
    expect(escaping.diagnostics.map(({ code }) => code)).toContain('SELECTION_INVALID')
  })

  it('isolates ambient, lib, and UMD declarations between specification Programs', async () => {
    const current = await fixture({
      'ambient.d.ts': 'interface Leaked { readonly value: string }\n',
      'ambient-owner/.spec/api.d.ts': 'export interface AmbientOwner {}\n',
      'ambient-owner/.spec/flows/use.ts':
        '/// <reference path="../../../ambient.d.ts" />\nexport const value: Leaked = { value: "ok" }\n',
      'library.d.ts':
        '/// <reference lib="esnext.disposable" />\nexport interface LibraryReference {}\n',
      'library-owner/.spec/api.d.ts': 'export interface LibraryOwner {}\n',
      'library-owner/.spec/flows/use.ts':
        'import type { LibraryReference } from "../../../library.js"\nexport type Use = LibraryReference\n',
      'umd.d.ts': 'export as namespace Leak\nexport interface A {}\n',
      'umd-owner/.spec/api.d.ts': 'export interface UmdOwner {}\n',
      'umd-owner/.spec/flows/use.ts':
        'import type { A } from "../../../umd.js"\nexport type Use = A\n',
      'neighbor/.spec/api.d.ts': 'export interface Neighbor {}\n',
      'neighbor/.spec/flows/use.ts':
        'export const leaked: Leaked = { value: "missing" }\nexport const disposable: Disposable = { [Symbol.dispose]() {} }\nexport type Namespace = Leak.A\n',
    })
    fixtures.push(current)

    const snapshot = await application(current.root)
    const neighbor = snapshot.specifications.find((value) => value.source.startsWith('neighbor/'))!
    expect(neighbor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2304' }),
        expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2503' }),
      ]),
    )
  })

  it('qualifies required and exact layouts on the selected scope', async () => {
    const current = await fixture({
      'exact/.spec/api.d.ts': 'export interface Exact {}\n',
      'exact/.spec/layout.ts':
        "import { defineLayout } from '@astrale-os/codegraph/authoring'\nexport default defineLayout({ entries: ['owned.ts'], exact: true })\n",
      'exact/owned.ts': 'export {}\n',
      'sparse/.spec/api.d.ts': 'export interface Sparse {}\n',
      'sparse/.spec/layout.ts':
        "import { defineLayout } from '@astrale-os/codegraph/authoring'\nexport default defineLayout(['owned.ts'])\n",
      'sparse/owned.ts': 'export {}\n',
      'missing/.spec/api.d.ts': 'export interface Missing {}\n',
    })
    fixtures.push(current)

    const exact = await application(current.root, {
      select: ['exact'],
      focused: true,
      qualify: true,
      requireExactLayout: true,
    })
    const sparse = await application(current.root, {
      select: ['sparse'],
      focused: true,
      qualify: true,
      requireExactLayout: true,
    })
    const missing = await application(current.root, {
      select: ['missing'],
      focused: true,
      qualify: true,
      requireCompleteLayout: true,
    })
    expect(qualificationCodes(exact)).not.toContain('MODULE_LAYOUT_REQUIRED')
    expect(qualificationCodes(sparse)).toContain('MODULE_LAYOUT_EXACT_REQUIRED')
    expect(qualificationCodes(missing)).toContain('MODULE_LAYOUT_REQUIRED')
  })

  it('reports an empty application explicitly', async () => {
    const current = await fixture({})
    fixtures.push(current)
    expect((await application(current.root)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SPEC_NOT_FOUND' }),
    )
  })
})

async function relativeDirectories(root: string): Promise<string[]> {
  return (await discoverSpecificationDirectories(root)).map((directory) => relative(root, directory))
}

async function application(
  root: string,
  options: TypeSpecApplicationRefreshOptions = {},
): Promise<TypeSpecApplicationSnapshot> {
  const service = await createTypeSpecApplicationService({
    root,
    repository: 'fixture:catalog-v2',
    analysis: { maximumRetainedGenerations: 2 },
  })
  try {
    return (await service.refresh({ compilerAnalysis: false, ...options })).snapshot
  } finally {
    await service.dispose()
  }
}

function qualificationCodes(snapshot: TypeSpecApplicationSnapshot): string[] {
  return snapshot.qualifications.flatMap((qualification) =>
    qualification.profiles.flatMap((profile) =>
      profile.rules.flatMap((rule) => rule.diagnostics.map((diagnostic) => diagnostic.code)),
    ),
  )
}
