import { createHash } from 'node:crypto'

import { scanRepositoryDirectories } from './topology.optimization.ts'

export { repositoryDirectoryExcluded } from '../../repository/model.ts'

/** Digest every admitted directory path, including empty optional specification directories. */
export async function repositoryDirectoryTopologyFingerprint(
  root: string,
  exclude: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const directories = await scanRepositoryDirectories(root, exclude, signal)
  return createHash('sha256').update(JSON.stringify(directories)).digest('hex')
}
