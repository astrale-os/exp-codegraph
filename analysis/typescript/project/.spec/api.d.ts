/// <reference lib="esnext.disposable" preserve="true" />
import type { AnalysisGeneration, FactTransaction } from '../../../generation/.spec/api.js'
import type { AnalysisQuery, AnalysisStore } from '../../../query/.spec/api.js'
import type { NativeAnalysisSessionFactory, NativeProjectDescriptor, NativeSourceChange } from '../../../protocol/.spec/api.js'
import type { SourceId } from '../../../identity/.spec/api.js'
import type { TypeScriptFactReader } from '../../facts/.spec/api.js'
import type { BoundedValueEvaluator, BoundedValueLimits } from '../../value/.spec/api.js'

export interface TypeScriptProjectOptions {
  readonly root: string
  readonly config?: string
  /** Defaults to source, symbol, occurrence and body facts. */
  readonly capabilities?: NativeProjectDescriptor['capabilities']
  readonly modules?: NativeProjectDescriptor['modules']
  /** A supplied store remains owned by the caller. */
  readonly store?: AnalysisStore
  /** Advanced integration: use an application-owned native session provider. */
  readonly sessions?: NativeAnalysisSessionFactory
  /** Explicit executable for a tool distributing its own qualified native artifact. */
  readonly binary?: string
}

export interface TypeScriptProjectSnapshot {
  readonly generation: AnalysisGeneration
  readonly facts: TypeScriptFactReader
  /** Generic extensions consume the same pinned evidence as the typed reader. */
  readonly query: AnalysisQuery
  /** Reuses one evaluator for each effective budget within this immutable snapshot. */
  values(limits?: BoundedValueLimits): Promise<BoundedValueEvaluator>
  dispose(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

/** A resident compiler and its immutable readers, with serialized refresh and recoverable failure. */
export interface TypeScriptProject {
  refresh(options?: TypeScriptProjectRefresh): Promise<TypeScriptProjectUpdate>
  open(generation?: AnalysisGeneration): Promise<TypeScriptProjectSnapshot>
  dispose(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

export interface TypeScriptProjectRefresh {
  readonly changed?: readonly string[]
  readonly changes?: readonly NativeSourceChange[]
  readonly invalidate?: boolean
  readonly signal?: AbortSignal
}

export interface TypeScriptProjectUpdate {
  readonly generation: AnalysisGeneration
  /**
   * Exact commits made by this project since its previous successfully returned
   * refresh, in commit order. Empty for a no-op; may contain several commits
   * after recovery. Each transaction keeps its original base and sequence.
   */
  readonly transactions: readonly FactTransaction[]
  /** Source revisions changed by these commits, plus advisory refresh path hints. */
  readonly changedSources: readonly SourceId[]
  readonly diagnostics: readonly string[]
  readonly durationMs: number
}

export function openTypeScriptProject(options: TypeScriptProjectOptions): Promise<TypeScriptProject>
