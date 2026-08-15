import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'

const exec = promisify(execFile)

const GLOBAL_INPUTS = new Set([
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
])

export type ChangedSpecificationScope =
  | { readonly kind: 'none'; readonly files: readonly string[]; readonly base: string }
  | {
      readonly kind: 'full'
      readonly files: readonly string[]
      readonly base: string
      readonly triggers: readonly string[]
    }
  | {
      readonly kind: 'selected'
      readonly files: readonly string[]
      readonly base: string
      readonly targets: readonly string[]
    }

/** Resolve committed and local Git changes into their nearest specification owners. */
export async function changedSpecificationScope(
  root: string,
  requestedBase?: string,
): Promise<ChangedSpecificationScope> {
  const workspace = await git(root, ['rev-parse', '--show-toplevel'])
  const catalogPrefix = await git(root, ['rev-parse', '--show-prefix'])
  const catalogRoot = resolve(workspace, ...catalogPrefix.split('/').filter(Boolean))
  const base = requestedBase ?? (await defaultBase(workspace))
  await git(workspace, ['rev-parse', '--verify', `${base}^{commit}`])

  const [committed, local, untracked] = await Promise.all([
    base === 'HEAD'
      ? Promise.resolve('')
      : git(workspace, ['diff', '--no-renames', '--name-only', '-z', `${base}...HEAD`]),
    git(workspace, ['diff', '--no-renames', '--name-only', '-z', 'HEAD']),
    git(workspace, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const files = [...new Set([...paths(committed), ...paths(local), ...paths(untracked)])].sort(
    compare,
  )
  if (!files.length) return { kind: 'none', files, base }
  const typeScriptConfigs = await typeScriptConfigurationInputs(workspace)
  const globalTriggers = files.filter(
    (file) => globalInput(file) || typeScriptConfigs.has(resolve(workspace, ...file.split('/'))),
  )
  if (globalTriggers.length) return { kind: 'full', files, base, triggers: globalTriggers }
  for (const file of files) {
    if (specificationAnchor(file) && !(await isFile(resolve(workspace, ...file.split('/'))))) {
      return { kind: 'full', files, base, triggers: [file] }
    }
  }

  const targets = new Set<string>()
  for (const file of files) {
    const owner = await nearestSpecificationOwner(workspace, file)
    if (!owner) continue
    const ownerPath = resolve(workspace, ...owner.path.split('/'))
    if (!within(catalogRoot, ownerPath)) continue
    targets.add(portable(relative(catalogRoot, ownerPath)) || '.')
  }
  if (!targets.size) return { kind: 'none', files, base }
  return { kind: 'selected', files, base, targets: [...targets].sort(compare) }
}

async function defaultBase(root: string): Promise<string> {
  const environmentBase = process.env.GITHUB_BASE_REF || process.env.SPEC_BASE
  const currentBranch = await optionalGit(root, ['branch', '--show-current'])
  if (environmentBase) {
    const remote = `origin/${environmentBase}`
    if (await gitRefIsAncestor(root, remote)) return remote
    if (environmentBase !== currentBranch && (await gitRefIsAncestor(root, environmentBase))) {
      return environmentBase
    }
  }
  const refs = pathsByLine(
    await git(root, [
      'for-each-ref',
      '--format=%(refname:short)',
      '--merged=HEAD',
      'refs/remotes/origin',
    ]),
  ).filter((ref) => ref !== 'origin/HEAD')
  const candidates = await Promise.all(
    refs.map(async (ref) => ({
      ref,
      distance: Number(await git(root, ['rev-list', '--count', `${ref}..HEAD`])),
    })),
  )
  const ranked = candidates
    .filter(
      ({ ref, distance }) =>
        !(currentBranch && ref === `origin/${currentBranch}` && distance === 0),
    )
    .sort((left, right) => left.distance - right.distance || compare(left.ref, right.ref))
  if (ranked[0]) return ranked[0].ref

  for (const candidate of ['origin/main', 'origin/master']) {
    if (await gitRefExists(root, candidate)) return candidate
  }
  return 'HEAD'
}

async function nearestSpecificationOwner(
  root: string,
  source: string,
): Promise<{ readonly path: string } | undefined> {
  const normalized = source.split('/').join(sep)
  let directory = dirname(resolve(root, normalized))
  while (within(root, directory)) {
    if (await isFile(resolve(directory, '.spec/api.d.ts'))) {
      return { path: portable(relative(root, directory)) || '.' }
    }
    if (directory === resolve(root)) break
    directory = dirname(directory)
  }
  return undefined
}

function globalInput(file: string): boolean {
  return (
    GLOBAL_INPUTS.has(file) ||
    file.endsWith('/package.json') ||
    /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(file) ||
    /(?:^|\/)\.spec\/(?:schemas|packages)\//u.test(file) ||
    file === 'spec' ||
    file.startsWith('spec/')
  )
}

async function typeScriptConfigurationInputs(root: string): Promise<ReadonlySet<string>> {
  const listed = paths(
    await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
  ).filter((file) => /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(file))
  const inputs = new Set<string>()
  const pending = listed.map((file) => resolve(root, ...file.split('/')))
  while (pending.length) {
    const file = resolve(pending.pop()!)
    if (inputs.has(file)) continue
    inputs.add(file)
    const text = ts.sys.readFile(file)
    if (text === undefined) continue
    const parsed = ts.parseConfigFileTextToJson(file, text).config as
      | { readonly extends?: string | readonly string[] }
      | undefined
    const extended = Array.isArray(parsed?.extends)
      ? parsed.extends
      : typeof parsed?.extends === 'string'
        ? [parsed.extends]
        : []
    for (const reference of extended) {
      if (!reference.startsWith('.') && !reference.startsWith('/')) continue
      const target = resolve(dirname(file), reference)
      const candidate = target.endsWith('.json') ? target : `${target}.json`
      pending.push(candidate)
    }
  }
  return inputs
}

function specificationAnchor(file: string): boolean {
  return (
    file === '.spec/api.d.ts' ||
    file.endsWith('/.spec/api.d.ts')
  )
}

async function gitRefExists(root: string, ref: string): Promise<boolean> {
  try {
    await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function gitRefIsAncestor(root: string, ref: string): Promise<boolean> {
  if (!(await gitRefExists(root, ref))) return false
  try {
    await git(root, ['merge-base', '--is-ancestor', ref, 'HEAD'])
    return true
  } catch {
    return false
  }
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

async function optionalGit(root: string, args: readonly string[]): Promise<string> {
  try {
    return await git(root, args)
  } catch {
    return ''
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function paths(value: string): string[] {
  return value.split('\0').filter(Boolean).map(portable)
}

function pathsByLine(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function within(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
