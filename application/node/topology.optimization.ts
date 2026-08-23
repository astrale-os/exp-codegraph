import { opendir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { repositoryDirectoryExcluded } from '../../repository/model.ts'

const MAXIMUM_CONCURRENT_DIRECTORY_READS = 16

/** Read independent directory levels concurrently while retaining one canonical path order. */
export async function scanRepositoryDirectories(
  root: string,
  exclude: readonly string[],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const absolute = resolve(root)
  const directories: string[] = []
  let pending = ['']
  while (pending.length) {
    const wave = pending
    pending = []
    const children = await mapConcurrent(wave, MAXIMUM_CONCURRENT_DIRECTORY_READS, async (path) => {
      signal?.throwIfAborted()
      const directory = await opendir(path ? join(absolute, path) : absolute)
      const values: string[] = []
      for await (const entry of directory) {
        signal?.throwIfAborted()
        if (!entry.isDirectory()) continue
        const child = path ? `${path}/${entry.name}` : entry.name
        if (
          child === '.git' ||
          child.startsWith('.git/') ||
          repositoryDirectoryExcluded(child, exclude)
        ) {
          continue
        }
        values.push(child)
      }
      return values
    })
    for (const path of children.flat()) {
      directories.push(path)
      pending.push(path)
    }
  }
  return directories.sort(compare)
}

async function mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  maximum: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(inputs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(maximum, inputs.length) }, async () => {
      while (true) {
        const index = next++
        if (index >= inputs.length) return
        output[index] = await operation(inputs[index]!)
      }
    }),
  )
  return output
}

function compare(left: string, right: string): number {
  return left.localeCompare(right)
}
