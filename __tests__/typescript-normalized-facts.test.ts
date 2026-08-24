import { describe, expect, it } from 'vitest'

import {
  deriveAnalysisId,
  type AnalysisQuery,
  type Fact,
} from '../analysis/index.ts'
import { createTypeScriptFactReader } from '../analysis/typescript/index.ts'

describe('normalized TypeScript module facts', () => {
  /** @evidence TYPESCRIPT-MODULE-DECLARATION-HYDRATION */
  it('hydrates schema-v2 declaration references to the unchanged typed module payload', async () => {
    const fixture = normalizedModuleFixture()
    const reader = createTypeScriptFactReader(queryFor(fixture.facts))

    const page = await reader.facts('module', {}, { limit: 1 })
    expect(page.facts).toHaveLength(1)
    expect(page.facts[0]).toMatchObject({ schemaVersion: 1 })
    expect(page.facts[0]?.payload.declarations).toEqual([
      { ...fixture.declaration.payload.declaration, exportPaths: [['Alpha']] },
    ])

    const streamed = []
    for await (const fact of reader.export('module')) streamed.push(fact)
    expect(streamed).toEqual(page.facts)

    const all = []
    for await (const fact of reader.exportAll()) all.push(fact)
    expect(all.map((fact) => fact.kind)).toEqual(['module'])
    expect(
      all.find((fact) => fact.kind === 'module')?.payload,
    ).toEqual(page.facts[0]?.payload)
  })

  /** @evidence TYPESCRIPT-MODULE-DECLARATION-MISSING */
  it('fails before exposing a module with missing declaration support', async () => {
    const fixture = normalizedModuleFixture()
    const reader = createTypeScriptFactReader(queryFor([fixture.module]))

    await expect(reader.facts('module', {}, { limit: 1 })).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      kind: 'module',
      diagnostics: [`declaration:${fixture.declaration.id}:missing-or-mismatched`],
    })
  })

  /** @evidence TYPESCRIPT-MODULE-DECLARATION-IDENTITY */
  it('rejects duplicate or identity-mismatched declaration support', async () => {
    const fixture = normalizedModuleFixture()
    const duplicate = queryFor(fixture.facts, { duplicateDeclarationLookup: true })
    await expect(
      createTypeScriptFactReader(duplicate).facts('module', {}, { limit: 1 }),
    ).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      kind: 'declaration',
      diagnostics: ['fact:duplicate'],
    })

    const mismatched: Fact = {
      ...fixture.declaration,
      payload: {
        declaration: {
          ...fixture.declaration.payload.declaration,
          identity: 'ts:fixture#Different',
        },
      },
    }
    await expect(
      createTypeScriptFactReader(queryFor([fixture.module, mismatched])).facts(
        'module',
        {},
        { limit: 1 },
      ),
    ).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      kind: 'module',
      diagnostics: [`declaration:${fixture.declaration.id}:missing-or-mismatched`],
    })
  })

  /** @evidence TYPESCRIPT-MODULE-DECLARATION-PHYSICAL-FAULTS */
  it('ignores support shard order and rejects malformed or duplicate streamed support', async () => {
    const fixture = normalizedModuleFixture()
    const betaIdentity = 'ts:fixture#Beta'
    const beta: Fact = {
      ...fixture.declaration,
      id: deriveAnalysisId('fact', 'astrale.typescript.module', { identity: betaIdentity }),
      subject: betaIdentity,
      payload: {
        declaration: {
          ...fixture.declaration.payload.declaration,
          identity: betaIdentity,
          name: 'Beta',
        },
      },
    }
    const module: Fact = {
      ...fixture.module,
      payload: {
        ...(fixture.module.payload as Record<string, unknown>),
        declarations: [
          { fact: fixture.declaration.id, identity: fixture.declaration.subject, exportPaths: [['Alpha']] },
          { fact: beta.id, identity: betaIdentity, exportPaths: [['Beta']] },
        ],
      },
    }
    const reordered = createTypeScriptFactReader(queryFor([beta, fixture.declaration, module]))
    await expect(reordered.facts('module')).resolves.toMatchObject({
      facts: [{ payload: { declarations: [{ identity: fixture.declaration.subject }, { identity: betaIdentity }] } }],
    })

    const malformed: Fact = {
      ...fixture.declaration,
      payload: { declaration: { ...fixture.declaration.payload.declaration, name: '' } },
    }
    await expect(
      createTypeScriptFactReader(queryFor([malformed, fixture.module])).facts('module'),
    ).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      kind: 'declaration',
      diagnostics: ['declaration:invalid'],
    })

    const duplicated = createTypeScriptFactReader(
      queryFor(fixture.facts, { duplicateDeclarationExport: true }),
    )
    await expect(async () => {
      for await (const _fact of duplicated.export('module')) void _fact
    }).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      kind: 'declaration',
      diagnostics: ['fact:duplicate'],
    })
  })
})

function normalizedModuleFixture(): {
  readonly facts: readonly Fact[]
  readonly declaration: Fact & {
    readonly payload: {
      readonly declaration: {
        readonly identity: string
        readonly name: string
        readonly kind: string
        readonly location: { readonly file: string; readonly line: number; readonly column: number }
        readonly exportPaths: readonly (readonly string[])[]
        readonly referencedDeclarations: readonly string[]
        readonly issues: readonly unknown[]
      }
    }
  }
  readonly module: Fact
} {
  const generation = deriveAnalysisId('generation', 'normalized-module-fixture', {})
  const pass = deriveAnalysisId('pass', 'normalized-module-fixture', {})
  const identity = 'ts:fixture#Alpha'
  const canonicalDeclaration = {
    identity,
    name: 'Alpha',
    kind: 'interface',
    location: { file: 'src/alpha.ts', line: 1, column: 1 },
    exportPaths: [] as readonly (readonly string[])[],
    referencedDeclarations: [] as readonly string[],
    issues: [] as readonly unknown[],
  }
  const declaration = {
    id: deriveAnalysisId('fact', 'astrale.typescript.module', {
      identity,
      declaration: canonicalDeclaration,
    }),
    generation,
    namespace: 'astrale.typescript.module',
    schemaVersion: 2,
    kind: 'declaration',
    subject: identity,
    completeness: { kind: 'complete' } as const,
    provenance: { pass, passVersion: '1.0.0', evidence: [], inputs: [] },
    payload: { declaration: canonicalDeclaration },
  }
  const module = {
    id: deriveAnalysisId('fact', 'astrale.typescript.module', { module: 'fixture' }),
    generation,
    namespace: 'astrale.typescript.module',
    schemaVersion: 2,
    kind: 'module',
    subject: 'fixture',
    completeness: { kind: 'complete' } as const,
    provenance: { pass, passVersion: '1.0.0', evidence: [], inputs: [] },
    payload: {
      target: {
        id: 'fixture',
        name: 'Fixture',
        project: 'tsconfig.json',
        root: '.',
        entrypoint: 'src/index.ts',
        facades: [],
        aliases: [],
        internals: [],
      },
      exports: [],
      declarations: [{ fact: declaration.id, identity, exportPaths: [['Alpha']] }],
      dependencies: [],
      inboundDependencies: [],
      declaredPackages: [],
      developmentPackages: [],
      workspacePackages: [],
      errorCodes: [],
      files: ['src/alpha.ts'],
      issues: [],
    },
  }
  return { facts: [declaration, module], declaration, module }
}

function queryFor(
  facts: readonly Fact[],
  options: {
    readonly duplicateDeclarationLookup?: boolean
    readonly duplicateDeclarationExport?: boolean
  } = {},
): AnalysisQuery {
  const generation = {
    id: facts[0]?.generation ?? deriveAnalysisId('generation', 'empty-normalized-fixture', {}),
    sequence: 1,
    universe: deriveAnalysisId('project-universe', 'normalized-module-fixture', {}),
    producer: {
      id: deriveAnalysisId('producer', 'normalized-module-fixture', {}),
      name: 'normalized-module-fixture',
      version: '1.0.0',
      protocolVersion: 1,
    },
    sourceManifest: deriveAnalysisId('source-manifest', 'normalized-module-fixture', {}),
    capabilities: ['astrale.typescript.module'],
  }
  const selected = (namespaces?: readonly string[], kinds?: readonly string[]) =>
    facts.filter(
      (fact) =>
        (!namespaces?.length || namespaces.includes(fact.namespace)) &&
        (!kinds?.length || kinds.includes(fact.kind)),
    )
  return {
    generation,
    dispose: async () => undefined,
    manifest: async () => [],
    capabilities: async () => generation.capabilities,
    headers: async () => ({ headers: [] }),
    headersById: async () => [],
    async *exportHeaders() {},
    facts: async (filter) => ({ facts: selected(filter.namespaces, filter.kinds) }),
    factsById: async (ids) => {
      const found = facts.filter((fact) => ids.includes(fact.id))
      return options.duplicateDeclarationLookup &&
        found.length === 1 &&
        found[0]?.kind === 'declaration'
        ? [found[0], found[0]]
        : found
    },
    async *export(filter) {
      for (const fact of selected(filter.namespaces, filter.kinds)) {
        yield fact
        if (options.duplicateDeclarationExport && fact.kind === 'declaration') yield fact
      }
    },
  }
}
