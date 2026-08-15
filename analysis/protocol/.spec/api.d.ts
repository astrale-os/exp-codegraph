import type { FactShard } from '../../facts/.spec/api.js'
import type { AnalysisGeneration, FactTransaction } from '../../generation/.spec/api.js'
import type { AnalysisGenerationId, FactShardKey } from '../../identity/.spec/api.js'
import type { AnalysisTelemetrySink } from '../../profiling/.spec/api.js'

export const NATIVE_ANALYSIS_PROTOCOL_VERSION: number

export interface NativeModuleBoundary {
  readonly id: string
  readonly name: string
  readonly project: string
  /** Portable module root; `.` denotes the project root. */
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
      /** Required with `base`; binds restart/adoption to the store's exact sequence. */
      readonly baseSequence?: number
      readonly changed?: readonly string[]
      readonly invalidate?: boolean
    }
  | {
      readonly id: number
      readonly kind: 'acknowledge'
      readonly generation: AnalysisGenerationId
      readonly sequence: number
    }
  | { readonly id: number; readonly kind: 'dispose' }

export interface NativeAnalysisAcknowledgement {
  readonly id: number
  readonly generation: AnalysisGenerationId
  readonly sequence: number
}

/** Wire-efficient affected-shard update; stores reconstruct the complete manifest. */
export interface NativeFactDelta {
  readonly protocolVersion: number
  readonly base: AnalysisGenerationId
  readonly next: AnalysisGeneration
  readonly upserts: readonly FactShard[]
  readonly deletes: readonly FactShardKey[]
}

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
      readonly kind: 'delta'
      readonly delta: NativeFactDelta
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
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'acknowledged'
      readonly generation: AnalysisGenerationId
    }

/** One framed, cancellation-aware native session; transport owns no global process state. */
export interface NativeAnalysisSession {
  dispose(): Promise<void>
  request(
    request: NativeAnalysisRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NativeAnalysisResponse>
  /** Atomically publish a transaction only after the application store commits it. */
  acknowledge?(
    acknowledgement: NativeAnalysisAcknowledgement,
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>
}

export interface NativeAnalysisSessionFactory {
  open(
    project: NativeProjectDescriptor,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NativeAnalysisSession>
}

export interface ProcessNativeAnalysisSessionFactoryOptions {
  readonly command: string
  readonly arguments?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  /** Maximum bytes in one JSONL frame; larger transactions use ordered bounded frames. */
  readonly maximumFrameBytes?: number
  /** Preferred frame ceiling for chunks within a streamed transaction. */
  readonly transactionChunkFrameBytes?: number
  /** Maximum decoded bytes in one complete semantic transaction. */
  readonly maximumTransactionBytes?: number
  readonly maximumErrorBytes?: number
  /** Opt-in diagnostic attribution received over a dedicated process descriptor. */
  readonly telemetry?: AnalysisTelemetrySink
}

export const DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS: Readonly<{
  readonly maximumFrameBytes: number
  readonly transactionChunkFrameBytes: number
  readonly maximumTransactionBytes: number
  readonly maximumErrorBytes: number
}>

/** Adapt one explicitly selected native executable to the generic resident-session contract. */
export function createProcessNativeAnalysisSessionFactory(
  options: ProcessNativeAnalysisSessionFactoryOptions,
): NativeAnalysisSessionFactory
