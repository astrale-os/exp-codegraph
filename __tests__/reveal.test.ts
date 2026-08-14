import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTypeSpecApplicationService } from '../application/index.ts'
import { SPEC_REVEAL_PROTOCOL } from '../application/interaction/reveal.ts'
import { revealApplicationSpecification } from '../server/application-operations.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
})

describe('spec reveal service', () => {
  it('reveals only a discovered specification and selects its present source', async () => {
    const current = await fixture({ 'alpha/.spec/api.d.ts': 'export interface Alpha {}\n' })
    fixtures.push(current)
    const application = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'test:reveal',
    })
    await application.refresh()
    const reader = await application.open()
    const reveal = vi.fn(async () => undefined)

    await expect(
      revealApplicationSpecification(
        current.root,
        reader,
        'alpha/.spec/api.d.ts',
        reveal,
      ),
    ).resolves.toEqual({
      protocol: SPEC_REVEAL_PROTOCOL,
      status: 'revealed',
      source: 'alpha/.spec/api.d.ts',
    })
    expect(reveal).toHaveBeenLastCalledWith(
      join(current.root, 'alpha/.spec/api.d.ts'),
      join(current.root, 'alpha/.spec'),
    )

    await expect(
      revealApplicationSpecification(current.root, reader, '../outside/api.d.ts', reveal),
    ).resolves.toMatchObject({
      protocol: SPEC_REVEAL_PROTOCOL,
      status: 'rejected',
      code: 'SOURCE_NOT_FOUND',
    })
    expect(reveal).toHaveBeenCalledTimes(1)
    await reader.dispose()
    await application.dispose()
  })

  it('returns a bounded failure when the file manager cannot be launched', async () => {
    const current = await fixture({ 'alpha/.spec/api.d.ts': 'export interface Alpha {}\n' })
    fixtures.push(current)
    const application = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'test:reveal',
    })
    await application.refresh()
    const reader = await application.open()

    await expect(
      revealApplicationSpecification(current.root, reader, 'alpha/.spec/api.d.ts', async () => {
        throw new Error('File manager unavailable.')
      }),
    ).resolves.toMatchObject({
      protocol: SPEC_REVEAL_PROTOCOL,
      status: 'rejected',
      code: 'REVEAL_FAILED',
      message: 'File manager unavailable.',
    })
    await reader.dispose()
    await application.dispose()
  })

  it('reveals the public anchor of a convention-based module profile', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
    })
    fixtures.push(current)
    const application = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'test:reveal',
    })
    await application.refresh()
    const reader = await application.open()
    const reveal = vi.fn(async () => undefined)

    await expect(
      revealApplicationSpecification(current.root, reader, 'module/.spec/api.d.ts', reveal),
    ).resolves.toMatchObject({ status: 'revealed' })
    expect(reveal).toHaveBeenCalledWith(
      join(current.root, 'module/.spec/api.d.ts'),
      join(current.root, 'module/.spec'),
    )
    await reader.dispose()
    await application.dispose()
  })
})
