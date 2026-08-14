import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { inventoryModuleFiles } from '../specification/module/inventory.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('module specification inventory', () => {
  it('discovers the complete closed normative grammar and open context tree', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/api/application.d.ts': 'export interface ApplicationAPI {}\n',
      'module/.spec/code.ts': 'export {}\n',
      'module/.spec/icon.svg': '<svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z" /></svg>\n',
      'module/.spec/internal.d.ts': 'export interface Planner {}\n',
      'module/.spec/schemas/value.schema.json': '{}\n',
      'module/.spec/ports/authentication/identity-store.d.ts':
        'export interface IdentityStore {}\n',
      'module/.spec/capabilities/query.ts': '',
      'module/.spec/flows/query.ts': '',
      'module/.spec/laws/query.ts': '',
      'module/.spec/states/job.ts': '',
      'module/.spec/limits.ts': '',
      'module/.spec/layout.ts': '',
      'module/.spec/examples/basic.ts': '',
      'module/.spec/benchmarks/query.ts': '',
      'module/.spec/packages/jose.ts': '',
      'module/.spec/packages/@types/node.ts': '',
      'module/.spec/packages/exceptions.ts': '',
      'module/.spec/architecture.md': '# Architecture\n',
      'module/.history/background.md': '# Background\n',
      'module/.history/research/report.pdf': '%PDF-fixture',
      'module/.history/arbitrary.data': new Uint8Array([0, 1, 2, 3]),
    })
    fixtures.push(current)

    const inventory = await inventoryModuleFiles(current.root, join(current.root, 'module/.spec'))

    expect(inventory.diagnostics).toEqual([])
    expect(inventory.historyDiagnostics).toEqual([])
    expect(inventory.code?.relative).toBe('code.ts')
    expect(inventory.icon?.relative).toBe('icon.svg')
    expect(inventory.internal?.relative).toBe('internal.d.ts')
    expect(inventory.apiFragments.map(({ relative }) => relative)).toEqual(['api/application.d.ts'])
    expect(inventory.layout?.relative).toBe('layout.ts')
    expect(inventory.schemas.map(({ relative }) => relative)).toEqual(['schemas/value.schema.json'])
    expect(inventory.ports.map(({ relative }) => relative)).toEqual([
      'ports/authentication/identity-store.d.ts',
    ])
    expect(inventory.packages.map(({ relative }) => relative)).toEqual([
      'packages/@types/node.ts',
      'packages/jose.ts',
    ])
    expect(inventory.packageExceptions?.relative).toBe('packages/exceptions.ts')
    expect(inventory.history.map(({ relative }) => relative)).toEqual([
      'arbitrary.data',
      'background.md',
      'research/report.pdf',
    ])
  })

  it('rejects unknown normative files, invalid artifact extensions, and symlinks', async () => {
    const external = await fixture({ 'outside.ts': 'export {}\n' })
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/README.md': 'Move me to context.\n',
      'module/.spec/flows/valid.ts': 'export {}\n',
      'module/.spec/laws/law.md': 'Wrong representation.\n',
      'module/.spec/unknown/value.ts': '',
      'module/.history/safe.md': '# Safe\n',
    })
    fixtures.push(external, current)
    await symlink(
      join(external.root, 'outside.ts'),
      join(current.root, 'module/.spec/flows/escaped.ts'),
    )
    await symlink(
      join(external.root, 'outside.ts'),
      join(current.root, 'module/.history/escaped.ts'),
    )

    const inventory = await inventoryModuleFiles(current.root, join(current.root, 'module/.spec'))

    expect(inventory.diagnostics.map(({ code }) => code)).toEqual([
      'MODULE_SPEC_ARTIFACT_UNKNOWN',
      'MODULE_SPEC_SYMBOLIC_LINK',
      'MODULE_SPEC_FILE_INVALID',
      'MODULE_SPEC_ARTIFACT_UNKNOWN',
    ])
    expect(inventory.historyDiagnostics).toEqual([
      expect.objectContaining({ code: 'HISTORY_SYMBOLIC_LINK' }),
    ])
    expect(inventory.history.map(({ relative }) => relative)).toEqual(['safe.md'])
  })

  it('rejects a symbolic link used as the history root', async () => {
    const external = await fixture({ 'notes.md': '# Outside\n' })
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
    })
    fixtures.push(external, current)
    await symlink(external.root, join(current.root, 'module/.history'))

    const inventory = await inventoryModuleFiles(current.root, join(current.root, 'module/.spec'))

    expect(inventory.history).toEqual([])
    expect(inventory.historyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: 'HISTORY_DIRECTORY_INVALID',
        message: 'History directory cannot be a symbolic link.',
      }),
    )
  })

  it('rejects empty optional normative directories', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
    })
    fixtures.push(current)
    await mkdir(join(current.root, 'module/.spec/benchmarks'))

    const inventory = await inventoryModuleFiles(current.root, join(current.root, 'module/.spec'))

    expect(inventory.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'MODULE_SPEC_DIRECTORY_EMPTY',
        file: 'module/.spec/benchmarks',
      }),
    )
  })
})
