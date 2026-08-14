import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ModuleFile } from '../specification/module/inventory.ts'

import { loadHistoryResource } from '../specification/module/history.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('module context resources', () => {
  it('detects and hashes inert Markdown, PDF, image, text, and binary resources', async () => {
    const current = await fixture({
      'module/.history/background.md': '# Background\n\nSupporting context.\n',
      'module/.history/report.data': '%PDF-1.7 fixture',
      'module/.history/picture.data': new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]),
      'module/.history/model.json': '{"value": 1}\n',
      'module/.history/arbitrary.data': new Uint8Array([0, 255, 1]),
    })
    fixtures.push(current)

    const resources = await Promise.all(
      ['background.md', 'report.data', 'picture.data', 'model.json', 'arbitrary.data'].map((name) =>
        loadHistoryResource(contextFile(current.root, name)),
      ),
    )

    expect(resources.flatMap(({ diagnostics }) => diagnostics)).toEqual([])
    expect(resources.map(({ resource }) => resource?.presentation)).toEqual([
      'markdown',
      'pdf',
      'image',
      'text',
      'binary',
    ])
    expect(resources[0]?.resource?.document?.html).toContain('<h1>Background</h1>')
    expect(resources[1]?.resource?.mediaType).toBe('application/pdf')
    expect(resources[2]?.resource?.mediaType).toBe('image/png')
    expect(resources[3]?.resource?.text).toBe('{"value": 1}\n')
    expect(resources[4]?.resource?.text).toBeUndefined()
    expect(resources.every(({ resource }) => resource?.revision.length === 64)).toBe(true)
  })

  it('changes only the context revision when inert content changes', async () => {
    const current = await fixture({ 'module/.history/note.txt': 'before\n' })
    fixtures.push(current)

    const before = await loadHistoryResource(contextFile(current.root, 'note.txt'))
    await current.write('module/.history/note.txt', 'after\n')
    const after = await loadHistoryResource(contextFile(current.root, 'note.txt'))

    expect(before.resource?.revision).not.toBe(after.resource?.revision)
    expect(before.resource?.presentation).toBe('text')
    expect(after.resource?.presentation).toBe('text')
  })

  it('retains an empty Markdown document as present text', async () => {
    const current = await fixture({ 'module/.history/empty.md': '' })
    fixtures.push(current)

    const loaded = await loadHistoryResource(contextFile(current.root, 'empty.md'))

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.resource).toMatchObject({
      presentation: 'markdown',
      text: '',
      document: { text: '' },
    })
  })

})

function contextFile(root: string, relative: string): ModuleFile {
  return {
    absolute: join(root, 'module/.history', relative),
    relative,
    source: `module/.history/${relative}`,
  }
}
