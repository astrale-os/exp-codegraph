import type { ApiCompilation, CompileApiOptions } from './compile.ts'

import { planDeclarationCompilerUniverses } from '../api/project.ts'

/**
 * Plan worker batches from semantic compatibility. Explicit caller batch bounds and any planner
 * uncertainty retain deterministic fixed-capacity fallback; aggregate overflow still recursively
 * splits through the canonical isolated path.
 */
export const API_COMPILER_OPTIMIZATION = {
  fallbackMaximumBatchEntries: 32,
  batchOutputExceeded(results: readonly ApiCompilation[]): boolean {
    return results.every((result) =>
      result.diagnostics.some(
        (entry) =>
          entry.code === 'isolation/output-limit' &&
          entry.message.startsWith('API compiler batch exceeded its '),
      ),
    )
  },
  plan(
    requests: readonly CompileApiOptions[],
    explicitMaximum?: number,
  ): {
    readonly batches: readonly (readonly number[])[]
    readonly outcome: 'compatible' | 'explicit' | 'fallback' | 'diagnostics-universe'
  } {
    const maximum = positiveInteger(explicitMaximum, this.fallbackMaximumBatchEntries)
    if (explicitMaximum !== undefined) {
      return { batches: fixedBatches(requests.length, maximum), outcome: 'explicit' }
    }
    if (requests.every((request) => request.declarationModel === false)) {
      return {
        batches: requests.length ? [Array.from(requests.keys())] : [],
        outcome: 'diagnostics-universe',
      }
    }
    try {
      const planned = planDeclarationCompilerUniverses(requests)
      return { batches: planned.length ? planned : [], outcome: 'compatible' }
    } catch {
      // Planner uncertainty retains the deterministic bounded fallback.
      return { batches: fixedBatches(requests.length, maximum), outcome: 'fallback' }
    }
  },
} as const

function fixedBatches(length: number, maximum: number): readonly (readonly number[])[] {
  const batches: number[][] = []
  for (let index = 0; index < length; index += maximum) {
    batches.push(
      Array.from({ length: Math.min(maximum, length - index) }, (_, offset) => index + offset),
    )
  }
  return batches
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}
