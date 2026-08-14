import { spawn } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { TypeSpecApplicationReader } from '../application/index.ts'
import type { SourceEditRequest, SourceEditResponse } from '../application/interaction/editing.ts'
import type { SpecRevealResponse } from '../application/interaction/reveal.ts'
import { SPEC_REVEAL_PROTOCOL } from '../application/interaction/reveal.ts'
import { readBounded, replaceBounded } from '../source/file.ts'

/** Save only an authored source declared by the pinned application snapshot. */
export async function saveApplicationSource(
  root: string,
  reader: TypeSpecApplicationReader,
  request: SourceEditRequest,
): Promise<SourceEditResponse> {
  if (!editableApplicationSources(reader).has(request.source)) {
    return { status: 'error', message: 'Specification source not found.' }
  }
  const target = contained(root, request.source)
  if (!target) return { status: 'error', message: 'Specification source not found.' }
  const result = await replaceBounded(target, request.text, request.revision)
  return result.status === 'conflict'
    ? { ...result, text: await readBounded(target) }
    : result
}

/** Reveal an exact application-owned specification anchor, never an arbitrary client path. */
export async function revealApplicationSpecification(
  root: string,
  reader: TypeSpecApplicationReader,
  source: string,
  reveal: (file: string, directory: string) => Promise<void> = revealInFileManager,
): Promise<SpecRevealResponse> {
  const specification = reader.snapshot.specifications.find((candidate) => candidate.source === source)
  if (!specification) return rejected('SOURCE_NOT_FOUND', 'Specification source not found.')
  const target = contained(root, specification.source)
  if (!target) return rejected('SOURCE_NOT_FOUND', 'Specification source not found.')
  try {
    await reveal(target, dirname(target))
    return { protocol: SPEC_REVEAL_PROTOCOL, status: 'revealed', source }
  } catch (error) {
    return rejected(
      'REVEAL_FAILED',
      error instanceof Error ? error.message : 'Could not open the specification folder.',
    )
  }
}

function editableApplicationSources(reader: TypeSpecApplicationReader): ReadonlySet<string> {
  const sources = new Set<string>()
  for (const specification of reader.snapshot.specifications) {
    for (const resource of [
      ...(specification.module.api ? [specification.module.api] : []),
      ...(specification.module.code ? [specification.module.code] : []),
      ...(specification.module.internal ? [specification.module.internal] : []),
      ...specification.module.ports,
      ...specification.schemas,
      ...specification.examples,
      ...specification.capabilities,
      ...specification.flows,
      ...specification.laws,
      ...specification.states,
      ...(specification.limits ? [specification.limits] : []),
      ...(specification.layout ? [specification.layout] : []),
      ...specification.benchmarks,
      ...specification.packages,
      ...specification.packagePatterns,
    ]) sources.add(resource.source)
    sources.add(specification.source.replace(/api\.d\.ts$/u, 'architecture.md'))
    sources.add(specification.source.replace(/api\.d\.ts$/u, 'icon.svg'))
  }
  return sources
}

function contained(root: string, source: string): string | undefined {
  if (!source || isAbsolute(source) || source.includes('\\')) return
  const target = resolve(root, source)
  const path = relative(resolve(root), target)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return
  return target
}

function rejected(
  code: Extract<SpecRevealResponse, { status: 'rejected' }>['code'],
  message: string,
): Extract<SpecRevealResponse, { status: 'rejected' }> {
  return { protocol: SPEC_REVEAL_PROTOCOL, status: 'rejected', code, message }
}

async function revealInFileManager(file: string, directory: string): Promise<void> {
  if (process.platform === 'darwin') return launch('open', ['-R', file])
  if (process.platform === 'win32') return launch('explorer.exe', [`/select,${file}`])
  return launch('xdg-open', [directory])
}

function launch(command: string, arguments_: string[]): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(command, arguments_, { detached: true, stdio: 'ignore' })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch()
    })
  })
}
