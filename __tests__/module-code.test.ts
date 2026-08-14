import { describe, expect, it } from 'vitest'

import { compileCode } from '../specification/module/code.ts'

describe('module code declaration', () => {
  it('accepts one closed literal list of shared internals', () => {
    const compiled = compileCode(
      'module/.spec/code.ts',
      `
import { defineCode } from '@astrale-os/codegraph/authoring'

export default defineCode({
  internals: ['../shared/capture.ts'],
})
`,
    )

    expect(compiled.diagnostics).toEqual([])
    expect(compiled.configuration).toEqual({ internals: ['../shared/capture.ts'] })
  })

  it('rejects globs, non-leading traversal, duplicates, and unknown fields', () => {
    const compiled = compileCode(
      'module/.spec/code.ts',
      `
import { defineCode } from '@astrale-os/codegraph/authoring'

export default defineCode({
  internals: ['../shared/*.ts', '../shared/../private.ts', '../same.ts', '../same.ts'],
  root: '../src',
})
`,
    )

    expect(compiled.diagnostics.map(({ code }) => code)).toEqual([
      'CODE_FIELD_UNKNOWN',
      'CODE_INTERNAL_PATH_INVALID',
      'CODE_INTERNAL_PATH_INVALID',
      'CODE_INTERNAL_PATH_DUPLICATE',
    ])
    expect(compiled.configuration).toEqual({ internals: ['../same.ts'] })
  })
})
