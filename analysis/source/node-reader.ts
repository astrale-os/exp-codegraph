import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { portablePath } from '../identity/index.ts'
import type { SourceTextReader } from './model.ts'

/** Construct a filesystem reader under one explicit application-owned root. */
export function createNodeSourceTextReader(root: string): SourceTextReader {
  const absoluteRoot = resolve(root)
  return {
    async read(path, options) {
      const admitted = portablePath(path)
      options?.signal?.throwIfAborted()
      return readFile(resolve(absoluteRoot, ...admitted.split('/')), {
        encoding: 'utf8',
        ...(options?.signal ? { signal: options.signal } : {}),
      })
    },
  }
}
