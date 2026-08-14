import type { Completeness, Fact, FactShard } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction, ProducerIdentity } from '../generation/index.ts'
import type { PassId } from '../identity/index.ts'
import type { AnalysisQuery } from '../query/index.ts'

export type PassRuntime = 'native-go' | 'portable-typescript'
export type PassScope = 'source' | 'project' | 'repository'

export interface FactSchemaReference {
  readonly namespace: string
  readonly minimumVersion: number
  readonly maximumVersion: number
}

export interface PassManifest {
  readonly id: PassId
  readonly version: string
  readonly runtime: PassRuntime
  readonly scope: PassScope
  readonly providesCapabilities: readonly string[]
  readonly requiresCapabilities: readonly string[]
  readonly inputs: readonly FactSchemaReference[]
  readonly outputs: readonly { readonly namespace: string; readonly version: number }[]
  readonly invalidatesOn: readonly string[]
  readonly limits: Readonly<Record<string, number | string | boolean>>
  readonly mandatory: boolean
}

export interface PortablePassContext {
  readonly generation: AnalysisGeneration
  readonly query: AnalysisQuery
  readonly signal?: AbortSignal
}

export interface PassOutput {
  readonly completion: Completeness
  readonly shards: readonly FactShard[]
  readonly diagnostics: readonly Fact[]
}

export interface PortablePass {
  readonly manifest: PassManifest & { readonly runtime: 'portable-typescript' }
  run(context: PortablePassContext): Promise<PassOutput>
}

export interface PassPlan {
  readonly ordered: readonly PassManifest[]
  readonly capabilities: readonly string[]
}

export interface PassPlanningEnvironment {
  readonly availableCapabilities?: readonly string[]
  readonly availableSchemas?: readonly { readonly namespace: string; readonly version: number }[]
}

export interface PortablePassRunOptions {
  readonly plan: PassPlan
  readonly passes: readonly PortablePass[]
  readonly query: AnalysisQuery
  /** Previously materialized portable shards that remain valid for this refresh. */
  readonly carriedShards?: readonly FactShard[]
  readonly producer: ProducerIdentity
  readonly signal?: AbortSignal
}

export interface PortablePassRunResult {
  readonly transaction?: FactTransaction
  readonly executed: readonly PassId[]
  readonly unavailable: readonly PassId[]
  readonly diagnostics: readonly Fact[]
}

export class PassPlanError extends Error {
  readonly name = 'PassPlanError'
  readonly code: 'PASS_CYCLE' | 'PASS_INPUT_MISSING' | 'PASS_SCHEMA_INCOMPATIBLE'

  constructor(
    code: 'PASS_CYCLE' | 'PASS_INPUT_MISSING' | 'PASS_SCHEMA_INCOMPATIBLE',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

export function planPasses(
  manifests: readonly PassManifest[],
  requestedCapabilities: readonly string[],
  environment: PassPlanningEnvironment = {},
): PassPlan {
  const availableCapabilities = new Set(environment.availableCapabilities ?? [])
  const availableSchemas = new Map(
    (environment.availableSchemas ?? []).map((schema) => [schema.namespace, schema.version]),
  )
  const byCapability = new Map<string, PassManifest>()
  const byNamespace = new Map<string, PassManifest>()
  for (const manifest of manifests) {
    validateManifest(manifest)
    for (const capability of manifest.providesCapabilities) {
      const existing = byCapability.get(capability)
      if (existing && existing.id !== manifest.id) {
        throw new PassPlanError(
          'PASS_SCHEMA_INCOMPATIBLE',
          `Capability ${capability} has multiple providers: ${existing.id}, ${manifest.id}.`,
        )
      }
      byCapability.set(capability, manifest)
    }
    for (const output of manifest.outputs) {
      const existing = byNamespace.get(output.namespace)
      if (existing && existing.id !== manifest.id) {
        throw new PassPlanError(
          'PASS_SCHEMA_INCOMPATIBLE',
          `Fact namespace ${output.namespace} has multiple providers.`,
        )
      }
      byNamespace.set(output.namespace, manifest)
    }
  }

  const selected = new Map<PassId, PassManifest>()
  const active = new Set<PassId>()
  const visit = (manifest: PassManifest): void => {
    if (active.has(manifest.id)) {
      throw new PassPlanError('PASS_CYCLE', `Pass dependency cycle reaches ${manifest.id}.`)
    }
    if (selected.has(manifest.id)) return
    active.add(manifest.id)
    for (const capability of manifest.requiresCapabilities) {
      if (availableCapabilities.has(capability)) continue
      const provider = byCapability.get(capability)
      if (!provider) {
        throw new PassPlanError(
          'PASS_INPUT_MISSING',
          `Pass ${manifest.id} requires unavailable capability ${capability}.`,
        )
      }
      visit(provider)
    }
    for (const input of manifest.inputs) {
      const available = availableSchemas.get(input.namespace)
      if (
        available !== undefined &&
        available >= input.minimumVersion &&
        available <= input.maximumVersion
      ) {
        continue
      }
      const provider = byNamespace.get(input.namespace)
      if (!provider) {
        throw new PassPlanError(
          'PASS_INPUT_MISSING',
          `Pass ${manifest.id} requires unavailable namespace ${input.namespace}.`,
        )
      }
      const output = provider.outputs.find((candidate) => candidate.namespace === input.namespace)!
      if (output.version < input.minimumVersion || output.version > input.maximumVersion) {
        throw new PassPlanError(
          'PASS_SCHEMA_INCOMPATIBLE',
          `Pass ${manifest.id} cannot read ${input.namespace}@${output.version}.`,
        )
      }
      visit(provider)
    }
    active.delete(manifest.id)
    selected.set(manifest.id, manifest)
  }

  for (const capability of [...new Set(requestedCapabilities)].sort()) {
    if (availableCapabilities.has(capability)) continue
    const provider = byCapability.get(capability)
    if (!provider) {
      throw new PassPlanError('PASS_INPUT_MISSING', `No pass provides capability ${capability}.`)
    }
    visit(provider)
  }
  for (const manifest of selected.values()) {
    for (const output of manifest.outputs) {
      if (availableSchemas.has(output.namespace)) {
        throw new PassPlanError(
          'PASS_SCHEMA_INCOMPATIBLE',
          `Pass ${manifest.id} cannot replace base namespace ${output.namespace}.`,
        )
      }
    }
  }
  return {
    ordered: [...selected.values()],
    capabilities: [...new Set(requestedCapabilities)].sort(),
  }
}

function validateManifest(manifest: PassManifest): void {
  if (!manifest.version || !manifest.providesCapabilities.length) {
    throw new PassPlanError('PASS_SCHEMA_INCOMPATIBLE', `Pass ${manifest.id} has an invalid manifest.`)
  }
  for (const input of manifest.inputs) {
    if (input.minimumVersion < 1 || input.maximumVersion < input.minimumVersion) {
      throw new PassPlanError(
        'PASS_SCHEMA_INCOMPATIBLE',
        `Pass ${manifest.id} has an invalid schema range for ${input.namespace}.`,
      )
    }
  }
}
