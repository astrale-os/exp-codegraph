import type { AnalysisSnapshotSet } from '../../../analysis/.spec/api.js'
import type { AnalysisStore } from '../../../analysis/query/.spec/api.js'
import type {
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
} from '../../../analysis/protocol/.spec/api.js'
import type { RepositoryId } from '../../../analysis/identity/.spec/api.js'
import type { TypeScriptRefreshResult } from '../../../analysis/typescript/.spec/api.js'
import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'
import type { RepositoryInventory } from '../../../repository/.spec/api.js'
import type { ApplicationObservationRefresh } from '../../observation/.spec/api.js'

interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

export interface ApplicationAnalysisRefreshOptions {
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly compilerAnalysis?: boolean
  readonly changed?: readonly string[]
  readonly invalidate?: boolean
  readonly signal?: AbortSignal
}

export interface ApplicationAnalysisRefresh {
  readonly snapshot: AnalysisSnapshotSet
  readonly universes: readonly `project-universe:${string}`[]
  readonly boundaries: readonly NativeModuleBoundary[]
  readonly results: readonly TypeScriptRefreshResult[]
  readonly observation: ApplicationObservationRefresh
  readonly diagnostics: readonly string[]
}

export interface ApplicationAnalysisWorkspace {
  refresh(options: ApplicationAnalysisRefreshOptions): Promise<ApplicationAnalysisRefresh>
  dispose(): Promise<void>
}

export interface ApplicationAnalysisWorkspaceOptions {
  readonly root: string
  readonly repository: RepositoryId
  readonly sessions: NativeAnalysisSessionFactory
  readonly store?: AnalysisStore
  readonly maximumRetainedGenerations?: number
}

export interface ApplicationModuleBoundaries {
  readonly boundaries: readonly NativeModuleBoundary[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface TtscApplicationSessionOptions {
  readonly binary?: string
  readonly cacheDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly maximumFrameBytes?: number
  readonly maximumTransactionBytes?: number
}

export function resolveApplicationModuleBoundaries(
  root: string,
  specifications: readonly SpecificationSnapshot[],
): Promise<ApplicationModuleBoundaries>

export function validateApplicationModuleBoundaries(
  values: readonly NativeModuleBoundary[],
): ApplicationModuleBoundaries

export function createTtscApplicationSessionFactory(
  options?: TtscApplicationSessionOptions,
): NativeAnalysisSessionFactory

export function createApplicationAnalysisWorkspace(
  options: ApplicationAnalysisWorkspaceOptions,
): ApplicationAnalysisWorkspace
