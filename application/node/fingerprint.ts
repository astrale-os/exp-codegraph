import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

import {
  createBoundedFileCacheStore,
  defaultTypeSpecCacheDirectory,
} from '../../cache/file-store.ts'

const FINGERPRINT_FORMAT = 'codegraph-runtime-tree/1'
const SOURCE_ENTRIES = [
  'analysis',
  'api',
  'application',
  'authoring',
  'cache',
  'cli',
  'compiler',
  'conformance',
  'json-schema',
  'markdown',
  'reference',
  'repository',
  'schema',
  'server',
  'source',
  'specification',
  'typescript',
  'viewer-host',
  'workspace',
] as const
const ROOT_FILES = ['cli.ts', 'index.ts', 'native-release.json', 'package.json'] as const
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.mjs', '.ts', '.tsx'])

let retained: Promise<string> | undefined

export interface CodegraphProducerFingerprintOptions {
  readonly packageRoot?: string
  readonly mode?: 'source' | 'compiled' | 'auto'
  readonly persistence?: 'advisory' | 'memory'
}

/** Bind advisory checkpoints to the exact executable package tree, not only a release version. */
export function codegraphProducerFingerprint(
  input?: string | CodegraphProducerFingerprintOptions,
): Promise<string> {
  if (typeof input === 'string') return fingerprint(resolve(input), 'auto')
  const [packageRoot, defaultMode] = defaultPackageCoordinates()
  const root = input?.packageRoot ? resolve(input.packageRoot) : packageRoot
  const mode = input?.mode ?? (input?.packageRoot ? 'auto' : defaultMode)
  if (input?.persistence === 'memory' || input?.packageRoot) return fingerprint(root, mode)
  retained ??= persistentFingerprint(...defaultPackageCoordinates())
  return retained
}

async function persistentFingerprint(
  packageRoot: string,
  mode: 'source' | 'compiled',
): Promise<string> {
  const files = await fingerprintFiles(packageRoot, mode)
  const metadata = await metadataFingerprint(packageRoot, files)
  const key = createHash('sha256')
    .update(resolve(packageRoot))
    .update('\0')
    .update(mode)
    .digest('hex')
  const store = createBoundedFileCacheStore({
    directory: join(defaultTypeSpecCacheDirectory(), 'producer-fingerprints'),
    key: `runtime-${key}`,
    maxEntryBytes: 4 * 1024,
    maxTotalBytes: 1 * 1024 * 1024,
    maxEntries: 64,
  })
  const cached = await store.load()
  if (cached) {
    try {
      const value = JSON.parse(cached.toString('utf8')) as {
        readonly format?: unknown
        readonly metadata?: unknown
        readonly fingerprint?: unknown
      }
      if (
        value.format === FINGERPRINT_FORMAT &&
        value.metadata === metadata &&
        typeof value.fingerprint === 'string' &&
        /^@astrale-os\/codegraph:codegraph-runtime-tree\/1:sha256:[a-f0-9]{64}$/u.test(
          value.fingerprint,
        )
      ) {
        return value.fingerprint
      }
    } catch {
      // Corrupt advisory metadata falls through to exact byte hashing.
    }
  }
  const value = await fingerprintFilesContent(packageRoot, files)
  await store.save(
    Buffer.from(
      JSON.stringify({ format: FINGERPRINT_FORMAT, metadata, fingerprint: value }),
      'utf8',
    ),
  )
  return value
}

async function fingerprint(
  packageRoot: string,
  mode: 'source' | 'compiled' | 'auto',
): Promise<string> {
  const files = await fingerprintFiles(packageRoot, mode)
  return fingerprintFilesContent(packageRoot, files)
}

async function fingerprintFiles(
  packageRoot: string,
  mode: 'source' | 'compiled' | 'auto',
): Promise<readonly string[]> {
  const compiled = resolve(packageRoot, 'dist')
  const useCompiled = mode === 'compiled' || (mode === 'auto' && (await directory(compiled)))
  const entries = useCompiled
    ? [compiled, ...ROOT_FILES.map((file) => resolve(packageRoot, file))]
    : [
        ...SOURCE_ENTRIES.map((entry) => resolve(packageRoot, entry)),
        ...ROOT_FILES.map((file) => resolve(packageRoot, file)),
      ]
  const files = (await Promise.all(entries.map((entry) => runtimeFiles(entry))))
    .flat()
    .sort((left, right) => left.localeCompare(right))
  if (!files.length) throw new Error(`Codegraph runtime tree is empty: ${packageRoot}`)
  return files
}

async function fingerprintFilesContent(
  packageRoot: string,
  files: readonly string[],
): Promise<string> {
  const digest = createHash('sha256').update(`${FINGERPRINT_FORMAT}\0`)
  for (const file of files) {
    const path = relative(packageRoot, file).split('\\').join('/')
    digest
      .update(path)
      .update('\0')
      .update(await readFile(file))
      .update('\0')
  }
  return `@astrale-os/codegraph:${FINGERPRINT_FORMAT}:sha256:${digest.digest('hex')}`
}

async function metadataFingerprint(packageRoot: string, files: readonly string[]): Promise<string> {
  const digest = createHash('sha256').update(`${FINGERPRINT_FORMAT}:metadata/1\0`)
  const metadata = await Promise.all(files.map((file) => stat(file, { bigint: true })))
  for (const [index, file] of files.entries()) {
    const value = metadata[index]!
    digest
      .update(relative(packageRoot, file).split('\\').join('/'))
      .update('\0')
      .update(String(value.dev))
      .update('\0')
      .update(String(value.ino))
      .update('\0')
      .update(String(value.size))
      .update('\0')
      .update(String(value.mtimeNs))
      .update('\0')
      .update(String(value.ctimeNs))
      .update('\0')
  }
  return digest.digest('hex')
}

async function runtimeFiles(path: string): Promise<string[]> {
  let metadata
  try {
    metadata = await stat(path)
  } catch {
    return []
  }
  if (metadata.isFile()) return included(path) ? [path] : []
  if (!metadata.isDirectory()) return []
  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.cache') continue
    files.push(...(await runtimeFiles(join(path, entry.name))))
  }
  return files
}

function included(path: string): boolean {
  if (path.endsWith('.map')) return false
  return SOURCE_EXTENSIONS.has(extname(path)) || ROOT_FILES.some((file) => file === basename(path))
}

async function directory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function defaultPackageCoordinates(): [string, 'source' | 'compiled'] {
  const candidate = resolve(import.meta.dirname, '..', '..')
  return basename(candidate) === 'dist' ? [dirname(candidate), 'compiled'] : [candidate, 'source']
}
