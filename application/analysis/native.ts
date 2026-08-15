import type { NativeAnalysisSessionFactory } from '../../analysis/index.ts'

import { createProcessNativeAnalysisSessionFactory } from '../../analysis/index.ts'
import { resolvePackagedNativeAnalysis } from '../../analysis/typescript/distribution/index.ts'
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../../analysis/typescript/index.ts'

export interface CodegraphApplicationSessionOptions {
  readonly binary?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly maximumFrameBytes?: number
  readonly transactionChunkFrameBytes?: number
  readonly maximumTransactionBytes?: number
}

/** Lazily admit the packaged or explicit native analyzer when a project is first analyzed. */
export function createCodegraphApplicationSessionFactory(
  options: CodegraphApplicationSessionOptions = {},
): NativeAnalysisSessionFactory {
  return {
    async open(project, openOptions) {
      openOptions?.signal?.throwIfAborted()
      const native = await resolvePackagedNativeAnalysis({
        ...(options.binary ? { binary: options.binary } : {}),
      })
      openOptions?.signal?.throwIfAborted()
      return createProcessNativeAnalysisSessionFactory({
        command: native.command,
        payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS,
        ...(options.maximumFrameBytes !== undefined
          ? { maximumFrameBytes: options.maximumFrameBytes }
          : {}),
        ...(options.transactionChunkFrameBytes !== undefined
          ? { transactionChunkFrameBytes: options.transactionChunkFrameBytes }
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
