import type { ApiCompilation, CompileApiOptions } from './compile.ts'
import type { ApiBatchCompiler, ApiCompiler } from './contract.ts'

interface PendingCompilation {
  readonly options: CompileApiOptions
  readonly resolve: (compilation: ApiCompilation) => void
}

export interface ApiCompilerCoalescingOptions {
  readonly schedule?: (flush: () => void) => void
}

/**
 * Adapt a batch compiler to the ordinary compiler contract.
 *
 * Calls made in the same event-loop turn form one semantic compilation session. The batch
 * backend remains replaceable; callers and resource loaders retain the single-entry contract.
 */
export function createCoalescingApiCompiler(
  compiler: ApiBatchCompiler,
  options: ApiCompilerCoalescingOptions = {},
): ApiCompiler {
  let pending: PendingCompilation[] = []
  let scheduled = false
  const schedule = options.schedule ?? ((flush: () => void) => setImmediate(flush))

  const flush = async (): Promise<void> => {
    scheduled = false
    const batch = pending
    pending = []
    let results: readonly ApiCompilation[]
    try {
      results = await compiler.compileMany(batch.map(({ options }) => options))
      if (results.length !== batch.length) {
        throw new Error(
          `API batch compiler returned ${results.length} results for ${batch.length} requests.`,
        )
      }
    } catch (error) {
      results = batch.map(() => failed(error))
    }
    for (const [index, item] of batch.entries()) item.resolve(results[index]!)
  }

  return {
    compile(options) {
      return new Promise((resolve) => {
        pending.push({ options, resolve })
        if (scheduled) return
        scheduled = true
        schedule(() => void flush())
      })
    },
  }
}

function failed(error: unknown): ApiCompilation {
  return {
    ok: false,
    diagnostics: [
      {
        source: 'api',
        code: 'API_BATCH_COMPILE_FAILED',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  }
}
