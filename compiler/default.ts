import { readBounded, sourceRevision } from '../source/file.ts'
import { createCachedApiCompiler } from './cache.ts'
import { createCoalescingApiCompiler } from './coalesce.ts'
import { compileApisIsolated } from './isolate.ts'

const isolatedApiCompiler = createCachedApiCompiler(
  createCoalescingApiCompiler({ compileMany: compileApisIsolated }),
  {
    read: readBounded,
    revision: sourceRevision,
  },
)

/** Process-local declaration compiler and restorable cache lifecycle. */
export const defaultApiCompiler = isolatedApiCompiler

/**
 * Normative declaration port over the isolated project/cache lifecycle.
 * V2 semantics are explicit so no caller can silently fall back to the retired V1 oracle.
 */
export const specificationApiCompiler = {
  compile(options: Parameters<typeof isolatedApiCompiler.compile>[0]) {
    return isolatedApiCompiler.compile({ ...options, semantics: 'specification-v2' })
  },
}
