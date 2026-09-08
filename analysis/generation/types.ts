import type { AnalysisGenerationId, ProducerId, ProjectUniverseId, SourceManifestId } from '../identity/index.ts'

export interface ProducerIdentity {
  readonly id: ProducerId
  readonly name: string
  readonly version: string
  readonly protocolVersion: number
}

export interface AnalysisGeneration {
  readonly id: AnalysisGenerationId
  readonly sequence: number
  readonly universe: ProjectUniverseId
  readonly producer: ProducerIdentity
  readonly sourceManifest: SourceManifestId
  readonly capabilities: readonly string[]
}
