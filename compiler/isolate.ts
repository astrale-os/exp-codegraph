import type { ApiCompilation, CompileApiOptions } from './compile.ts'

import { createTaskLimiter } from './limit.ts'
import { API_COMPILER_OPTIMIZATION } from './isolation.optimization.ts'
import { compileApisInIsolatedWorker } from './isolation-process.optimization.ts'
import { recordApiCompilerIsolationWork } from './isolation-work.optimization.ts'

export interface IsolatedCompileApiOptions extends CompileApiOptions {
  readonly timeoutMs?: number
  readonly maxOldSpaceMegabytes?: number
}

export interface IsolatedApiBatchOptions {
  /**
   * Explicit hard wall-clock deadline for one worker batch after it owns a worker slot.
   * When omitted, the default per-entrypoint budget scales with the bounded batch size.
   */
  readonly timeoutMs?: number
  readonly maxOldSpaceMegabytes?: number
  /** Maximum entrypoints compiled by one memory-bounded worker. */
  readonly maxBatchEntries?: number
  /** Maximum serialized size of one compilation result, not of the complete batch. */
  readonly maxResultBytes?: number
  /** Maximum serialized output retained for one complete worker batch. */
  readonly maxBatchResultBytes?: number
}

/** Shared load and worker capacity; large enough to amortize one TypeScript project construction. */
export const API_COMPILER_BATCH_CAPACITY = API_COMPILER_OPTIMIZATION.fallbackMaximumBatchEntries
// Each worker may consume its full old-space allowance. Keep the aggregate bounded, and start
// an individual compilation deadline only after that compilation owns a worker slot.
const MAX_CONCURRENT_WORKERS = 4
const workers = createTaskLimiter(MAX_CONCURRENT_WORKERS)
/**
 * Compile an untrusted API in a disposable, memory-bounded process.
 *
 * The worker uses the bounded native declaration compiler; the process boundary adds a hard
 * deadline and prevents compiler memory exhaustion from taking down the specification server.
 */
export async function compileApiIsolated(
  options: IsolatedCompileApiOptions,
): Promise<ApiCompilation> {
  return (await compileApisIsolated([options], options))[0]!
}

export async function compileApisIsolated(
  options: readonly CompileApiOptions[],
  isolation: IsolatedApiBatchOptions = {},
): Promise<readonly ApiCompilation[]> {
  if (!options.length) return []
  const explicitIsolation = [
    isolation.timeoutMs,
    isolation.maxOldSpaceMegabytes,
    isolation.maxBatchEntries,
    isolation.maxResultBytes,
    isolation.maxBatchResultBytes,
  ].some((value) => value !== undefined)
  const plan = API_COMPILER_OPTIMIZATION.plan(
    options,
    explicitIsolation
      ? positiveInteger(isolation.maxBatchEntries, API_COMPILER_BATCH_CAPACITY)
      : undefined,
  )
  recordApiCompilerIsolationWork({ plannerFallbacks: plan.outcome === 'fallback' ? 1 : 0 })
  const output = new Array<ApiCompilation>(options.length)
  await Promise.all(
    plan.batches.map(async (indexes) => {
      const results = await compileBatch(indexes.map((index) => options[index]!), isolation)
      for (const [offset, result] of results.entries()) output[indexes[offset]!] = result
    }),
  )
  return output
}

async function compileBatch(
  options: readonly CompileApiOptions[],
  isolation: IsolatedApiBatchOptions,
  retry = false,
): Promise<readonly ApiCompilation[]> {
  recordApiCompilerIsolationWork({ sessions: 1, programs: 1, retries: retry ? 1 : 0 })
  const results = await workers.run(() => compileApisInIsolatedWorker(options, isolation))
  if (options.length < 2 || !API_COMPILER_OPTIMIZATION.batchOutputExceeded(results)) return results
  // The aggregate limit protects parent memory, not entrypoint validity. Retry smaller batches so
  // individually bounded results never change meaning based on their neighboring entrypoints.
  const middle = Math.ceil(options.length / 2)
  const [left, right] = await Promise.all([
    compileBatch(options.slice(0, middle), isolation, true),
    compileBatch(options.slice(middle), isolation, true),
  ])
  return [...left, ...right]
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}
