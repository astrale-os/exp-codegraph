import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface LocatedResource {
  readonly absolute: string
  readonly source: string
}

export async function locateResource(
  root: string,
  containingFile: string,
  reference: string,
  suffix: string,
): Promise<LocatedResource> {
  validateReference(reference, suffix)
  const catalogRoot = await realpath(resolve(root))
  const containingDirectory = await realpath(dirname(containingFile))
  const candidate = resolve(containingDirectory, ...reference.split('/'))
  if (!within(catalogRoot, candidate))
    throw new Error('Resource reference escapes the catalog root.')
  await rejectSymbolicPath(catalogRoot, candidate)
  const absolute = await realpath(candidate)
  if (!within(catalogRoot, absolute)) throw new Error('Resource resolves outside the catalog root.')
  return { absolute, source: portable(relative(catalogRoot, absolute)) }
}

function validateReference(reference: string, suffix: string): void {
  if (
    !reference ||
    isAbsolute(reference) ||
    /^[A-Za-z]:/.test(reference) ||
    reference.includes('\\') ||
    reference.includes('#') ||
    reference.includes('?') ||
    [...reference].some((character) => isControl(character.codePointAt(0)!))
  ) {
    throw new Error(
      'Resource references must be relative POSIX paths without query or fragment components.',
    )
  }
  if (!reference.endsWith(suffix)) throw new Error(`Resource reference must end with ${suffix}.`)
}

async function rejectSymbolicPath(root: string, target: string): Promise<void> {
  let current = root
  for (const segment of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('Resource reference paths cannot contain symbolic links.')
    }
  }
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}
