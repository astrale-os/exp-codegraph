import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { codegraphProducerFingerprint } from '../application/node/fingerprint.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Codegraph checkpoint producer identity', () => {
  /** @evidence APPLICATION-CHECKPOINT-PRODUCER-IDENTITY */
  it('binds the exact executable package tree rather than only package version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-producer-fingerprint-'))
    temporary.push(root)
    await mkdir(join(root, 'dist', 'application'), { recursive: true })
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@astrale-os/codegraph', version: '0.1.0' }),
    )
    await writeFile(join(root, 'dist', 'application', 'service.js'), 'export const value = 1\n')

    const first = await codegraphProducerFingerprint(root)
    expect(await codegraphProducerFingerprint(root)).toBe(first)
    await writeFile(join(root, 'dist', 'application', 'service.js'), 'export const value = 2\n')
    const changedRuntime = await codegraphProducerFingerprint(root)
    expect(changedRuntime).not.toBe(first)
    await writeFile(join(root, 'dist', 'application', 'service.js.map'), '{"ignored":true}\n')
    expect(await codegraphProducerFingerprint(root)).toBe(changedRuntime)
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@astrale-os/codegraph', version: '0.1.1' }),
    )
    expect(await codegraphProducerFingerprint(root)).not.toBe(changedRuntime)
  })
})
