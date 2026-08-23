import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { schemaMetadataIssue } from '../schema/load.optimization.ts'

describe('schema loading optimization', () => {
  it('reuses meta-compilation without retaining validation errors', () => {
    const valid = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    }
    const invalid = { ...valid, type: 42 }
    const canonical = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
    expect(canonical.validateSchema(invalid)).toBe(false)
    const expected = canonical.errorsText(canonical.errors, { separator: '; ' })

    expect(schemaMetadataIssue(invalid)).toBe(expected)
    expect(schemaMetadataIssue(valid)).toBeUndefined()
    expect(schemaMetadataIssue(invalid)).toBe(expected)
  })
})
