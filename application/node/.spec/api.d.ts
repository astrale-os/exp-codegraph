import type {
  TypeSpecApplicationOptions,
  TypeSpecApplicationService,
} from '../../.spec/api.js'
import type { AnalysisTelemetrySink } from '../../../analysis/profiling/.spec/api.js'
import type { SourceProofProvider } from '../../../repository/source-proof/.spec/api.js'
import type { FileWorkspaceCheckpointStore } from '../../../workspace/checkpoint/.spec/api.js'
import type { ApplicationCheckpointReference } from '../../checkpoint/.spec/api.js'

export interface PortableNodeApplicationCheckpoint {
  readonly store: FileWorkspaceCheckpointStore
  readonly sourceProof: string
  readonly writable: boolean
  readonly reference?: ApplicationCheckpointReference
}

export interface NodeTypeSpecApplicationOptions {
  readonly root: string
  readonly cacheDirectory: string
  readonly persistence?: 'advisory' | 'memory'
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly maximumRetainedGenerations?: number
  readonly telemetry?: AnalysisTelemetrySink
  readonly native?: TypeSpecApplicationOptions['native']
  readonly portableCheckpoint?: PortableNodeApplicationCheckpoint
}

export function createNodeTypeSpecApplicationService(
  options: NodeTypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService>

export function createGitSourceProofProvider(): SourceProofProvider
