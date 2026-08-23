import { matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  simpleDirectoryExclusion,
  simpleRepositoryPathMatch,
} from '../repository/directory-scope.optimization.ts'

const patterns = [
  '.git',
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
]
const paths = [
  '.git',
  '.git/config',
  'node_modules',
  'node_modules/package/index.js',
  'packages/core/node_modules',
  'packages/core/node_modules/package/index.js',
  'dist',
  'dist/index.js',
  'packages/core/dist',
  'packages/core/dist/index.js',
  'src/index.ts',
]

describe('repository scope optimization', () => {
  it('is exact for the common application recursive exclusion patterns', () => {
    for (const pattern of patterns) {
      for (const path of paths) {
        expect(simpleRepositoryPathMatch(path, pattern)).toBe(matchesGlob(path, pattern))
        expect(simpleDirectoryExclusion(path, pattern)).toBe(
          matchesGlob(path, pattern) || matchesGlob(`${path}/__entry__`, pattern) ||
            (!/[?*\[\]{}]/u.test(pattern) &&
              (path === pattern || path.startsWith(`${pattern}/`))),
        )
      }
    }
  })

  it('visibly defers complex glob syntax to the canonical matcher', () => {
    expect(simpleRepositoryPathMatch('src/test.ts', '**/{src,test}/**')).toBeUndefined()
    expect(simpleDirectoryExclusion('src', '**/{src,test}/**')).toBeUndefined()
  })
})
