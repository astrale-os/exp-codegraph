import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  APPLICATION_BINDING_FACT_NAMESPACE,
  deriveAnalysisId, factShardDigest, generationIdentity, shardReference,
  type ApplicationModuleBindingFact,
  type Completeness, type Fact, type FactShard, type FactTransaction,
  type ProducerIdentity, type ProjectUniverseId, type SourceManifestId,
} from '../analysis/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import {
  createModuleConformanceProfiles, planConformance, qualifySpecification,
  type ConformanceProfile,
} from '../conformance/index.ts'
import { conformanceCorpusScope } from '../qualification/v2/conformance/scope.ts'
import {
  governHistoricalQualificationDifferences,
  projectHistoricalQualificationEvidence,
} from '../qualification/v2/history/evidence.ts'
import { compileSpecificationSnapshot } from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []
const TEST_INVENTORY = deriveAnalysisId(
  'source-manifest', 'astrale.typespec.conformance-test.inventory', {},
)

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('TypeSpec V2 conformance', () => {
  it('projects immutable historical evidence onto the current authored authority', () => {
    const projection = projectHistoricalQualificationEvidence(
      {
        catalog: { entries: [
          { source: 'kernel/.spec/api.d.ts' },
          { source: 'downstream/.spec/api.d.ts' },
        ] },
        qualification: { specifications: [
          { source: 'kernel/.spec/api.d.ts', status: 'pass', profiles: [] },
          { source: 'downstream/.spec/api.d.ts', status: 'pass', profiles: [] },
        ] },
      },
      ['kernel/.spec/api.d.ts', 'new-kernel/.spec/api.d.ts'],
    )

    expect(projection.retainedSources).toEqual(['kernel/.spec/api.d.ts'])
    expect(projection.excludedSources).toEqual(['downstream/.spec/api.d.ts'])
    expect(projection.absentSources).toEqual(['new-kernel/.spec/api.d.ts'])
    expect(projection.evidence.catalog.entries).toEqual([{ source: 'kernel/.spec/api.d.ts' }])
  })

  it('fails closed for changed or unclassified historical differences', () => {
    const changed = governHistoricalQualificationDifferences([{
      source: 'spec/analysis/new-leaf/.spec/api.d.ts',
      field: 'presence', historical: false, candidate: true,
    }])
    const unclassified = governHistoricalQualificationDifferences([{
      source: 'runtime/unreviewed/.spec/api.d.ts',
      field: 'presence', historical: true, candidate: false,
    }])

    expect(changed.status).toBe('unexplained-drift')
    expect(changed.fingerprints[0]).toMatchObject({ accepted: false })
    expect(unclassified.status).toBe('unexplained-drift')
    expect(unclassified.unexplained).toHaveLength(1)
  })

  it('keeps authored modules without observations in the authoritative corpus', () => {
    const scope = conformanceCorpusScope(
      ['implemented/.spec/api.d.ts', 'spec-only/.spec/api.d.ts'],
      ['implemented/.spec/api.d.ts'],
    )

    expect(scope.selected).toEqual(['implemented/.spec/api.d.ts', 'spec-only/.spec/api.d.ts'])
    expect(scope.unobservedSpecifications).toEqual(['spec-only/.spec/api.d.ts'])
    expect(scope.orphanObservations).toEqual([])
    expect(() => conformanceCorpusScope(scope.specifications, scope.observations, ['unknown']))
      .toThrow('Unknown specification module: unknown.')
  })

  it('plans focused dependency closure without granting full-CI authority', () => {
    const support = profile('support', 'fixture.support')
    const selected = {
      ...profile('selected', 'fixture.selected'),
      manifest: { ...profile('selected', 'fixture.selected').manifest, dependsOn: ['support'] },
    }
    const plan = planConformance([selected, support], ['selected'])

    expect(plan.ordered.map((value) => value.manifest.id)).toEqual(['support', 'selected'])
    expect(plan.scope).toEqual({
      kind: 'focused', authority: 'advisory', requestedProfiles: ['selected'],
      includedProfiles: ['support', 'selected'], supportProfiles: ['support'],
    })
  })

  it('passes an exact explicit binding without reconstructing an implementation graph', async () => {
    const { specification, binding } = await bindingFixture()
    const result = await qualifyWithBinding(specification, binding, { kind: 'complete' })

    expect(result.status).toBe('pass')
    expect(result.profiles.map((value) => [value.id, value.status])).toEqual([
      ['contract.specification.validity', 'pass'],
      ['contract.module.structure', 'pass'],
      ['contract.module.dependencies', 'pass'],
      ['contract.module.surface', 'pass'],
    ])
  })

  it('reports exact export and error-code drift from compact binding evidence', async () => {
    const { specification, binding } = await bindingFixture()
    const drift: ApplicationModuleBindingFact = {
      ...binding,
      exports: binding.exports.map((entry) => ({
        ...entry,
        implementation: { type: false, value: false, typeOnly: false },
        status: 'missing',
      })),
      expectedErrorCodes: ['MODULE_REJECTED'],
      diagnostics: [{
        code: 'MODULE_EXPORT_MISSING', message: 'Specified export is absent: API',
        file: specification.source, line: 1, column: 1, exportPath: 'API',
      }],
    }
    const result = await qualifyWithBinding(specification, drift, { kind: 'complete' })
    const surface = result.profiles.find((value) => value.id === 'contract.module.surface')!

    expect(result.status).toBe('fail')
    expect(surface.coverage.forward).toEqual({ matched: 0, total: 1 })
    expect(surface.rules.flatMap((rule) => rule.diagnostics).map((value) => value.code))
      .toEqual(['ERROR_CODE_MISSING', 'MODULE_EXPORT_MISSING'])
  })

  it('rejects undeclared and deep dependencies at the semantic owner', async () => {
    const { specification, binding } = await bindingFixture()
    const drift: ApplicationModuleBindingFact = {
      ...binding,
      dependencies: [
        {
          targetModule: 'package:zod', kind: 'runtime', sourceFile: 'module/index.ts',
          targetFile: 'node_modules/zod/index.d.ts', specifier: 'zod', typeOnly: false,
          deep: false, line: 1, column: 1,
        },
        {
          targetModule: 'other/.spec/api.d.ts', kind: 'runtime', sourceFile: 'module/index.ts',
          targetFile: 'other/internal.ts', specifier: '../other/internal.js', typeOnly: false,
          deep: true, line: 2, column: 1,
        },
      ],
    }
    const result = await qualifyWithBinding(specification, drift, { kind: 'complete' })
    const dependencies = result.profiles.find(
      (value) => value.id === 'contract.module.dependencies',
    )!

    expect(dependencies.status).toBe('fail')
    expect(dependencies.rules[0]?.diagnostics.map((value) => value.code)).toEqual([
      'MODULE_DEEP_IMPORT', 'MODULE_PACKAGE_UNDECLARED',
    ])
  })

  it('does not fabricate a verdict from partial binding evidence', async () => {
    const { specification, binding } = await bindingFixture()
    const result = await qualifyWithBinding(specification, binding, {
      kind: 'partial',
      reasons: [{
        code: 'QUALIFICATION_LIMIT', message: 'Fixture deliberately stopped early.',
        effective: { facts: 1 },
      }],
    })

    expect(result.status).toBe('indeterminate')
    expect(result.profiles.find((value) => value.id === 'contract.module.structure'))
      .toMatchObject({ status: 'indeterminate' })
  })
})

async function bindingFixture() {
  const current = await fixture({
    'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
  })
  fixtures.push(current)
  const specification = await compileSpecificationSnapshot(
    current.root, join(current.root, 'module/.spec'),
  )
  const binding: ApplicationModuleBindingFact = {
    specification: specification.module.id,
    target: {
      id: specification.module.id, name: specification.module.name,
      project: 'tsconfig.json', root: 'module', entrypoint: 'module/index.ts',
      facades: [], aliases: [], internals: [],
    },
    exports: [{
      path: ['API'], name: 'API',
      contract: { type: true, value: false, typeOnly: true },
      implementation: { type: true, value: false, typeOnly: true },
      status: 'pass',
    }],
    dependencies: [], declaredPackages: [], developmentPackages: [], errorCodes: [],
    expectedErrorCodes: [], files: ['module/index.ts'], diagnostics: [],
  }
  return { specification, binding }
}

async function qualifyWithBinding(
  specification: Awaited<ReturnType<typeof compileSpecificationSnapshot>>,
  binding: ApplicationModuleBindingFact,
  completeness: Completeness,
) {
  const transaction = bindingTransaction(specification.module.id, binding, completeness)
  const store = createMemoryAnalysisStore()
  await store.commit(transaction)
  const analysis = await store.snapshotSet(
    new Map([[transaction.next.universe, transaction.next.id]]), TEST_INVENTORY,
  )
  try {
    return await qualifySpecification({
      specification, analysis, profiles: createModuleConformanceProfiles(),
    })
  } finally {
    await analysis.dispose()
    await store.dispose()
  }
}

function profile(id: string, capability: string): ConformanceProfile {
  return {
    manifest: {
      id, version: '1.0.0', dependsOn: [], requiresCapabilities: [{ capability }],
      rules: ['SURFACE-MATCHES'],
    },
    async evaluate() { return [] },
  }
}

function bindingTransaction(
  subject: string,
  payload: ApplicationModuleBindingFact,
  completeness: Completeness,
): FactTransaction {
  const namespace = APPLICATION_BINDING_FACT_NAMESPACE
  const universe = deriveAnalysisId(
    'project-universe', 'conformance-fixture', { config: 'tsconfig.json' },
  ) as ProjectUniverseId
  const producer: ProducerIdentity = {
    id: deriveAnalysisId('producer', 'conformance-fixture', { version: 1 }),
    name: 'conformance-fixture', version: '1.0.0', protocolVersion: 1,
  }
  const sourceManifest = deriveAnalysisId(
    'source-manifest', 'conformance-fixture', { revision: 1 },
  ) as SourceManifestId
  const pending = deriveAnalysisId('generation', 'pending', {})
  const fact: Fact = {
    id: deriveAnalysisId('fact', namespace, { kind: 'module-binding', subject, payload }),
    generation: pending, namespace, schemaVersion: 1, kind: 'module-binding', subject,
    completeness,
    provenance: {
      pass: deriveAnalysisId('pass', namespace, { version: 1 }),
      passVersion: '1.0.0', evidence: [], inputs: [],
    },
    payload,
  }
  const draft = {
    key: deriveAnalysisId('fact-shard-key', namespace, { module: subject }),
    namespace, schemaVersion: 1, completion: completeness, facts: [fact],
  }
  const digest = factShardDigest(draft)
  const generation = generationIdentity(
    { universe, producer, sourceManifest, capabilities: [namespace] },
    [{ key: draft.key, digest, namespace, schemaVersion: 1, facts: 1 }],
  )
  const shard: FactShard = {
    ...draft, digest, facts: [{ ...fact, generation }],
  }
  return {
    protocolVersion: 1,
    next: {
      id: generation, sequence: 1, universe, producer, sourceManifest,
      capabilities: [namespace],
    },
    manifest: [shardReference(shard)], upserts: [shard], deletes: [],
  }
}
