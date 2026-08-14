import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const MINIMUM_MODULE_SPEC = `/**
 * Authoritative public contract for this module.
 * Add exports only when they are intentional downstream API.
 */
export {}
`

/** Create the irreducible module specification without manufacturing optional artifacts. */
export async function initializeModuleSpecification(directory: string): Promise<string> {
  const root = resolve(directory)
  const specification = join(root, '.spec')
  const api = join(specification, 'api.d.ts')
  try {
    const existing = await lstat(specification)
    if (existing.isSymbolicLink()) {
      throw new Error(`Module specification directory cannot be a symbolic link: ${specification}`)
    }
    if (!existing.isDirectory()) {
      throw new Error(`Module specification path is not a directory: ${specification}`)
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await mkdir(specification, { recursive: true })
  try {
    await writeFile(api, MINIMUM_MODULE_SPEC, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (isExists(error)) {
      throw new Error(`Module specification already exists: ${api}`)
    }
    throw error
  }
  return api
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT',
  )
}

function isExists(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST',
  )
}
