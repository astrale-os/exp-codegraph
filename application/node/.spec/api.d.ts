import type {
  TypeSpecApplicationOptions,
  TypeSpecApplicationService,
} from '../../.spec/api.js'
import type { AnalysisTelemetrySink } from '../../../analysis/profiling/.spec/api.js'

export interface NodeTypeSpecApplicationOptions {
  readonly root: string
  readonly cacheDirectory: string
  readonly persistence?: 'advisory' | 'memory'
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly maximumRetainedGenerations?: number
  readonly telemetry?: AnalysisTelemetrySink
  readonly native?: TypeSpecApplicationOptions['native']
}

export function createNodeTypeSpecApplicationService(
  options: NodeTypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService>
