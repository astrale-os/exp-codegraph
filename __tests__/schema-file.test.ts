import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { validateSchemaFile } from '../schema/index.ts'

import { fixture } from './fixture.ts'

describe('schema file validation', () => {
  it('validates bounded documents with source-positioned diagnostics', async () => {
    const current = await fixture({
      'value.schema.json': JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
        additionalProperties: false,
      }),
      'value.json': JSON.stringify({ value: 'valid' }),
    })
    try {
      await expect(
        validateSchemaFile({
          schema: join(current.root, 'value.schema.json'),
          document: join(current.root, 'value.json'),
        }),
      ).resolves.toEqual([])
      await writeFile(join(current.root, 'value.json'), JSON.stringify({ value: 1 }))
      await expect(
        validateSchemaFile({
          schema: join(current.root, 'value.schema.json'),
          document: join(current.root, 'value.json'),
        }),
      ).resolves.toMatchObject([
        { code: 'SCHEMA_TYPE', file: 'value.json', line: 1, column: 10, pointer: '/value' },
      ])
    } finally {
      await current.remove()
    }
  })
})
