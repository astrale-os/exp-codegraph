import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { compileSpecificationSnapshot } from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('module specification TypeScript', () => {
  it('composes API, internal, port, state, flow, and example contracts', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts':
        "export interface Job { readonly id: string }\nexport namespace jobs { export type Job = import('./api.js').Job }\n",
      'module/.spec/internal.d.ts':
        "import type { Job } from './api.js'\nexport interface JobStore { save(job: Job): Promise<void> }\n",
      'module/.spec/ports/queue.d.ts':
        "import type { Job } from '../api.js'\nexport interface QueueBackend { enqueue(job: Job): Promise<void> }\n",
      'module/.spec/states/job.ts':
        "import { defineState } from '@astrale-os/codegraph/authoring'\nexport const jobState = defineState({ initial: 'pending', transitions: { pending: { start: 'running' }, running: {} } })\n",
      'module/.spec/flows/start.ts':
        "import { transition } from '@astrale-os/codegraph/authoring'\nimport { jobState } from '../states/job.js'\nexport function start() { return transition(jobState, 'pending', 'start') }\n",
      'module/.spec/examples/start.ts':
        "import type { Job } from '../api.js'\ndeclare const job: Job\nvoid job.id\n",
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'module/.spec/flows/start.ts',
          text: 'jobState',
          target: expect.objectContaining({ source: 'module/.spec/states/job.ts' }),
        }),
        expect.objectContaining({
          source: 'module/.spec/examples/start.ts',
          text: 'Job',
          target: expect.objectContaining({ source: 'module/.spec/api.d.ts' }),
        }),
      ]),
    )
  })

  it('composes concern-organized API fragments under one public module', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': "export { type Application } from './api/application.js'\n",
      'module/.spec/api/application.d.ts': `
import type { Graph } from './graph.js'
export interface Application { readonly graph: Graph }
`,
      'module/.spec/api/graph.d.ts': 'export interface Graph { readonly revision: number }\n',
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.module.api?.model?.surface.exports.map(({ name }) => name)).toEqual([
      'Application',
    ])
  })

  it('rejects illegal state transitions in flows before implementation exists', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/states/job.ts':
        "import { defineState } from '@astrale-os/codegraph/authoring'\nexport const jobState = defineState({ transitions: { pending: { start: 'running' }, running: {} } })\n",
      'module/.spec/flows/start.ts':
        "import { transition } from '@astrale-os/codegraph/authoring'\nimport { jobState } from '../states/job.js'\nexport function start() { return transition(jobState, 'running', 'start') }\n",
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MODULE_TYPESCRIPT_2345',
        file: 'module/.spec/flows/start.ts',
      }),
    )
  })

  it('enforces API-only examples and keeps normative imports out of implementation files', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts':
        "export type { Hidden } from '../src/hidden.js'\nexport interface API {}\n",
      'module/.spec/internal.d.ts': 'export interface Internal {}\n',
      'module/.spec/examples/leak.ts':
        "import type { Internal } from '../internal.js'\ndeclare const value: Internal\nvoid value\n",
      'module/src/hidden.ts': 'export interface Hidden {}\n',
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))
    const diagnostics = loaded.diagnostics

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MODULE_IMPORT_BOUNDARY_INVALID',
        file: 'module/.spec/api.d.ts',
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MODULE_IMPORT_BOUNDARY_INVALID',
        file: 'module/.spec/examples/leak.ts',
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'EXAMPLE_TARGET_NOT_IMPORTED',
        file: 'module/.spec/examples/leak.ts',
      }),
    )
  })

  it('rejects dynamic imports, package-private aliases, and script-style spec files', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/flows/dynamic.ts':
        "export async function dynamic() { return import('../api.js') }\n",
      'module/.spec/flows/private.ts':
        "import type { API } from '#private'\nexport type Value = API\n",
      'module/.spec/limits.ts': 'const max = 1\nvoid max\n',
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))
    const codes = loaded.diagnostics.map(({ code }) => code)

    expect(codes).toContain('MODULE_DYNAMIC_IMPORT_INVALID')
    expect(codes).toContain('MODULE_IMPORT_PRIVATE_INVALID')
    expect(codes).toContain('MODULE_TYPESCRIPT_NOT_MODULE')
  })

  it('rejects relative public-contract imports that escape the selected catalog', async () => {
    const external = await fixture({
      '.spec/api.d.ts': 'export interface Outside {}\n',
    })
    const current = await fixture({
      'module/.spec/api.d.ts': `export type { Outside } from '../../../${basename(external.root)}/.spec/api.js'\n`,
    })
    fixtures.push(external, current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MODULE_IMPORT_BOUNDARY_INVALID',
        file: 'module/.spec/api.d.ts',
      }),
    )
  })

  it('allows an explicit public contract owned by a sibling workspace package', async () => {
    const external = await fixture({
      'package.json': JSON.stringify({ name: '@example/shared' }),
      '.spec/api.d.ts': 'export interface Shared { readonly value: string }\n',
    })
    const current = await fixture({
      'module/.spec/api.d.ts': `import type { Shared } from '../../../${basename(external.root)}/.spec/api.js'\nexport interface Consumer { readonly shared: Shared }\n`,
    })
    fixtures.push(external, current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toEqual([])
  })

  it('honors explicit NodeNext resolution modes at the specification boundary', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ type: 'module' }),
      'node_modules/conditional/package.json': JSON.stringify({
        name: 'conditional',
        exports: {
          '.': {
            import: './import.d.ts',
            require: './require.d.ts',
          },
        },
      }),
      'node_modules/conditional/import.d.ts': 'export interface ImportOnly {}\n',
      'node_modules/conditional/require.d.ts': 'export interface RequireOnly {}\n',
      'module/.spec/api.d.ts':
        'import type { RequireOnly } from \'conditional\' with { "resolution-mode": "require" }\nexport interface API { readonly value: RequireOnly }\n',
    })
    fixtures.push(current)

    const loaded = await compileSpecificationSnapshot(current.root, join(current.root, 'module/.spec'))

    expect(loaded.diagnostics).toEqual([])
  })

  it('invalidates cached TypeScript evidence when an owned specification source changes', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
      'module/.spec/flows/read.ts':
        "import type { API } from '../api.js'\nexport function read(input: API): string { return input.value }\n",
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')

    const before = await compileSpecificationSnapshot(current.root, directory)
    expect(before.diagnostics).toEqual([])

    await current.write(
      'module/.spec/flows/read.ts',
      "import type { API } from '../api.js'\nexport function read(_input: API): string { return 1 }\n",
    )
    const changed = await compileSpecificationSnapshot(current.root, directory)
    expect(changed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2322' }),
    )
  })

  it('invalidates cached evidence when a transitive import acquires a resolution', async () => {
    const current = await fixture({
      'bridge.ts':
        "import type { Value } from './value.js'\nexport interface Bridge { readonly value: Value }\n",
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
      'module/.spec/flows/read.ts':
        "import type { Bridge } from '../../../bridge.js'\nexport function read(input: Bridge): unknown { return input.value }\n",
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')

    const before = await compileSpecificationSnapshot(current.root, directory)
    expect(before.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2307' }),
    )

    await current.write('value.d.ts', 'export type Value = string\n')
    const changed = await compileSpecificationSnapshot(current.root, directory)
    expect(changed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2307' }),
    )
  })

  it('invalidates cached evidence when a transitive path directive acquires a target', async () => {
    const current = await fixture({
      'bridge.ts': '/// <reference path="./types.d.ts" />\nexport interface Bridge {}\n',
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/flows/read.ts':
        "import type { Bridge } from '../../../bridge.js'\nexport type Read = Bridge\n",
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')

    const before = await compileSpecificationSnapshot(current.root, directory)
    expect(before.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_6053' }),
    )

    await current.write('types.d.ts', 'export {}\n')
    const changed = await compileSpecificationSnapshot(current.root, directory)
    expect(changed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_6053' }),
    )
  })

  it('invalidates cached evidence when a transitive types directive acquires a target', async () => {
    const current = await fixture({
      'bridge.ts': '/// <reference types="conditional-types" />\nexport interface Bridge {}\n',
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/flows/read.ts':
        "import type { Bridge } from '../../../bridge.js'\nexport type Read = Bridge\n",
    })
    fixtures.push(current)
    const directory = join(current.root, 'module/.spec')

    const before = await compileSpecificationSnapshot(current.root, directory)
    expect(before.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2688' }),
    )

    await current.write('node_modules/@types/conditional-types/index.d.ts', 'export {}\n')
    const changed = await compileSpecificationSnapshot(current.root, directory)
    expect(changed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'MODULE_TYPESCRIPT_2688' }),
    )
  })
})
