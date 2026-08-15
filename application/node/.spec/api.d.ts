import type {
  TypeSpecApplicationOptions,
  TypeSpecApplicationService,
} from '../../.spec/api.js'

export interface NodeTypeSpecApplicationOptions {
  readonly root: string
  readonly cacheDirectory: string
  readonly persistence?: 'advisory' | 'memory'
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly maximumRetainedGenerations?: number
  readonly native?: TypeSpecApplicationOptions['native']
}

export function createNodeTypeSpecApplicationService(
  options: NodeTypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService>
