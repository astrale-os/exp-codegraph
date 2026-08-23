import { afterEach, describe, expect, it } from 'vitest'

import type {
  Fact,
  FactShard,
  FactTransaction,
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
  NativeProjectDescriptor,
  ProducerIdentity,
  ProjectUniverseId,
  SourceManifestId,
} from '../analysis/index.ts'

import {
  deriveAnalysisId,
  factShardDigest,
  generationIdentity,
  shardReference,
} from '../analysis/index.ts'
import { createApplicationAnalysisWorkspace } from '../application/analysis/workspace.ts'
import { ApplicationCompilerRoutingIndex } from '../application/analysis/workspace.optimization.ts'
import { inventoryRepository } from '../repository/index.ts'
import { compileSpecificationSnapshots } from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('application compiler routing optimization', () => {
  it('routes an ordinary edit through exact reverse project dependencies', () => {
    const index = new ApplicationCompilerRoutingIndex()
    const projects = [
      ['consumer/tsconfig.json', [boundary('consumer', 'consumer')]],
      ['owner/tsconfig.json', [boundary('owner', 'owner')]],
      ['unrelated/tsconfig.json', [boundary('unrelated', 'unrelated')]],
    ] as const
    index.update('owner/tsconfig.json', routing('owner', ['owner/source.ts'], []))
    index.update('consumer/tsconfig.json', routing('consumer', ['consumer/source.ts'], ['owner']))
    index.update('unrelated/tsconfig.json', routing('unrelated', ['unrelated/source.ts'], []))

    expect(
      index.affected(
        projects,
        [{ path: 'owner/source.ts', kind: 'change' }],
        false,
      ).map(([project]) => project),
    ).toEqual(['consumer/tsconfig.json', 'owner/tsconfig.json'])
  })

  it('falls back to every project for uncertain topology evidence', () => {
    const index = new ApplicationCompilerRoutingIndex()
    const projects = [
      ['alpha/tsconfig.json', [boundary('alpha', 'alpha')]],
      ['beta/tsconfig.json', [boundary('beta', 'beta')]],
    ] as const
    expect(index.affected(projects, [{ path: 'new.ts', kind: 'add' }], false)).toEqual(projects)
  })

  it('retains at most the project owning the most focused primary modules', () => {
    const index = new ApplicationCompilerRoutingIndex()
    const projects = [
      ['alpha/tsconfig.json', [boundary('alpha.one', 'alpha'), boundary('alpha.two', 'alpha')]],
      ['beta/tsconfig.json', [boundary('beta', 'beta')]],
    ] as const
    expect([...index.retained(projects, ['alpha.one', 'alpha.two', 'beta'])]).toEqual([
      'alpha/tsconfig.json',
    ])
  })

  it('opens projects serially, disposes support compilers, and reuses the focused owner', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/compiler-residency', type: 'module' }),
      'alpha/.spec/api.d.ts': 'export interface Alpha { readonly id: string }\n',
      'alpha/src/index.ts': 'export const alpha = true\n',
      'alpha/tsconfig.json': projectConfiguration(),
      'beta/.spec/api.d.ts': 'export interface Beta { readonly id: string }\n',
      'beta/src/index.ts': 'export const beta = true\n',
      'beta/tsconfig.json': projectConfiguration(),
    })
    fixtures.push(current)
    const specifications = await compileSpecificationSnapshots(current.root, [
      `${current.root}/alpha/.spec`,
      `${current.root}/beta/.spec`,
    ])
    const repository = deriveAnalysisId('repository', 'fixture.compiler-residency', {})
    let inventory = await inventoryRepository({ repository, root: current.root })
    let active = 0
    let maximumActive = 0
    let opens = 0
    const sessions: NativeAnalysisSessionFactory = {
      async open(project) {
        opens++
        active++
        maximumActive = Math.max(maximumActive, active)
        const transaction = moduleTransaction(project)
        let initialized = false
        let disposed = false
        return {
          async request(request) {
            if (request.kind !== 'refresh') throw new Error('Unexpected fixture request.')
            if (!initialized) {
              initialized = true
              return { id: request.id, protocolVersion: 1, kind: 'transaction', transaction }
            }
            return {
              id: request.id,
              protocolVersion: 1,
              kind: 'unchanged',
              generation: transaction.next.id,
            }
          },
          async dispose() {
            if (disposed) return
            disposed = true
            active--
          },
        }
      },
    }
    const workspace = createApplicationAnalysisWorkspace({
      root: current.root,
      repository,
      sessions,
    })
    const alpha = specifications.find((value) => value.root === 'alpha')!
    try {
      const baseline = await workspace.refresh({
        specifications,
        inventory,
        residentModules: [alpha.module.id],
      })
      expect(baseline.results).toHaveLength(2)
      expect(opens).toBe(2)
      expect(active).toBe(1)
      expect(maximumActive).toBe(1)

      await current.write('alpha/src/index.ts', 'export const alpha = false\n')
      inventory = await inventoryRepository({ repository, root: current.root })
      const edited = await workspace.refresh({
        specifications,
        inventory,
        changed: ['alpha/src/index.ts'],
        changes: [{ path: 'alpha/src/index.ts', kind: 'change' }],
        residentModules: [alpha.module.id],
      })
      expect(edited.results).toHaveLength(1)
      expect(opens).toBe(2)
      expect(active).toBe(1)
      expect(maximumActive).toBe(1)
    } finally {
      await workspace.dispose()
    }
    expect(active).toBe(0)
  })
})

function boundary(id: string, root: string): NativeModuleBoundary {
  return {
    id,
    name: id,
    project: `${root}/tsconfig.json`,
    root,
    entrypoint: `${root}/index.ts`,
    facades: [],
    aliases: [],
    internals: [],
  }
}

function routing(module: string, files: readonly string[], dependencies: readonly string[]) {
  return { complete: true, modules: [{ module, files, dependencies }] }
}

function projectConfiguration(): string {
  return JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext' },
    include: ['src/**/*.ts'],
  })
}

function moduleTransaction(project: NativeProjectDescriptor): FactTransaction {
  const universe = deriveAnalysisId('project-universe', 'fixture.compiler-residency', {
    project: project.config,
  }) as ProjectUniverseId
  const producer: ProducerIdentity = {
    id: deriveAnalysisId('producer', 'fixture.compiler-residency', {}),
    name: 'fixture',
    version: '1.0.0',
    protocolVersion: 1,
  }
  const pending = deriveAnalysisId('generation', 'fixture.pending', { project: project.config })
  const facts: Fact[] = (project.modules ?? []).map((module) => ({
    id: deriveAnalysisId('fact', 'astrale.typescript.module', { module: module.id }),
    generation: pending,
    namespace: 'astrale.typescript.module',
    schemaVersion: 1,
    kind: 'module',
    subject: module.id,
    completeness: { kind: 'complete' },
    provenance: {
      pass: deriveAnalysisId('pass', 'fixture.compiler-residency', {}),
      passVersion: '1.0.0',
      evidence: [],
      inputs: [],
    },
    payload: {
      target: module,
      exports: [],
      declarations: [],
      dependencies: [],
      inboundDependencies: [],
      declaredPackages: [],
      developmentPackages: [],
      workspacePackages: [],
      errorCodes: [],
      files: [module.entrypoint],
      issues: [],
    },
  }))
  const pendingShard = {
    key: deriveAnalysisId('fact-shard-key', 'astrale.typescript.module', {
      project: project.config,
    }),
    namespace: 'astrale.typescript.module',
    schemaVersion: 1,
    completion: { kind: 'complete' as const },
    facts,
  }
  const shard: FactShard = { ...pendingShard, digest: factShardDigest(pendingShard) }
  const manifest = [shardReference(shard)]
  const sourceManifest = deriveAnalysisId('source-manifest', 'fixture.compiler-residency', {
    project: project.config,
  }) as SourceManifestId
  const generation = generationIdentity(
    {
      universe,
      producer,
      sourceManifest,
      capabilities: ['astrale.typescript.module'],
    },
    manifest,
  )
  return {
    protocolVersion: 1,
    next: {
      id: generation,
      sequence: 1,
      universe,
      producer,
      sourceManifest,
      capabilities: ['astrale.typescript.module'],
    },
    manifest,
    upserts: [
      {
        ...shard,
        facts: shard.facts.map((fact) => ({ ...fact, generation })),
      },
    ],
    deletes: [],
  }
}
