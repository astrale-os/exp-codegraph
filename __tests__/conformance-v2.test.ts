import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  deriveAnalysisId,
  factShardDigest,
  generationIdentity,
  shardReference,
  type Completeness,
  type Fact,
  type FactShard,
  type FactTransaction,
  type ProducerIdentity,
  type ProjectUniverseId,
  type SourceManifestId,
} from '../analysis/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import {
  TYPESCRIPT_MODULE_FACT_NAMESPACE,
  typeScriptDependencyIdentity,
  typeScriptDependencyOccurrenceIdentity,
  type TypeScriptDependencyFact,
  type TypeScriptModuleFact,
} from '../analysis/typescript/index.ts'
import {
  createModuleConformanceProfiles,
  planConformance,
  qualifySpecification,
  type ConformanceProfile,
} from '../conformance/index.ts'
import { compileModuleContract } from '../conformance/module/contract/compiler.ts'
import {
  readObservationCheckpoint,
  validateCompleteObservationCheckpoint,
  writeObservationCheckpoint,
} from '../qualification/v2/conformance/checkpoint.ts'
import {
  governHistoricalQualificationDifferences,
  projectHistoricalQualificationEvidence,
} from '../qualification/v2/history/evidence.ts'
import { conformanceCorpusScope } from '../qualification/v2/conformance/scope.ts'
import { compileSpecificationSnapshot } from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []
const TEST_INVENTORY = deriveAnalysisId(
  'source-manifest',
  'astrale.typespec.conformance-test.inventory',
  {},
)

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('TypeSpec V2 conformance', () => {
  it('projects immutable historical evidence onto the current authored authority', () => {
    const projection = projectHistoricalQualificationEvidence(
      {
        catalog: {
          entries: [
            { source: 'kernel/.spec/api.d.ts' },
            { source: 'downstream/.spec/api.d.ts' },
          ],
        },
        qualification: {
          specifications: [
            { source: 'kernel/.spec/api.d.ts', status: 'pass', profiles: [] },
            { source: 'downstream/.spec/api.d.ts', status: 'pass', profiles: [] },
          ],
        },
      },
      ['kernel/.spec/api.d.ts', 'new-kernel/.spec/api.d.ts'],
    )

    expect(projection.retainedSources).toEqual(['kernel/.spec/api.d.ts'])
    expect(projection.excludedSources).toEqual(['downstream/.spec/api.d.ts'])
    expect(projection.absentSources).toEqual(['new-kernel/.spec/api.d.ts'])
    expect(projection.evidence.catalog.entries).toEqual([{ source: 'kernel/.spec/api.d.ts' }])
    expect(projection.evidence.qualification.specifications).toHaveLength(1)
  })

  it('compiles callable aliases from their invoked signature, not the whole alias value', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export type Endpoint = string | URL
export interface Props { readonly id: string }
export interface Context { readonly revision: string }
export interface Document { readonly title: string }
export type Component<P> = (props: P, context: Context) => Document
export declare const View: Component<Props>
export declare function connect(endpoint?: Endpoint): void
`,
    })
    fixtures.push(current)
    const snapshot = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const contract = compileModuleContract(snapshot).module
    const view = contract?.declarations.find((declaration) => declaration.identity.name === 'View')
    const connect = contract?.declarations.find(
      (declaration) => declaration.identity.name === 'connect',
    )

    expect(view).toMatchObject({
      parameters: [
        { name: 'props', expression: { kind: 'declaration', declaration: { name: 'Props' } } },
        {
          name: 'context',
          expression: { kind: 'declaration', declaration: { name: 'Context' } },
        },
      ],
      returns: {
        expression: { kind: 'declaration', declaration: { name: 'Document' } },
      },
    })
    expect(connect?.parameters?.[0]?.expression).toMatchObject({
      kind: 'declaration',
      declaration: { name: 'Endpoint' },
    })
    expect(contract?.imports).toEqual([])
  })

  it('fails closed for changed or unclassified historical differences', () => {
    const changed = governHistoricalQualificationDifferences([
      {
        source: 'spec/analysis/new-leaf/.spec/api.d.ts',
        field: 'presence',
        historical: false,
        candidate: true,
      },
    ])
    expect(changed.status).toBe('unexplained-drift')
    expect(changed.fingerprints.find((group) => group.id === 'presence:false=>true')).toMatchObject({
      count: 1,
      accepted: false,
    })

    const unclassified = governHistoricalQualificationDifferences([
      {
        source: 'runtime/unreviewed/.spec/api.d.ts',
        field: 'presence',
        historical: true,
        candidate: false,
      },
    ])
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
    expect(() =>
      conformanceCorpusScope(scope.specifications, scope.observations, ['unknown']),
    ).toThrow('Unknown specification module: unknown.')
  })

  it('derives V4 checkpoint modules from authoritative transactions and rejects index tampering', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = moduleFact(specification)
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload,
    })
    const path = join(current.root, 'observations.json')
    await writeObservationCheckpoint(path, {
      boundaries: 'fixture-boundaries',
      nativeDigest: 'fixture-native',
      complete: true,
      observed: new Map([[specification.module.id, payload]]),
      projects: [
        {
          project: 'tsconfig.json',
          modules: 1,
          generation: transaction.next.id,
        },
      ],
      transactions: new Map([['tsconfig.json', transaction]]),
    })

    const loaded = await readObservationCheckpoint(path, 'fixture-boundaries', 'fixture-native')
    validateCompleteObservationCheckpoint(loaded)
    expect(loaded.modules).toEqual([[specification.module.id, payload]])

    const tampered = JSON.parse(await readFile(path, 'utf8')) as { modulesDigest: string }
    tampered.modulesDigest = 'tampered'
    await writeFile(path, `${JSON.stringify(tampered)}\n`, 'utf8')
    await expect(
      readObservationCheckpoint(path, 'fixture-boundaries', 'fixture-native'),
    ).rejects.toThrow('module index')
  })

  it('produces one immutable qualification tied to exact specification and analysis identities', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const transaction = analysisTransaction({ completeness: { kind: 'complete' } })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    const profile = conformanceProfile('surface', 'fixture.surface', async (context) => {
      const facts = await context.queries.get(transaction.next.universe)!.facts({
        namespaces: ['fixture.surface'],
      })
      return [
        {
          rule: 'SURFACE-MATCHES',
          status: 'pass',
          diagnostics: [],
          coverage: {
            forward: { matched: facts.facts.length, total: facts.facts.length },
            inverse: { matched: facts.facts.length, total: facts.facts.length },
          },
        },
      ]
    })
    try {
      const first = await qualifySpecification({
        specification,
        analysis,
        profiles: [profile],
      })
      const second = await qualifySpecification({
        specification,
        analysis,
        profiles: [profile],
      })
      expect(first.id).toBe(second.id)
      expect(first).toMatchObject({
        format: 'astrale.typespec.qualification',
        version: 2,
        specification: { id: specification.id, revision: specification.revision },
        analysis: { id: analysis.id },
        scope: { kind: 'full', authority: 'full-ci' },
        status: 'pass',
      })
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.profiles[0]?.rules[0])).toBe(true)
      expect(() => {
        ;(first as { status: string }).status = 'fail'
      }).toThrow(TypeError)
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('does not evaluate a profile when required evidence is partial or missing', async () => {
    const current = await fixture({ 'module/.spec/api.d.ts': 'export interface API {}\n' })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const transaction = analysisTransaction({
      completeness: {
        kind: 'partial',
        reasons: [
          {
            code: 'QUALIFICATION_LIMIT',
            message: 'Fixture deliberately stopped early.',
            effective: { facts: 1 },
          },
        ],
      },
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    let invoked = false
    const profile = conformanceProfile('surface', 'fixture.surface', async () => {
      invoked = true
      return []
    })
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: [profile],
      })
      expect(invoked).toBe(false)
      expect(result.status).toBe('indeterminate')
      expect(result.profiles[0]?.rules[0]?.diagnostics[0]).toMatchObject({
        code: 'CONFORMANCE_EVIDENCE_UNAVAILABLE',
        actual: { kind: 'partial' },
      })
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('plans focused dependency closure but never grants it full-CI authority', () => {
    const support = conformanceProfile('support', 'fixture.support', async () => [])
    const selected = {
      ...conformanceProfile('selected', 'fixture.selected', async () => []),
      manifest: {
        ...conformanceProfile('selected', 'fixture.selected', async () => []).manifest,
        dependsOn: ['support'],
      },
    }
    const plan = planConformance([selected, support], ['selected'])
    expect(plan.ordered.map((profile) => profile.manifest.id)).toEqual(['support', 'selected'])
    expect(plan.scope).toEqual({
      kind: 'focused',
      authority: 'advisory',
      requestedProfiles: ['selected'],
      includedProfiles: ['support', 'selected'],
      supportProfiles: ['support'],
    })

    const cycleA = {
      ...support,
      manifest: { ...support.manifest, id: 'cycle-a', dependsOn: ['cycle-b'] },
    }
    const cycleB = {
      ...support,
      manifest: { ...support.manifest, id: 'cycle-b', dependsOn: ['cycle-a'] },
    }
    expect(() => planConformance([cycleA, cycleB])).toThrow('cycle')

    const invalidPartial = {
      ...support,
      manifest: {
        ...support.manifest,
        id: 'invalid-partial',
        requiresCapabilities: [
          {
            capability: 'fixture.support',
            acceptedPartialReasonCodes: ['FIXTURE_PARTIAL'],
          },
        ],
      },
    }
    expect(() => planConformance([invalidPartial])).toThrow('capability requirement')
  })

  it('compares authored API meaning with portable module facts and reports real drift', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export interface API {
  readonly value: Dependency
}
export interface Dependency { readonly id: string }
`,
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const api = specification.module.api!.model!
    const matching: TypeScriptModuleFact = {
      target: {
        id: specification.module.id,
        name: specification.module.name,
        project: 'tsconfig.json',
        root: 'module',
        entrypoint: 'module/index.ts',
        facades: [],
        aliases: [],
        internals: [],
      },
      exports: api.surface.exports,
      declarations: api.surface.declarations,
      dependencies: [],
      inboundDependencies: [],
      declaredPackages: [],
      developmentPackages: [],
      workspacePackages: [],
      errorCodes: [],
      files: ['module/index.ts'],
      issues: [],
    }
    const wrongIdentityDeclarations = structuredClone(api.surface.declarations)
    const apiDeclaration = wrongIdentityDeclarations.find(
      (declaration) => declaration.name === 'API',
    )
    const dependencyType = apiDeclaration?.properties?.find((property) => property.name === 'value')
      ?.type as { kind: string; identity?: string } | undefined
    expect(dependencyType?.kind).toBe('reference')
    dependencyType!.identity = 'ts:wrong-provider#Dependency'
    const stores = [
      createMemoryAnalysisStore(),
      createMemoryAnalysisStore(),
      createMemoryAnalysisStore(),
      createMemoryAnalysisStore(),
      createMemoryAnalysisStore(),
      createMemoryAnalysisStore(),
    ]
    const transactions = [
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: specification.module.id,
        payload: matching,
      }),
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: specification.module.id,
        payload: { ...matching, exports: [] },
      }),
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: specification.module.id,
        payload: { ...matching, declarations: wrongIdentityDeclarations },
      }),
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: specification.module.id,
        payload: {
          ...matching,
          declaredPackages: ['undeclared-by-specification'],
          dependencies: [
            {
              id: deriveAnalysisId('typescript-dependency', TYPESCRIPT_MODULE_FACT_NAMESPACE, {
                fixture: 'external',
              }),
              sourceModule: specification.module.id,
              targetModule: 'package:undeclared-by-specification',
              kind: 'runtime',
              sourceFile: 'module/index.ts',
              targetFile: 'node_modules/undeclared-by-specification/index.d.ts',
              occurrences: [
                {
                  id: deriveAnalysisId('occurrence', TYPESCRIPT_MODULE_FACT_NAMESPACE, {
                    fixture: 'external',
                  }),
                  typeOnly: false,
                  specifier: 'undeclared-by-specification',
                  deep: false,
                  location: { file: 'module/index.ts', line: 1, column: 1 },
                },
              ],
            },
          ],
        },
      }),
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: 'another-module',
        payload: { ...matching, target: { ...matching.target, id: 'another-module' } },
      }),
      analysisTransaction({
        completeness: { kind: 'complete' },
        namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
        kind: 'module',
        subject: specification.module.id,
        payload: matching,
        additionalFacts: [
          {
            completeness: {
              kind: 'partial',
              reasons: [
                {
                  code: 'UNRELATED_MODULE_PARTIAL',
                  message: 'The sibling fixture is intentionally partial.',
                  effective: { fixture: true },
                },
              ],
            },
            subject: 'partial-sibling',
            payload: {
              ...matching,
              target: { ...matching.target, id: 'partial-sibling' },
            },
          },
        ],
      }),
    ]
    try {
      const results = []
      for (let index = 0; index < stores.length; index++) {
        const store = stores[index]!
        const transaction = transactions[index]!
        await store.commit(transaction)
        const analysis = await store.snapshotSet(
          new Map([[transaction.next.universe, transaction.next.id]]),
          TEST_INVENTORY,
        )
        try {
          results.push(
            await qualifySpecification({
              specification,
              analysis,
              profiles: createModuleConformanceProfiles(),
            }),
          )
        } finally {
          await analysis.dispose()
        }
      }
      expect(results[0]?.status).toBe('pass')
      expect(
        results[0]?.profiles.find((profile) => profile.id === 'contract.module.surface')?.coverage,
      ).toEqual({
        forward: { matched: 6, total: 6 },
        inverse: { matched: 6, total: 6 },
      })
      expect(results[1]?.status).toBe('fail')
      expect(
        results[1]?.profiles.find((profile) => profile.id === 'contract.module.surface')?.coverage,
      ).toEqual({
        forward: { matched: 0, total: 6 },
        inverse: { matched: 0, total: 2 },
      })
      expect(
        results[1]?.profiles
          .find((profile) => profile.id === 'contract.module.surface')
          ?.rules.find((rule) => rule.rule === 'MODULE-SURFACE-CONFORMS')
          ?.diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_EXPORT_MISSING'),
      ).toBe(true)
      expect(
        results[2]?.profiles
          .find((profile) => profile.id === 'contract.module.surface')
          ?.rules.find((rule) => rule.rule === 'MODULE-SURFACE-CONFORMS')
          ?.diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_PUBLIC_TYPE_UNRESOLVED'),
      ).toBe(true)
      expect(
        results[3]?.profiles
          .find((profile) => profile.id === 'contract.module.dependencies')
          ?.rules.find((rule) => rule.rule === 'MODULE-DEPENDENCIES-CONFORM')?.diagnostics[0]?.code,
      ).toBe('MODULE_PACKAGE_UNDECLARED')
      expect(results[4]?.status).toBe('indeterminate')
      expect(
        results[4]?.profiles.find((profile) => profile.id === 'contract.module.structure')?.status,
      ).toBe('indeterminate')
      expect(
        results[4]?.profiles.find((profile) => profile.id === 'contract.module.structure')?.rules[0]
          ?.diagnostics[0]?.code,
      ).toBe('MODULE_TARGET_MISSING')
      expect(
        results[4]?.profiles.find((profile) => profile.id === 'contract.module.surface')?.status,
      ).toBe('indeterminate')
      expect(results[5]?.status).toBe('pass')
      expect(
        results[5]?.profiles.find((profile) => profile.id === 'contract.module.surface')
          ?.evidenceCompleteness[0]?.completeness,
      ).toEqual({ kind: 'complete' })
    } finally {
      await Promise.all(stores.map((store) => store.dispose()))
    }
  })

  it('prefers named union evidence and treats qualified platform byte types semantically', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export interface Item { readonly kind: 'item' }
export type Choice = Item | { readonly kind: 'item' }
export function consume(choice: Choice, bytes: Uint8Array): void
`,
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = structuredClone(moduleFact(specification))
    const consume = payload.declarations.find((declaration) => declaration.name === 'consume')
    expect(consume?.callable?.parameters[1]?.type).toEqual({ kind: 'primitive', name: 'bytes' })
    ;(consume!.callable!.parameters[1] as { type: unknown }).type = {
      kind: 'reference',
      identity: 'platform:typescript#Uint8Array',
      name: 'Uint8Array',
      arguments: [],
    }
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload,
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.profiles.flatMap((profile) => profile.rules).flatMap((rule) => rule.diagnostics),
      ).toEqual([])
      expect(result.status).toBe('pass')
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('reuses corpus facts without reusing the previous specification target', async () => {
    const current = await fixture({
      'left/.spec/api.d.ts': 'export interface Left { readonly left: string }\n',
      'right/.spec/api.d.ts': 'export interface Right { readonly right: number }\n',
    })
    fixtures.push(current)
    const [left, right] = await Promise.all([
      compileSpecificationSnapshot(current.root, join(current.root, 'left/.spec')),
      compileSpecificationSnapshot(current.root, join(current.root, 'right/.spec')),
    ])
    const moduleFact = (specification: typeof left): TypeScriptModuleFact => ({
      target: {
        id: specification.module.id,
        name: specification.module.name,
        project: 'tsconfig.json',
        root: specification.module.id.split('/.spec/')[0]!,
        entrypoint: `${specification.module.id.split('/.spec/')[0]!}/index.ts`,
        facades: [],
        aliases: [],
        internals: [],
      },
      exports: specification.module.api!.model!.surface.exports,
      declarations: specification.module.api!.model!.surface.declarations,
      dependencies: [],
      inboundDependencies: [],
      declaredPackages: [],
      developmentPackages: [],
      workspacePackages: [],
      errorCodes: [],
      files: [],
      issues: [],
    })
    const leftFact = moduleFact(left)
    const rightFact = moduleFact(right)
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: left.module.id,
      payload: leftFact,
      additionalFacts: [
        {
          completeness: { kind: 'complete' },
          subject: right.module.id,
          payload: rightFact,
          kind: 'module',
        },
      ],
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    const profiles = createModuleConformanceProfiles()
    try {
      const leftResult = await qualifySpecification({ specification: left, analysis, profiles })
      const rightResult = await qualifySpecification({ specification: right, analysis, profiles })
      expect(leftResult.status).toBe('pass')
      expect(rightResult.status).toBe('pass')
      expect(
        rightResult.profiles
          .find((profile) => profile.id === 'contract.module.surface')
          ?.rules.flatMap((rule) => rule.diagnostics),
      ).toEqual([])
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('binds imported identities through the declared provider facade in focused qualification', async () => {
    const current = await fixture({
      'provider/.spec/api.d.ts': 'export type IssuerId = string & { readonly brand: true }\n',
      'consumer/.spec/api.d.ts':
        "import type { IssuerId } from '../../provider/.spec/api.js'\nexport interface API { readonly issuer: IssuerId }\n",
    })
    fixtures.push(current)
    const [provider, consumer] = await Promise.all([
      compileSpecificationSnapshot(current.root, join(current.root, 'provider/.spec')),
      compileSpecificationSnapshot(current.root, join(current.root, 'consumer/.spec')),
    ])
    const expectedIdentity = provider.module.api!.model!.surface.declarations[0]!.identity
    const codeIdentity = 'ts:provider/child/issuer-id.ts#IssuerId'
    const providerPayload = replaceIdentity(moduleFact(provider), expectedIdentity, codeIdentity)
    const consumerPayload = replaceIdentity(moduleFact(consumer), expectedIdentity, codeIdentity)
    const nestedDeclarations = providerPayload.declarations.map((declaration) => ({
      ...declaration,
      location: { file: 'provider/child/issuer-id.ts', line: 1, column: 1 },
    }))
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: consumer.module.id,
      payload: consumerPayload,
      additionalFacts: [
        {
          completeness: { kind: 'complete' },
          subject: provider.module.id,
          kind: 'module',
          payload: { ...providerPayload, declarations: nestedDeclarations },
        },
        {
          completeness: { kind: 'complete' },
          subject: 'provider/child/.spec/api.d.ts',
          kind: 'module',
          payload: {
            ...providerPayload,
            target: {
              ...providerPayload.target,
              id: 'provider/child/.spec/api.d.ts',
              name: 'provider/child',
              root: 'provider/child',
              entrypoint: 'provider/child/index.ts',
            },
            declarations: nestedDeclarations,
          },
        },
      ],
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification: consumer,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.status,
        JSON.stringify(
          result.profiles.flatMap((profile) => profile.rules),
          null,
          2,
        ),
      ).toBe('pass')
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('retains public declaration dependencies introduced through a wildcard barrel', async () => {
    const current = await fixture({
      'provider/.spec/api.d.ts': 'export interface Provider { readonly id: string }\n',
      'consumer/.spec/api.d.ts': "export * from '../../provider/.spec/api.js'\n",
    })
    fixtures.push(current)
    const consumer = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'consumer/.spec'),
    )

    const contract = compileModuleContract(consumer).module!
    expect(contract.imports).toEqual([
      expect.objectContaining({ source: 'provider/.spec/api.d.ts', name: 'Provider' }),
    ])
  })

  it('keeps reference-typed values distinct while canonicalizing authored type aliases', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export interface Target { readonly id: string }
export type Alias = Target
export const LEFT: Target
export const RIGHT: Target
`,
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload: moduleFact(specification),
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(result.status).toBe('pass')
      expect(
        result.profiles
          .find((profile) => profile.id === 'contract.module.surface')
          ?.rules.flatMap((rule) => rule.diagnostics),
      ).toEqual([])
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('compares authored union aliases through bounded identity-first expansion', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
export interface Left { readonly side: 'left' }
export interface Right { readonly side: 'right' }
export type Aggregate = Left | Right
export type Primitive = null | boolean | number | string
export type Value = Primitive | Aggregate
export type BroadString = string | '*'
export type ClassRef = \`class.\${string}\`
export type InterfaceRef = \`interface.\${string}\`
export type FunctionRef = \`function.\${string}\`
export type Callable = FunctionRef | \`\${ClassRef | InterfaceRef}.method.\${string}\`
export function current(): Left | Right | undefined
`,
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const source = moduleFact(specification)
    const identities = new Map(
      source.declarations.map((declaration) => [declaration.name, declaration.identity]),
    )
    const reference = (name: string) => ({
      kind: 'reference' as const,
      identity: identities.get(name)!,
      name,
      arguments: [],
    })
    const primitive = {
      kind: 'union' as const,
      types: [
        { kind: 'null' as const },
        { kind: 'primitive' as const, name: 'boolean' as const },
        { kind: 'primitive' as const, name: 'number' as const },
        { kind: 'primitive' as const, name: 'string' as const },
      ],
    }
    const payload: TypeScriptModuleFact = {
      ...source,
      declarations: source.declarations.map((declaration) => {
        if (declaration.name === 'Primitive') {
          return { ...declaration, valueType: primitive, authoredValueType: primitive }
        }
        if (declaration.name === 'Value') {
          const valueType = {
            kind: 'union' as const,
            types: [reference('Aggregate'), reference('Primitive')],
          }
          return { ...declaration, valueType, authoredValueType: valueType }
        }
        if (declaration.name === 'BroadString') {
          const valueType = {
            kind: 'union' as const,
            types: [
              { kind: 'literal' as const, value: '*' },
              { kind: 'primitive' as const, name: 'string' as const },
            ],
          }
          return { ...declaration, valueType, authoredValueType: valueType }
        }
        if (declaration.name === 'Callable') {
          const valueType = {
            kind: 'union' as const,
            types: [
              reference('FunctionRef'),
              {
                kind: 'template' as const,
                texts: ['', '.method.', ''],
                types: [
                  {
                    kind: 'union' as const,
                    types: [reference('ClassRef'), reference('InterfaceRef')],
                  },
                  { kind: 'primitive' as const, name: 'string' as const },
                ],
              },
            ],
          }
          return { ...declaration, valueType, authoredValueType: valueType }
        }
        if (declaration.name === 'current' && declaration.callable) {
          return {
            ...declaration,
            callable: {
              ...declaration.callable,
              returns: {
                kind: 'union' as const,
                types: [reference('Aggregate'), { kind: 'undefined' as const }],
              },
            },
          }
        }
        return declaration
      }),
    }
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload,
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.status,
        JSON.stringify(
          result.profiles.flatMap((profile) => profile.rules),
          null,
          2,
        ),
      ).toBe('pass')
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('preserves authored callable returns and accepts qualified source-semantic reductions', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': `
declare const BRAND: unique symbol
export type Branded<Kind extends string> = string & {
  readonly [BRAND]: true
  readonly kind: Kind
}
export type ClassId = Branded<'Class'>
export interface Installation { readonly paths: ReadonlyMap<string, number> }
export interface Options { readonly enabled: boolean }
export interface ExecutionControl { readonly signal: AbortSignal }
export interface SnapshotLease { readonly signal: ExecutionControl['signal'] }
export interface Fluent { next(): this }
export function classId(): ClassId
export function paths(): Installation['paths']
export const patterns: Readonly<{ core: RegExp }>
export const retainedPatterns: Readonly<{ core: RegExp }>
`,
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const contract = compileModuleContract(specification).module!
    expect(
      contract.declarations.find((declaration) => declaration.identity.name === 'classId')?.returns
        ?.expression,
    ).toMatchObject({ kind: 'declaration', declaration: { name: 'ClassId' } })
    expect(
      contract.declarations.find((declaration) => declaration.identity.name === 'paths')?.returns
        ?.expression,
    ).toMatchObject({ kind: 'indexed-access' })
    const expectedFluent = contract.declarations.find(
      (declaration) => declaration.identity.name === 'Fluent',
    )!
    const expectedNext = contract.declarations.find(
      (declaration) => declaration.identity.key === expectedFluent.callables?.[0]?.callable.key,
    )!
    expect(expectedNext.returns?.expression).toEqual({
      kind: 'this',
      owner: expectedFluent.identity.key,
    })

    const sourcePayload = moduleFact(specification)
    const fluent = sourcePayload.declarations.find((declaration) => declaration.name === 'Fluent')!
    const nativeFluentIdentity = 'ts:module/index.ts#Fluent'
    const nativePayload = replaceIdentity(
      sourcePayload,
      fluent.identity,
      nativeFluentIdentity,
    )
    const executionControl = sourcePayload.declarations.find(
      (declaration) => declaration.name === 'ExecutionControl',
    )!
    const payload: TypeScriptModuleFact = {
      ...nativePayload,
      declarations: nativePayload.declarations.map((declaration) => {
        if (declaration.name === 'Options') {
          return {
            ...declaration,
            properties: declaration.properties?.map((property) =>
              property.name === 'enabled'
                ? { ...property, type: { kind: 'primitive' as const, name: 'boolean' as const } }
                : property,
            ),
          }
        }
        if (declaration.name === 'SnapshotLease') {
          return {
            ...declaration,
            properties: declaration.properties?.map((property) =>
              property.name === 'signal'
                ? {
                    ...property,
                    type: {
                      kind: 'indexed-access' as const,
                      object: {
                        kind: 'reference' as const,
                        identity: executionControl.identity,
                        name: executionControl.name,
                        arguments: [],
                      },
                      index: { kind: 'literal' as const, value: 'signal' },
                    },
                  }
                : property,
            ),
          }
        }
        if (declaration.name === 'paths' && declaration.callable && declaration.valueType) {
          return {
            ...declaration,
            callable: { ...declaration.callable, returns: declaration.valueType },
          }
        }
        if (
          declaration.name === 'patterns' &&
          declaration.valueType?.kind === 'reference' &&
          declaration.valueType.name === 'Readonly' &&
          declaration.valueType.arguments[0]?.kind === 'object'
        ) {
          const valueType = declaration.valueType.arguments[0]
          return { ...declaration, valueType, fields: valueType.members }
        }
        return declaration
      }),
    }
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload,
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.status,
        JSON.stringify(
          result.profiles.flatMap((profile) => profile.rules),
          null,
          2,
        ),
      ).toBe('pass')
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('uses recognized partial module evidence for unaffected rules and localizes unsupported types', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = moduleFact(specification)
    const transaction = analysisTransaction({
      completeness: {
        kind: 'partial',
        reasons: [
          {
            code: 'TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL',
            message: 'One declaration contains an explicit unsupported type.',
            effective: { module: specification.module.id },
          },
        ],
      },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload: {
        ...payload,
        issues: [
          {
            code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
            message: 'The fixture type is deliberately unsupported.',
            declaration: payload.declarations[0]!.identity,
          },
        ],
      },
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.structure')?.status,
      ).toBe('pass')
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.dependencies')?.status,
      ).toBe('pass')
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.surface')?.status,
      ).toBe('error')
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.surface')
          ?.evidenceCompleteness[0],
      ).toMatchObject({
        minimumCompleteness: 'partial',
        acceptedPartialReasonCodes: ['TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL'],
        completeness: { kind: 'partial' },
      })
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('does not turn deliberately opaque identity evidence into a surface error', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': '/** @conformance identity */\nexport type API = unknown\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = moduleFact(specification)
    const transaction = analysisTransaction({
      completeness: {
        kind: 'partial',
        reasons: [
          {
            code: 'TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL',
            message: 'The identity-only declaration contains an intentionally opaque type.',
            effective: { module: specification.module.id },
          },
        ],
      },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload: {
        ...payload,
        issues: [
          {
            code: 'TYPESCRIPT_TYPE_UNSUPPORTED',
            message: 'No structural proof is available for the opaque declaration.',
            declaration: payload.declarations[0]!.identity,
          },
        ],
      },
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.surface'),
      ).toMatchObject({ status: 'pass' })
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('grounds public-closure packages at the declaration provider instead of the consumer', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = moduleFact(specification)
    const providerIdentity = 'ts:provider/value.ts#ProviderValue'
    const dependency: TypeScriptDependencyFact = {
      id: typeScriptDependencyIdentity({
        sourceModule: specification.module.id,
        targetModule: 'package:zod',
        kind: 'api',
        sourceFile: 'module/index.ts',
        targetFile: 'package:zod/index.d.ts',
      }),
      sourceModule: specification.module.id,
      targetModule: 'package:zod',
      kind: 'api',
      sourceFile: 'module/index.ts',
      targetFile: 'package:zod/index.d.ts',
      occurrences: [],
    }
    const occurrence = {
      typeOnly: true,
      specifier: '<public-type-closure>',
      deep: false,
      location: { external: 'package:zod/index.d.ts', line: 1, column: 1 } as const,
      declaration: 'ts:package:zod/index.d.ts#ZodType',
      publicPath: [
        payload.exports[0]!.declaration,
        providerIdentity,
        'ts:package:zod/index.d.ts#ZodType',
      ],
    }
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload: {
        ...payload,
        dependencies: [
          {
            ...dependency,
            occurrences: [
              {
                ...occurrence,
                id: typeScriptDependencyOccurrenceIdentity(dependency.id, occurrence),
              },
            ],
          },
        ],
      },
      additionalFacts: [
        {
          completeness: { kind: 'complete' },
          subject: 'provider/.spec/api.d.ts',
          kind: 'module',
          payload: {
            ...payload,
            target: {
              ...payload.target,
              id: 'provider/.spec/api.d.ts',
              name: 'provider',
              root: 'provider',
              entrypoint: 'provider/index.ts',
            },
            exports: [],
            declarations: [
              {
                identity: providerIdentity,
                name: 'ProviderValue',
                kind: 'value',
                location: { file: 'provider/value.ts', line: 1, column: 1 },
                exportPaths: [],
                referencedDeclarations: [],
                issues: [],
              },
            ],
            dependencies: [],
            declaredPackages: ['zod'],
          },
        },
      ],
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      expect(
        result.profiles.find((profile) => profile.id === 'contract.module.dependencies'),
      ).toMatchObject({ status: 'pass', coverage: { inverse: { matched: 1, total: 1 } } })
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })

  it('evaluates every dependency occurrence instead of trusting one public closure path', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API { readonly value: string }\n',
    })
    fixtures.push(current)
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const payload = moduleFact(specification)
    const providerIdentity = 'ts:provider/value.ts#ProviderValue'
    const dependency: TypeScriptDependencyFact = {
      id: typeScriptDependencyIdentity({
        sourceModule: specification.module.id,
        targetModule: 'package:zod',
        kind: 'api',
        sourceFile: 'module/index.ts',
        targetFile: 'package:zod/index.d.ts',
      }),
      sourceModule: specification.module.id,
      targetModule: 'package:zod',
      kind: 'api',
      sourceFile: 'module/index.ts',
      targetFile: 'package:zod/index.d.ts',
      occurrences: [],
    }
    const publicOccurrence = {
      typeOnly: true,
      specifier: '<public-type-closure>',
      deep: false,
      location: { external: 'package:zod/index.d.ts', line: 1, column: 1 } as const,
      declaration: 'ts:package:zod/index.d.ts#ZodType',
      publicPath: [
        payload.exports[0]!.declaration,
        providerIdentity,
        'ts:package:zod/index.d.ts#ZodType',
      ],
    }
    const directOccurrence = {
      typeOnly: true,
      specifier: 'zod',
      deep: false,
      location: { file: 'module/index.ts', line: 2, column: 1 } as const,
      declaration: 'ts:package:zod/index.d.ts#ZodType',
    }
    const transaction = analysisTransaction({
      completeness: { kind: 'complete' },
      namespace: TYPESCRIPT_MODULE_FACT_NAMESPACE,
      kind: 'module',
      subject: specification.module.id,
      payload: {
        ...payload,
        dependencies: [
          {
            ...dependency,
            occurrences: [
              {
                ...publicOccurrence,
                id: typeScriptDependencyOccurrenceIdentity(dependency.id, publicOccurrence),
              },
              {
                ...directOccurrence,
                id: typeScriptDependencyOccurrenceIdentity(dependency.id, directOccurrence),
              },
            ],
          },
        ],
      },
      additionalFacts: [
        {
          completeness: { kind: 'complete' },
          subject: 'provider/.spec/api.d.ts',
          kind: 'module',
          payload: {
            ...payload,
            target: {
              ...payload.target,
              id: 'provider/.spec/api.d.ts',
              name: 'provider',
              root: 'provider',
              entrypoint: 'provider/index.ts',
            },
            exports: [],
            declarations: [
              {
                identity: providerIdentity,
                name: 'ProviderValue',
                kind: 'value',
                location: { file: 'provider/value.ts', line: 1, column: 1 },
                exportPaths: [],
                referencedDeclarations: [],
                issues: [],
              },
            ],
            dependencies: [],
            declaredPackages: ['zod'],
          },
        },
      ],
    })
    const store = createMemoryAnalysisStore()
    await store.commit(transaction)
    const analysis = await store.snapshotSet(
      new Map([[transaction.next.universe, transaction.next.id]]),
      TEST_INVENTORY,
    )
    try {
      const result = await qualifySpecification({
        specification,
        analysis,
        profiles: createModuleConformanceProfiles(),
      })
      const profile = result.profiles.find(
        (candidate) => candidate.id === 'contract.module.dependencies',
      )
      expect(profile).toMatchObject({
        status: 'fail',
        coverage: { inverse: { matched: 0, total: 1 } },
      })
      expect(profile?.rules.flatMap((rule) => rule.diagnostics)).toContainEqual(
        expect.objectContaining({ code: 'MODULE_PACKAGE_UNDECLARED' }),
      )
    } finally {
      await analysis.dispose()
      await store.dispose()
    }
  })
})

function moduleFact(
  specification: Awaited<ReturnType<typeof compileSpecificationSnapshot>>,
): TypeScriptModuleFact {
  const model = specification.module.api!.model!
  return {
    target: {
      id: specification.module.id,
      name: specification.module.name,
      project: 'tsconfig.json',
      root: specification.module.id.split('/.spec/')[0]!,
      entrypoint: `${specification.module.id.split('/.spec/')[0]!}/index.ts`,
      facades: [],
      aliases: [],
      internals: [],
    },
    exports: model.surface.exports,
    declarations: model.surface.declarations,
    dependencies: [],
    inboundDependencies: [],
    declaredPackages: [],
    developmentPackages: [],
    workspacePackages: [],
    errorCodes: [],
    files: [],
    issues: [],
  }
}

function replaceIdentity<Value>(value: Value, from: string, to: string): Value {
  if (value === from) return to as Value
  if (Array.isArray(value)) {
    return value.map((entry) => replaceIdentity(entry, from, to)) as Value
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, replaceIdentity(entry, from, to)]),
  ) as Value
}

function conformanceProfile(
  id: string,
  capability: string,
  evaluate: ConformanceProfile['evaluate'],
): ConformanceProfile {
  return {
    manifest: {
      id,
      version: '1.0.0',
      dependsOn: [],
      requiresCapabilities: [{ capability }],
      rules: ['SURFACE-MATCHES'],
    },
    evaluate,
  }
}

function analysisTransaction(options: {
  readonly completeness: Completeness
  readonly namespace?: string
  readonly kind?: string
  readonly subject?: string
  readonly payload?: unknown
  readonly additionalFacts?: readonly {
    readonly completeness: Completeness
    readonly subject: string
    readonly payload: unknown
    readonly kind?: string
  }[]
}): FactTransaction {
  const universe = deriveAnalysisId('project-universe', 'conformance-fixture', {
    config: 'tsconfig.json',
  }) as ProjectUniverseId
  const producer: ProducerIdentity = {
    id: deriveAnalysisId('producer', 'conformance-fixture', { version: 1 }),
    name: 'conformance-fixture',
    version: '1.0.0',
    protocolVersion: 1,
  }
  const sourceManifest = deriveAnalysisId('source-manifest', 'conformance-fixture', {
    revision: 1,
  }) as SourceManifestId
  const pending = deriveAnalysisId('generation', 'pending', {})
  const namespace = options.namespace ?? 'fixture.surface'
  const subject = options.subject ?? 'fixture'
  const payload = options.payload ?? { exports: ['API'] }
  const entries = [
    { completeness: options.completeness, subject, payload, kind: options.kind },
    ...(options.additionalFacts ?? []),
  ]
  const drafts = entries
    .map((entry) => {
      const kind = entry.kind ?? 'module-surface'
      const fact: Fact = {
        id: deriveAnalysisId('fact', namespace, {
          kind,
          subject: entry.subject,
          payload: entry.payload,
        }),
        generation: pending,
        namespace,
        schemaVersion: 1,
        kind,
        subject: entry.subject,
        completeness: entry.completeness,
        provenance: {
          pass: deriveAnalysisId('pass', namespace, { version: 1 }),
          passVersion: '1.0.0',
          evidence: [],
          inputs: [],
        },
        payload: entry.payload,
      }
      const draft = {
        key: deriveAnalysisId('fact-shard-key', namespace, { module: entry.subject }),
        namespace,
        schemaVersion: 1,
        completion: entry.completeness,
        facts: [fact],
      }
      return { draft, digest: factShardDigest(draft) }
    })
    .sort((left, right) => left.draft.key.localeCompare(right.draft.key))
  const manifest = drafts.map(({ draft, digest }) => ({
    key: draft.key,
    digest,
    namespace,
    schemaVersion: 1,
    facts: draft.facts.length,
  }))
  const generation = generationIdentity(
    {
      universe,
      producer,
      sourceManifest,
      capabilities: [namespace],
    },
    manifest,
  )
  const shards: FactShard[] = drafts.map(({ draft, digest }) => ({
    ...draft,
    digest,
    facts: draft.facts.map((fact) => ({ ...fact, generation })),
  }))
  return {
    protocolVersion: 1,
    next: {
      id: generation,
      sequence: 1,
      universe,
      producer,
      sourceManifest,
      capabilities: [namespace],
    },
    manifest: shards.map(shardReference),
    upserts: shards,
    deletes: [],
  }
}
