import type { Diagnostic } from '../../source/diagnostic.ts'
import type {
  BenchmarkResource,
  CapabilityResource,
  LawResource,
  PackagePatternResource,
  PackageSpecificationResource,
  SchemaResource,
} from '../model.ts'

import { matchesPackagePattern } from './package.ts'

export interface ModuleSemanticResources {
  readonly capabilities: readonly CapabilityResource[]
  readonly laws: readonly LawResource[]
  readonly benchmarks: readonly BenchmarkResource[]
  readonly schemas: readonly SchemaResource[]
  readonly packages: readonly PackageSpecificationResource[]
  readonly packagePatterns: readonly PackagePatternResource[]
}

/** Validate relationships that only become visible after all module artifacts are loaded. */
export function validateModuleSemantics(resources: ModuleSemanticResources): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  validateSemanticIds(resources, diagnostics)
  validateBenchmarks(resources, diagnostics)
  validateSchemaIdentities(resources.schemas, diagnostics)
  validatePackageDefinitions(resources, diagnostics)
  return diagnostics
}

function validateSemanticIds(resources: ModuleSemanticResources, diagnostics: Diagnostic[]): void {
  const definitions = [
    ...resources.capabilities.flatMap((resource) =>
      resource.definitions.map((definition) => ({ resource, definition })),
    ),
    ...resources.laws.flatMap((resource) =>
      resource.definitions.map((definition) => ({ resource, definition })),
    ),
    ...resources.benchmarks.flatMap((resource) =>
      resource.definitions.map((definition) => ({ resource, definition })),
    ),
  ]
  const seen = new Map<string, string>()
  for (const { resource, definition } of definitions) {
    const first = seen.get(definition.id)
    if (first) {
      diagnostics.push({
        code: 'SEMANTIC_ID_DUPLICATE',
        message: `Semantic identifier ${definition.id} is already declared by ${first}.`,
        file: resource.source,
        line: 1,
        column: 1,
      })
    } else {
      seen.set(definition.id, resource.source)
    }
  }
}

function validateBenchmarks(resources: ModuleSemanticResources, diagnostics: Diagnostic[]): void {
  const capabilities = new Set(
    resources.capabilities.flatMap((resource) =>
      resource.definitions.map((definition) => definition.id),
    ),
  )
  for (const resource of resources.benchmarks) {
    for (const definition of resource.definitions) {
      if (!definition.capability || capabilities.has(definition.capability)) continue
      diagnostics.push({
        code: 'BENCHMARK_CAPABILITY_UNKNOWN',
        message: `Benchmark ${definition.id} references undeclared capability ${definition.capability}.`,
        file: resource.source,
        line: 1,
        column: 1,
      })
    }
  }
}

function validateSchemaIdentities(
  schemas: readonly SchemaResource[],
  diagnostics: Diagnostic[],
): void {
  const seen = new Map<string, string>()
  for (const resource of schemas) {
    const id = schemaId(resource.schema)
    if (!id) continue
    const first = seen.get(id)
    if (first) {
      diagnostics.push({
        code: 'SCHEMA_ID_DUPLICATE',
        message: `JSON Schema identity ${id} is already declared by ${first}.`,
        file: resource.source,
        line: 1,
        column: 1,
        pointer: '/$id',
      })
    } else {
      seen.set(id, resource.source)
    }
  }
}

function validatePackageDefinitions(
  resources: ModuleSemanticResources,
  diagnostics: Diagnostic[],
): void {
  const seen = new Map<string, string>()
  for (const resource of resources.packages) {
    const first = seen.get(resource.package)
    if (first) {
      diagnostics.push({
        code: 'PACKAGE_DEFINITION_DUPLICATE',
        message: `Package ${resource.package} is already specified by ${first}.`,
        file: resource.source,
        line: 1,
        column: 1,
      })
    } else {
      seen.set(resource.package, resource.source)
    }
    const pattern = resources.packagePatterns.find((candidate) =>
      matchesPackagePattern(candidate.pattern, resource.package),
    )
    if (pattern) {
      diagnostics.push({
        code: 'PACKAGE_DEFINITION_PATTERN_OVERLAP',
        message: `Package ${resource.package} is declared explicitly and also covered by ${pattern.pattern}.`,
        file: resource.source,
        line: 1,
        column: 1,
      })
    }
  }
}

export function schemaId(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
  const id = (schema as Record<string, unknown>).$id
  return typeof id === 'string' && id ? id : undefined
}
