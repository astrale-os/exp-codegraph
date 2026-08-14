import type { NativeAnalysisSessionFactory } from '../../analysis/index.ts'

import { createProcessNativeAnalysisSessionFactory } from '../../analysis/index.ts'
import { resolveTtscNativeAnalysis } from '../../analysis/typescript/ttsc/index.ts'

export interface TtscApplicationSessionOptions {
  readonly binary?: string
  readonly cacheDirectory?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly maximumFrameBytes?: number
  readonly maximumTransactionBytes?: number
}

/** Lazily resolve the qualified ttsc plugin when the first implementation project is analyzed. */
export function createTtscApplicationSessionFactory(
  options: TtscApplicationSessionOptions = {},
): NativeAnalysisSessionFactory {
  return {
    async open(project, openOptions) {
      openOptions?.signal?.throwIfAborted()
      const native = await resolveTtscNativeAnalysis({
        root: project.root,
        config: project.config,
        ...(options.binary ? { binary: options.binary } : {}),
        ...(options.cacheDirectory ? { cacheDirectory: options.cacheDirectory } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
      })
      openOptions?.signal?.throwIfAborted()
      return createProcessNativeAnalysisSessionFactory({
        command: native.command,
        ...(options.maximumFrameBytes !== undefined
          ? { maximumFrameBytes: options.maximumFrameBytes }
          : {}),
        ...(options.maximumTransactionBytes !== undefined
          ? { maximumTransactionBytes: options.maximumTransactionBytes }
          : {}),
        ...(options.environment
          ? { environment: definedEnvironment(options.environment) }
          : {}),
      }).open(project, openOptions)
    },
  }
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}
