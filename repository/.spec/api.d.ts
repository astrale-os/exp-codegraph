import type { Completeness, FactShard } from '../../analysis/facts/.spec/api.js'
import type {
  AnalysisGenerationId,
  PassId,
  RepositoryId,
  SourceId,
  SourceManifestId,
  SourceRevisionId,
} from '../../analysis/identity/.spec/api.js'

export * from '../source/.spec/api.js'
export * from '../source-proof/.spec/api.js'
export * from '../statistics/.spec/api.js'

export type RepositoryPurpose =
  | 'implementation'
  | 'test'
  | 'test-support'
  | 'fixture'
  | 'specification'
  | 'evidence'
  | 'unknown'

export type RepositoryProvenance = 'authored' | 'generated' | 'vendored' | 'unknown'
export type RepositoryLifecycle = 'active' | 'deprecated' | 'historical' | 'unknown'
export type RepositoryDelivery = 'runtime' | 'development' | 'build' | 'documentation' | 'unknown'
export type RepositoryContent = 'text' | 'binary'

export interface RepositoryClassification {
  readonly purpose: RepositoryPurpose
  readonly provenance: RepositoryProvenance
  readonly lifecycle: RepositoryLifecycle
  readonly delivery: RepositoryDelivery
  readonly evidence: readonly string[]
}

export interface RepositoryFile {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly path: string
  readonly content: RepositoryContent
  readonly language: string
  readonly bytes: number
  readonly package?: string
  readonly area?: string
  readonly classification: RepositoryClassification
  readonly git?: {
    readonly tracked: boolean
    readonly ignored: boolean
  }
}

export interface RepositoryInventory {
  readonly repository: RepositoryId
  readonly revision: SourceManifestId
  readonly files: readonly RepositoryFile[]
  readonly completeness: Completeness
}

export interface RepositoryScope {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly purposes?: readonly RepositoryPurpose[]
  readonly provenance?: readonly RepositoryProvenance[]
  readonly lifecycle?: readonly RepositoryLifecycle[]
  readonly delivery?: readonly RepositoryDelivery[]
}

export interface RepositoryInventoryOptions {
  readonly repository: RepositoryId
  readonly root: string
  readonly scope?: RepositoryScope
  readonly scanner?: RepositoryScanner
  readonly classifiers?: readonly RepositoryClassifier[]
  readonly signal?: AbortSignal
}

export interface RepositoryScanEntry {
  readonly path: string
  readonly bytes: number
  readonly digest: string
  readonly content: RepositoryContent
}

export interface RepositoryScanner {
  /** Optional bounded batch path for an already-admitted immutable corpus. */
  scanAll?(
    root: string,
    options?: { readonly signal?: AbortSignal; readonly scope?: RepositoryScope },
  ): Promise<readonly RepositoryScanEntry[]>
  scan(
    root: string,
    options?: { readonly signal?: AbortSignal; readonly scope?: RepositoryScope },
  ): AsyncIterable<RepositoryScanEntry>
}

export interface RepositoryClassifier {
  readonly id: string
  readonly priority: number
  classify(entry: RepositoryScanEntry): Partial<RepositoryClassification> | undefined
}

export function inventoryRepository(options: RepositoryInventoryOptions): Promise<RepositoryInventory>
export function repositoryFacts(
  inventory: RepositoryInventory,
  context: {
    readonly generation: AnalysisGenerationId
    readonly pass: PassId
    readonly passVersion: string
  },
): readonly FactShard[]
export function createNodeRepositoryScanner(): RepositoryScanner
export function defaultRepositoryClassifiers(): readonly RepositoryClassifier[]
