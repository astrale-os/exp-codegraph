import type { FactTransaction } from '../generation/index.ts'
import type { AnalysisGenerationId } from '../identity/index.ts'

export const NATIVE_ANALYSIS_PROTOCOL_VERSION = 1

export interface NativeModuleBoundary {
  readonly id: string
  readonly name: string
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  readonly facades: readonly string[]
  readonly aliases: readonly string[]
  readonly internals: readonly string[]
}

export interface NativeProjectDescriptor {
  /** Requested project inputs only; the loaded compiler derives the universe. */
  readonly root: string
  readonly config: string
  readonly capabilities: readonly string[]
  readonly modules?: readonly NativeModuleBoundary[]
}

export type NativeAnalysisRequest =
  | {
      readonly id: number
      readonly kind: 'refresh'
      readonly base?: AnalysisGenerationId
      readonly changed?: readonly string[]
      readonly invalidate?: boolean
    }
  | { readonly id: number; readonly kind: 'dispose' }

export type NativeAnalysisResponse =
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'transaction'
      readonly transaction: FactTransaction
    }
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'unchanged'
      readonly generation: AnalysisGenerationId
    }
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'error'
      readonly code: string
      readonly message: string
      readonly retryable: boolean
    }

export interface NativeAnalysisSession {
  dispose(): Promise<void>
  request(
    request: NativeAnalysisRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NativeAnalysisResponse>
}

export interface NativeAnalysisSessionFactory {
  open(
    project: NativeProjectDescriptor,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NativeAnalysisSession>
}
