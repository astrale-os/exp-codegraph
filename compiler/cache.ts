import { dirname, isAbsolute, resolve } from 'node:path'

import type { ApiSource, ApiToken } from '../api/model.ts'
import type { ApiCompilation } from './compile.ts'
import type { ApiCompiler } from './contract.ts'

import {
  operationSnapshot,
  operationSnapshotNamespace,
  withOperationSnapshot,
} from '../source/operation-snapshot.ts'
import { DEFAULT_DECLARATION_SURFACE_SEMANTICS } from '../typescript/surface/semantics.ts'

export interface ApiCompilerCacheDependencies {
  read(file: string): Promise<string>
  revision(text: string): string
}

export interface ApiCompilerCacheOptions {
  readonly capacity?: number
}

interface CachedCompilation {
  readonly compilation: ApiCompilation
}

export interface CachedApiCompiler extends ApiCompiler {
  /** Reuse dependency revisions only within one logically coherent catalog read. */
  withRevisionSnapshot<T>(operation: () => Promise<T>): Promise<T>
}

/** Add dependency-validated, bounded memoization without changing compiler semantics. */
export function createCachedApiCompiler(
  compiler: ApiCompiler,
  dependencies: ApiCompilerCacheDependencies,
  options: ApiCompilerCacheOptions = {},
): CachedApiCompiler {
  // A repository catalog commonly contains several hundred public declarations and Ports. The
  // cache must hold one complete rebuild wave or deterministic traversal order will evict the
  // entries that the next wave needs just before it reaches them.
  const capacity = positiveInteger(options.capacity, 512)
  const cache = new Map<string, CachedCompilation>()
  const sourcePool = new Map<string, ApiSource>()
  const tokenPool = new Map<string, readonly (readonly ApiToken[])[]>()
  const revisionNamespace = operationSnapshotNamespace<Promise<string>>('api-compiler-revisions')
  const compilationNamespace =
    operationSnapshotNamespace<Promise<ApiCompilation>>('api-compiler-results')

  const currentRevision = (file: string): Promise<string> => {
    const revisions = operationSnapshot(revisionNamespace)
    if (!revisions) return dependencies.read(file).then(dependencies.revision)
    const running = revisions.get(file)
    if (running) return running
    const revision = dependencies.read(file).then(dependencies.revision)
    revisions.set(file, revision)
    return revision
  }

  return {
    withRevisionSnapshot(operation) {
      return withOperationSnapshot(operation)
    },
    async compile(request) {
      const projectRoot = resolve(request.projectRoot ?? dirname(request.mainFile))
      const semantics = request.semantics ?? DEFAULT_DECLARATION_SURFACE_SEMANTICS
      const key = `${projectRoot}\0${semantics}\0${resolve(request.mainFile)}`
      const operationCompilations = operationSnapshot(compilationNamespace)
      const operationCompilation = operationCompilations?.get(key)
      if (operationCompilation) return operationCompilation
      const cached = cache.get(key)
      if (cached && (await isCurrent(cached.compilation, projectRoot, currentRevision))) {
        cache.delete(key)
        cache.set(key, cached)
        operationCompilations?.set(key, Promise.resolve(cached.compilation))
        return cached.compilation
      }
      cache.delete(key)

      // Coalesce only within one coherent operation. A later rebuild may observe a newer source
      // revision while an earlier compilation is still running and must not inherit that result.
      const running = operationCompilations?.get(key)
      if (running) return running
      const compilation = compiler.compile(request)
      operationCompilations?.set(key, compilation)
      const result = internCompilation(await compilation, projectRoot, sourcePool, tokenPool)
      if (isCacheable(result)) {
        cache.set(key, { compilation: result })
        while (cache.size > capacity) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
      }
      return result
    },
  }
}

function internCompilation(
  compilation: ApiCompilation,
  projectRoot: string,
  sourcePool: Map<string, ApiSource>,
  tokenPool: Map<string, readonly (readonly ApiToken[])[]>,
): ApiCompilation {
  const api = compilation.api
  if (!api) return compilation
  const tokensByFile = new Map<string, ApiToken[]>()
  for (const token of api.tokens) {
    const values = tokensByFile.get(token.file) ?? []
    values.push(token)
    tokensByFile.set(token.file, values)
  }
  const sources = api.sources.map((source) => {
    const key = `${projectRoot}\0${resolve(projectRoot, source.file)}\0${source.revision}`
    return remember(sourcePool, key, source, 2_048)
  })
  const tokens = sources.flatMap((source) => {
    const values = tokensByFile.get(source.file) ?? []
    const key = `${projectRoot}\0${resolve(projectRoot, source.file)}\0${source.revision}`
    return rememberTokens(tokenPool, key, values, 2_048)
  })
  return { ...compilation, api: { ...api, sources, tokens } }
}

function remember<Value>(
  values: Map<string, Value>,
  key: string,
  value: Value,
  capacity: number,
): Value {
  const existing = values.get(key)
  if (existing !== undefined) {
    values.delete(key)
    values.set(key, existing)
    return existing
  }
  values.set(key, value)
  while (values.size > capacity) {
    const oldest = values.keys().next().value
    if (oldest === undefined) break
    values.delete(oldest)
  }
  return value
}

function rememberTokens(
  pool: Map<string, readonly (readonly ApiToken[])[]>,
  key: string,
  tokens: readonly ApiToken[],
  capacity: number,
): readonly ApiToken[] {
  const maxVariants = 32
  const variants = pool.get(key) ?? []
  const existing = variants.find((candidate) => equalTokens(candidate, tokens))
  pool.delete(key)
  pool.set(key, existing ? variants : [...variants.slice(1 - maxVariants), tokens])
  while (pool.size > capacity) {
    const oldest = pool.keys().next().value
    if (oldest === undefined) break
    pool.delete(oldest)
  }
  return existing ?? tokens
}

function equalTokens(left: readonly ApiToken[], right: readonly ApiToken[]): boolean {
  return (
    left.length === right.length &&
    left.every((token, index) => {
      const candidate = right[index]!
      return (
        token.file === candidate.file &&
        token.from === candidate.from &&
        token.to === candidate.to &&
        token.text === candidate.text &&
        token.declaration === candidate.declaration &&
        token.target === candidate.target
      )
    })
  )
}

async function isCurrent(
  compilation: ApiCompilation,
  projectRoot: string,
  revision: (file: string) => Promise<string>,
): Promise<boolean> {
  if (!compilation.dependencies?.length) return false
  try {
    for (const dependency of compilation.dependencies) {
      const file = isAbsolute(dependency.file)
        ? dependency.file
        : resolve(projectRoot, dependency.file)
      if ((await revision(file)) !== dependency.revision) return false
    }
    return true
  } catch {
    return false
  }
}

function isCacheable(compilation: ApiCompilation): boolean {
  if (!compilation.dependencies?.length) return false
  return (
    compilation.ok ||
    compilation.diagnostics.every(
      (diagnostic) => diagnostic.source === 'api' && diagnostic.code !== 'API_COMPILE_FAILED',
    )
  )
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}
