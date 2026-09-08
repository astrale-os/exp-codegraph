import { describe, expect, it, vi } from 'vitest'

import {
  deriveAnalysisId,
  type AnalysisQuery,
  type Fact,
} from '../analysis/index.ts'
import {
  admitFactPayloadCodecs,
  bindPhysicalFact,
  createFactWithPhysicalPayload,
} from '../analysis/facts/representation/index.ts'
import {
  createTypeScriptFactReader,
  TYPESCRIPT_BODY_PAYLOAD_CODEC,
  TYPESCRIPT_FACT_PAYLOAD_CODECS,
} from '../analysis/typescript/index.ts'
import { validateTypeScriptFactPayload } from '../analysis/typescript/facts/validate.ts'

vi.mock('../analysis/typescript/facts/validate.ts', async (original) => {
  const actual = await original<typeof import('../analysis/typescript/facts/validate.ts')>()
  return { ...actual, validateTypeScriptFactPayload: vi.fn(actual.validateTypeScriptFactPayload) }
})

describe('immutable TypeScript payload admission', () => {
  /** @evidence TYPESCRIPT-FACT-READER-OWNED-ADMISSION */
  it('reuses successful validation across readers and generations while checking each envelope', async () => {
    const fixture = physicalBodyFact()
    const validate = vi.mocked(validateTypeScriptFactPayload)
    validate.mockClear()
    await createTypeScriptFactReader(queryFor([fixture])).facts('body')
    const next = bindPhysicalFact(fixture, deriveAnalysisId('generation', 'next-body', {}))
    await createTypeScriptFactReader(queryFor([next])).factsById('body', [next.id])
    expect(next.payload).toBe(fixture.payload)
    expect(validate).toHaveBeenCalledTimes(1)
    await expect(createTypeScriptFactReader(queryFor([{ ...next, schemaVersion: 2 }])).facts('body'))
      .rejects.toMatchObject({ diagnostics: ['schema-version:2'] })
    const wrongNamespace = createTypeScriptFactReader(queryFor([{ ...next, namespace: 'wrong' }]))
    await expect(wrongNamespace.factsById('body', [next.id]))
      .rejects.toMatchObject({ diagnostics: ['namespace:wrong'] })
  })

  it('revalidates fully frozen data without an owned decoder certificate', async () => {
    const fixture = projectFact()
    Object.freeze(fixture.payload.configurationFiles)
    Object.freeze(fixture.payload.projectReferences)
    Object.freeze(fixture.payload)
    const validate = vi.mocked(validateTypeScriptFactPayload)
    validate.mockClear()
    const reader = createTypeScriptFactReader(queryFor([fixture]))
    await reader.facts('project')
    await reader.facts('project')
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it('owns open value fragments and freezes descendants below already frozen input containers', async () => {
    let current = 'initial'
    const items = [{ value: 'initial' }]
    const input = Object.freeze({
      nested: Object.freeze({ get value() { return current } }),
      items: Object.freeze(items),
    })
    const fixture = physicalBodyFact(input)
    const reader = createTypeScriptFactReader(queryFor([fixture]))
    const first = (await reader.facts('body')).facts[0]!
    const result = Object.values(first.payload.values)[0]!
    expect(result).toMatchObject({ kind: 'known', value: { nested: { value: 'initial' }, items: [{ value: 'initial' }] } })
    if (result.kind !== 'known') throw new Error('Expected known fixture value')
    const value = result.value as typeof input
    expect(value).not.toBe(input)
    expect(Object.isFrozen(value.nested)).toBe(true)
    expect(Object.isFrozen(value.items[0])).toBe(true)
    current = 'changed'
    items[0]!.value = 'changed'
    expect((await reader.facts('body')).facts[0]!.payload).toBe(first.payload)
    expect(value.nested.value).toBe('initial')
    expect(value.items[0]!.value).toBe('initial')
  })

  it('constructs plain output arrays without invoking caller map methods or array species', async () => {
    class CallerArray extends Array<unknown> {}
    const fixture = physicalBodyFact('literal', (values) => {
      const collection = CallerArray.from(values)
      Object.defineProperty(collection, 'map', { value: () => { throw new Error('Caller map invoked') } })
      return collection
    })
    const fact = (await createTypeScriptFactReader(queryFor([fixture])).facts('body')).facts[0]!
    for (const value of Object.values(fact.payload.body)) {
      if (Array.isArray(value)) expect(Object.getPrototypeOf(value)).toBe(Array.prototype)
    }
    expect(fact.payload.body.occurrences).toHaveLength(1)
  })

  it.each([false, true])('revalidates mutable descendants even under a frozen envelope (shallow=%s)', async (shallow) => {
    const fixture = projectFact()
    if (shallow) Object.freeze(fixture.payload)
    const reader = createTypeScriptFactReader(queryFor([fixture]))
    await reader.facts('project')
    fixture.payload.configurationFiles.push(42 as unknown as string)
    await expect(reader.facts('project')).rejects.toMatchObject({
      code: 'TYPESCRIPT_FACT_CONTRACT_INVALID',
      diagnostics: ['configurationFiles:not-string-array'],
    })
  })

  it('does not cache getter-backed or replacement payloads with unchanged fact IDs', async () => {
    const fixture = projectFact()
    let files: unknown = ['tsconfig.json']
    const payload = Object.freeze({ ...fixture.payload, get configurationFiles() { return files } })
    const reader = createTypeScriptFactReader(queryFor([{ ...fixture, payload }]))
    await reader.facts('project')
    files = false
    await expect(reader.facts('project')).rejects.toMatchObject({ code: 'TYPESCRIPT_FACT_CONTRACT_INVALID' })
    const changed = { ...fixture, payload: Object.freeze({ ...fixture.payload, projectReferences: false }) }
    await expect(createTypeScriptFactReader(queryFor([changed])).facts('project'))
      .rejects.toMatchObject({ code: 'TYPESCRIPT_FACT_CONTRACT_INVALID' })
  })

  /** @evidence TYPESCRIPT-FACT-READER-CUSTOM-ADMISSION */
  it.each([false, true])('revalidates frozen proxies, including custom codecs with a built-in name (physical=%s)', async (physical) => {
    const fixture = projectFact()
    let files: unknown = Object.freeze(['tsconfig.json'])
    const payload = new Proxy(Object.freeze({}), {
      get(_target, key) {
        if (key === 'universe') return 'fixture'
        if (key === 'configurationFiles') return files
        if (key === 'projectReferences') return Object.freeze([])
        return undefined
      },
    })
    const fact = physical
      ? createFactWithPhysicalPayload(
          fixture,
          { codec: TYPESCRIPT_BODY_PAYLOAD_CODEC.id, data: null },
          admitFactPayloadCodecs([{ id: TYPESCRIPT_BODY_PAYLOAD_CODEC.id, decode: () => payload }]),
          'custom codec fixture',
        )
      : { ...fixture, payload }
    const reader = createTypeScriptFactReader(queryFor([fact]))
    await reader.facts('project')
    files = false
    await expect(reader.facts('project')).rejects.toMatchObject({
      diagnostics: ['configurationFiles:not-string-array'],
    })
  })
})

function physicalBodyFact(
  value: unknown = 'literal',
  collection: (values: unknown[]) => unknown[] = (values) => values,
): Fact {
  const constants = [1, 2, 3].map((byte) => Buffer.alloc(32, byte).toString('base64url'))
  const { payload: _payload, ...fields } = projectFact()
  const codec = TYPESCRIPT_FACT_PAYLOAD_CODECS.find((entry) => entry.id === 'typescript.body.packed/1')!
  const data: Record<string, unknown> = {
    c: constants, s: [], t: ['expression', 'StringLiteral', 'entry'], p: [],
    o: [[constants[0], 0, 0, 1, 1, -1]], r: [], b: [[2, [0]]], e: [], d: [], a: [],
    u: [[], [], [], [], [], 0], v: [[0, { kind: 'known', value, evidence: [] }]], q: { kind: 'complete' },
  }
  for (const [key, entry] of Object.entries(data)) {
    if (Array.isArray(entry)) data[key] = collection(entry)
  }
  return createFactWithPhysicalPayload(
    { ...fields, namespace: 'typescript.body', kind: 'function-body' },
    {
      codec: codec.id,
      data,
    },
    admitFactPayloadCodecs(TYPESCRIPT_FACT_PAYLOAD_CODECS),
    'owned body fixture',
  )
}

function projectFact() {
  return {
    ...normalizedModuleFixture().module,
    namespace: 'typescript.project',
    kind: 'project',
    schemaVersion: 1,
    payload: { universe: 'fixture', configurationFiles: ['tsconfig.json'], projectReferences: [] as string[] },
  }
}

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
