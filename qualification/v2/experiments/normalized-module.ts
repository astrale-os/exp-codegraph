import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  createProcessNativeAnalysisSessionFactory,
  type CapabilityStatus,
  type Fact,
} from '../../../analysis/index.ts'
import {
  createTypeScriptAnalysisService,
  createTypeScriptFactReader,
  TYPESCRIPT_FACT_NAMESPACES,
  type TypeScriptFact,
} from '../../../analysis/typescript/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'

const canonicalBinary = resolve(requiredArgument('--canonical-binary'))
const candidateBinary = resolve(requiredArgument('--candidate-binary'))
const root = await mkdtemp(join(tmpdir(), 'codegraph-normalized-module-'))

try {
  await createFixture(root)
  const canonical = await analyze(canonicalBinary)
  const candidate = await analyze(candidateBinary)

  assert.deepEqual(candidate.capabilities, canonical.capabilities)
  assert.deepEqual(candidate.modules, canonical.modules)
  const normalizedOracle = canonical.physical.declarationFacts > 0
  if (normalizedOracle) {
    assert(candidate.physical.declarationFacts > 0)
    assert.equal(candidate.physical.digest, canonical.physical.digest)
  } else {
    assert.equal(canonical.physical.declarationFacts, 0)
    assert(candidate.physical.declarationFacts > 0)
  }
  assert(candidate.physical.moduleSchemaVersions.every((version) => version === 2))
  if (!normalizedOracle) {
    assert(
      candidate.physical.payloadBytes < canonical.physical.payloadBytes,
      `Normalized payload ${candidate.physical.payloadBytes} did not improve canonical ${canonical.physical.payloadBytes}.`,
    )
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        format: 'astrale.codegraph.normalized-module-equivalence',
        version: 1,
        mode: normalizedOracle ? 'normalized-identity' : 'legacy-normalization',
        logicalModuleEquivalence: true,
        physicalIdentityEquivalence: normalizedOracle,
        capabilitiesEqual: true,
        canonical: canonical.physical,
        candidate: candidate.physical,
        reduction: {
          bytes: canonical.physical.payloadBytes - candidate.physical.payloadBytes,
          ratio: round(candidate.physical.payloadBytes / canonical.physical.payloadBytes),
        },
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createFixture(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, 'src/a'), { recursive: true }),
    mkdir(join(root, 'src/b'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@fixture/normalized-module', type: 'module' }),
    ),
    writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      }),
    ),
    writeFile(
      join(root, 'src/shared.ts'),
      `export interface Shared {
  readonly value: string
  readonly nested?: { readonly count: number; readonly labels: readonly string[] }
}
`,
    ),
    writeFile(
      join(root, 'src/a/index.ts'),
      `import type { Shared } from '../shared.js'
export type { Shared } from '../shared.js'
export interface A { readonly shared: Shared }
`,
    ),
    writeFile(
      join(root, 'src/b/index.ts'),
      `import type { Shared } from '../shared.js'
export type { Shared } from '../shared.js'
export interface B { readonly shared: Shared }
`,
    ),
  ])
}

async function analyze(binary: string): Promise<{
  readonly capabilities: readonly CapabilityStatus[]
  readonly modules: readonly unknown[]
  readonly physical: {
    readonly facts: number
    readonly declarationFacts: number
    readonly moduleFacts: number
    readonly moduleSchemaVersions: readonly number[]
    readonly payloadBytes: number
    readonly digest: string
  }
}> {
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
  const service = await createTypeScriptAnalysisService({
    project: {
      root,
      config: 'tsconfig.json',
      capabilities: [TYPESCRIPT_FACT_NAMESPACES.module],
      modules: [
        moduleBoundary('a', 'A', 'src/a'),
        moduleBoundary('b', 'B', 'src/b'),
      ],
    },
    sessions: createProcessNativeAnalysisSessionFactory({ command: binary }),
    store,
  })
  try {
    const refreshed = await service.refresh()
    const query = await store.open(refreshed.generation.universe, refreshed.generation.id)
    try {
      const physical: Fact[] = []
      for await (const fact of query.export()) physical.push(fact)
      const portablePhysical = physical
        .map(({ generation: _generation, ...fact }) => fact)
        .sort((left, right) => left.id.localeCompare(right.id))
      const logical: TypeScriptFact<'module'>[] = []
      for await (const fact of createTypeScriptFactReader(query).export('module')) {
        logical.push(fact)
      }
      return {
        capabilities: await query.capabilities(),
        modules: logical.map(logicalModule).sort(bySubject),
        physical: {
          facts: physical.length,
          declarationFacts: physical.filter(
            (fact) =>
              fact.namespace === TYPESCRIPT_FACT_NAMESPACES.declaration &&
              fact.kind === 'declaration',
          ).length,
          moduleFacts: physical.filter(
            (fact) =>
              fact.namespace === TYPESCRIPT_FACT_NAMESPACES.module && fact.kind === 'module',
          ).length,
          moduleSchemaVersions: physical
            .filter(
              (fact) =>
                fact.namespace === TYPESCRIPT_FACT_NAMESPACES.module && fact.kind === 'module',
            )
            .map((fact) => fact.schemaVersion)
            .sort(),
          payloadBytes: physical.reduce(
            (bytes, fact) => bytes + Buffer.byteLength(JSON.stringify(fact.payload)),
            0,
          ),
          digest: createHash('sha256').update(stableJson(portablePhysical)).digest('hex'),
        },
      }
    } finally {
      await query.dispose()
    }
  } finally {
    await service.dispose()
    await store.dispose()
  }
}

function moduleBoundary(id: string, name: string, root: string) {
  return {
    id,
    name,
    project: 'tsconfig.json',
    root,
    entrypoint: `${root}/index.ts`,
    facades: [],
    aliases: [],
    internals: [],
  }
}

function logicalModule(fact: TypeScriptFact<'module'>): unknown {
  return {
    id: fact.id,
    namespace: fact.namespace,
    schemaVersion: fact.schemaVersion,
    kind: fact.kind,
    subject: fact.subject,
    completeness: fact.completeness,
    provenance: fact.provenance,
    payload: fact.payload,
  }
}

function bySubject(left: unknown, right: unknown): number {
  return String((left as { readonly subject: unknown }).subject).localeCompare(
    String((right as { readonly subject: unknown }).subject),
  )
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
