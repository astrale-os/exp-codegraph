import type { FactShard } from '../../facts/.spec/api.js'
import type { FactPayloadCodec } from '../../facts/representation/.spec/api.js'
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

/** Inventory-proven source transition; `unknown` preserves conservative rebuilding. */
export interface NativeSourceChange {
  readonly path: string
  readonly kind: 'change' | 'add' | 'unlink' | 'unknown'
}

export type NativeAnalysisRequest =
  | {
      readonly id: number
      readonly kind: 'refresh'
      readonly base?: AnalysisGenerationId
      /** Required with `base`; binds restart/adoption to the store's exact sequence. */
      readonly baseSequence?: number
      readonly changed?: readonly string[]
      readonly changes?: readonly NativeSourceChange[]
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
  /** The signal cancels opening only; subsequent requests own their cancellation. */
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
  /** Maximum encoded bytes in one streamed record, including its newline. */
  readonly maximumRecordBytes?: number
  /** Maximum total expanded semantic payload bytes in one shard. */
  readonly maximumDecodedShardBytes?: number
  /** Optional aggregate semantic payload limit; legacy responses default to 384 MiB. */
  readonly maximumTransactionBytes?: number
  /** Optional aggregate physical limit; legacy responses default to 512 MiB. */
  readonly maximumPhysicalTransactionBytes?: number
  readonly maximumErrorBytes?: number
  /** Optional adapter-owned native-process resident-set watchdog. */
  readonly maximumResidentBytes?: number
  /** Qualification seam for a receiver-bound resident-set evidence provider. */
  readonly sampleResidentBytes?: (pid: number) => Promise<number>
  /** Opt-in diagnostic attribution, with a marked stderr stream on Windows. */
  readonly telemetry?: AnalysisTelemetrySink
  /** Explicit physical payload capabilities negotiated with the native producer. */
  readonly payloadCodecs?: readonly FactPayloadCodec[]
}

export const DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS: Readonly<{
  readonly maximumFrameBytes: number
  readonly transactionChunkFrameBytes: number
  readonly maximumRecordBytes: number
  readonly maximumDecodedShardBytes: number
  readonly maximumTransactionBytes: number
  readonly maximumPhysicalTransactionBytes: number
  readonly maximumErrorBytes: number
}>

export class NativeAnalysisProcessResourceError extends Error {
  readonly name: 'NativeAnalysisProcessResourceError'
  readonly code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT'
  constructor(
    code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT',
    message: string,
    options?: ErrorOptions,
  )
}

/** Adapt one explicitly selected native executable to the generic resident-session contract. */
export function createProcessNativeAnalysisSessionFactory(
  options: ProcessNativeAnalysisSessionFactoryOptions,
): NativeAnalysisSessionFactory
