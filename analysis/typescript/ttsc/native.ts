import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { TtscCompiler } from 'ttsc'

export const QUALIFIED_TTSC_VERSION = '0.25.0' as const

export interface TtscNativeAnalysisOptions {
  /** Absolute repository/project root used for project and cache resolution. */
  readonly root: string
  /** Project-root-relative TypeScript configuration used to anchor ttsc. */
  readonly config: string
  /** Optional application-owned ttsc cache directory. */
  readonly cacheDirectory?: string
  /** Explicit qualified binary, primarily for controlled CI and release qualification. */
  readonly binary?: string
  /** Environment additions passed only to ttsc's compiler/plugin processes. */
  readonly environment?: NodeJS.ProcessEnv
}

export interface ResolvedTtscNativeAnalysis {
  readonly command: string
  readonly sha256: string
  readonly ttscVersion: typeof QUALIFIED_TTSC_VERSION
  readonly origin: 'explicit' | 'ttsc-cache'
}

const prepared = new Map<string, Promise<ResolvedTtscNativeAnalysis>>()

/** Resolve one executable native analyzer through ttsc's public source-plugin cache lifecycle. */
export function resolveTtscNativeAnalysis(
  options: TtscNativeAnalysisOptions,
): Promise<ResolvedTtscNativeAnalysis> {
  const root = resolve(options.root)
  const binary = options.binary ? resolve(options.binary) : undefined
  const key = JSON.stringify({
    root,
    config: options.config,
    cacheDirectory: options.cacheDirectory ? resolve(options.cacheDirectory) : undefined,
    binary,
    environment: canonicalEnvironment(options.environment),
  })
  const existing = prepared.get(key)
  if (existing) return existing
  const pending = prepare({ ...options, root, ...(binary ? { binary } : {}) })
  prepared.set(key, pending)
  void pending.catch(() => prepared.delete(key))
  return pending
}

async function prepare(
  options: TtscNativeAnalysisOptions & { readonly root: string },
): Promise<ResolvedTtscNativeAnalysis> {
  await assertTtscVersion()
  if (options.binary) {
    await assertExecutable(options.binary)
    return {
      command: options.binary,
      sha256: digest(await readFile(options.binary)),
      ttscVersion: QUALIFIED_TTSC_VERSION,
      origin: 'explicit',
    }
  }

  const compiler = new TtscCompiler({
    cwd: options.root,
    projectRoot: options.root,
    tsconfig: options.config,
    ...(options.cacheDirectory ? { cacheDir: resolve(options.cacheDirectory) } : {}),
    ...(options.environment ? { env: { ...options.environment } } : {}),
    plugins: [{ transform: pluginDescriptor() }],
  })
  const binaries = compiler.prepare()
  if (binaries.length !== 1) {
    throw new Error(`TypeSpec native analysis expected one ttsc binary; received ${binaries.length}.`)
  }
  const command = resolve(binaries[0]!)
  await assertExecutable(command)
  return {
    command,
    sha256: digest(await readFile(command)),
    ttscVersion: QUALIFIED_TTSC_VERSION,
    origin: 'ttsc-cache',
  }
}

async function assertTtscVersion(): Promise<void> {
  const require = createRequire(import.meta.url)
  const manifest = JSON.parse(await readFile(require.resolve('ttsc/package.json'), 'utf8')) as {
    readonly version?: unknown
  }
  if (manifest.version !== QUALIFIED_TTSC_VERSION) {
    throw new Error(
      `TypeSpec native analysis requires ttsc ${QUALIFIED_TTSC_VERSION}; resolved ${String(manifest.version)}.`,
    )
  }
}

async function assertExecutable(path: string): Promise<void> {
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`TypeSpec native analysis binary is not a file: ${path}`)
}

function pluginDescriptor(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidate = resolve(here, '../../..')
  const packageRoot = basename(candidate) === 'dist' ? dirname(candidate) : candidate
  return resolve(packageRoot, 'analysis/typescript/ttsc/plugin.cjs')
}

function canonicalEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
): readonly (readonly [string, string | undefined])[] | undefined {
  return environment
    ? Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))
    : undefined
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
