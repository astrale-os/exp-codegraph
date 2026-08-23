import { describe, expect, it } from 'vitest'

import {
  compilePackageDefinition,
  compilePackagePatterns,
  matchesPackagePattern,
  packageNameFromPath,
} from '../specification/module/package.ts'
import { withOperationSnapshot } from '../source/operation-snapshot.ts'

describe('module package declarations', () => {
  it('extracts one exact dependency and requires its canonical package path', () => {
    const result = compilePackageDefinition(
      'module/.spec/packages/@noble/hashes.ts',
      `import { definePackage } from '@astrale-os/codegraph/authoring'
export default definePackage({
  package: '@noble/hashes',
  purpose: 'Provides audited hashing primitives for canonical identities.',
})
`,
    )

    expect(result.diagnostics).toEqual([])
    expect(result.definition).toEqual({
      package: '@noble/hashes',
      purpose: 'Provides audited hashing primitives for canonical identities.',
    })
    expect(packageNameFromPath('packages/@noble/hashes.ts')).toBe('@noble/hashes')
    expect(packageNameFromPath('packages/jose.ts')).toBe('jose')
    expect(packageNameFromPath('packages/not/a/package.ts')).toBeUndefined()
  })

  it('extracts constrained package patterns without expanding them', () => {
    const result = compilePackagePatterns(
      'module/.spec/packages/exceptions.ts',
      `import { definePackagePattern as pattern } from '@astrale-os/codegraph/authoring'
export default [
  pattern({ pattern: '@types/*', reason: 'Ambient development declarations.' }),
  pattern({ pattern: 'eslint-*', reason: 'A uniform lint plugin family.' }),
]
`,
    )

    expect(result.diagnostics).toEqual([])
    expect(result.definitions).toEqual([
      { pattern: '@types/*', reason: 'Ambient development declarations.' },
      { pattern: 'eslint-*', reason: 'A uniform lint plugin family.' },
    ])
    expect(matchesPackagePattern('@types/*', '@types/node')).toBe(true)
    expect(matchesPackagePattern('@types/*', '@typescript/native-preview')).toBe(false)
  })

  it('rejects dynamic, misspelled, unsafe, and executable package definitions', () => {
    const dependency = compilePackageDefinition(
      'module/.spec/packages/jose.ts',
      `import { definePackage } from '@astrale-os/codegraph/authoring'
const purpose = 'Dynamic'
export default definePackage({ package: 'JOSE', purpose, version: '^6' })
`,
    )
    expect(dependency.diagnostics.map(({ code }) => code)).toEqual([
      'PACKAGE_STATEMENT_INVALID',
      'PACKAGE_FIELD_UNKNOWN',
      'PACKAGE_FIELD_UNKNOWN',
      'PACKAGE_FIELD_INVALID',
      'PACKAGE_NAME_INVALID',
    ])

    const patterns = compilePackagePatterns(
      'module/.spec/packages/exceptions.ts',
      `import { definePackagePattern } from '@astrale-os/codegraph/authoring'
export default [definePackagePattern({ pattern: '*', reason: 'Everything.' })]
`,
    )
    expect(patterns.diagnostics).toEqual([
      expect.objectContaining({ code: 'PACKAGE_PATTERN_UNSAFE' }),
    ])
  })

  it('requires an exception file to justify at least one narrow pattern', () => {
    const result = compilePackagePatterns(
      'module/.spec/packages/exceptions.ts',
      `import { definePackagePattern } from '@astrale-os/codegraph/authoring'
export default []
`,
    )

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'PACKAGE_PATTERNS_EMPTY' }),
    )
  })

  it('reuses one exact standalone syntax analysis inside an operation', async () => {
    const source = 'module/.spec/packages/jose.ts'
    const invalid = `import { definePackage } from '@astrale-os/codegraph/authoring'
export default definePackage({ package: 'jose', purpose: })
`
    await withOperationSnapshot(async () => {
      const first = compilePackageDefinition(source, invalid)
      expect(compilePackageDefinition(source, invalid)).toEqual(first)
      expect(first.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'MODULE_TYPESCRIPT_1109' }),
      )
      expect(() =>
        compilePackageDefinition(
          source,
          `import { definePackage } from '@astrale-os/codegraph/authoring'
export default definePackage({ package: 'jose', purpose: 'Signing.' })
`,
        ),
      ).toThrow('Authoring source changed during compilation')
    })
  })
})
