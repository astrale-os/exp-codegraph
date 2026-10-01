import type { FactShard } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import type { AnalysisGenerationId, FactShardKey } from '../identity/index.ts'

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

/** Inventory-proven source transition; `unknown` preserves the conservative rebuild path. */
export interface NativeSourceChange {
  readonly path: string
  readonly kind: 'change' | 'add' | 'unlink' | 'unknown'
}

/** Exact owned logical source roots whose complete body/call inventory is requested. */
export interface NativeBodyDemand {
  readonly paths: readonly string[]
  /** Omitted: conservative closure. Present, including []: exact observed owner expansion. */
  readonly owners?: readonly string[]
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
      /** Discover changes to compiler-owned inputs, including failed resolutions. */
      readonly discover?: boolean
      readonly invalidate?: boolean
      /** Selection recipe for the explicit typescript.body-demand capability. */
      readonly bodyDemand?: NativeBodyDemand
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
