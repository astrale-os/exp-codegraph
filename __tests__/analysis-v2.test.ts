import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, opendir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { brotliCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS,
  deriveAnalysisId,
  deriveAnalysisSnapshotSetId,
  createProcessNativeAnalysisSessionFactory,
  createNodeSourceTextReader,
  factHeader,
  factShardDigest,
  generationIdentity,
  planPasses,
  portablePath,
  readVerifiedSourceText,
  runPortablePasses,
  runAnalysisPolicies,
  selectAnalysisStore,
  shardReference,
  validateFactShard,
  validateFactTransaction,
  type AnalysisGenerationId,
  type AnalysisPolicy,
  type AnalysisQuery,
  type AnalysisStore,
  type Fact,
  type FactShard,
  type FactShardReference,
  type FactTransaction,
  type NativeAnalysisSessionFactory,
  type PassManifest,
  type ProducerIdentity,
  type PortablePass,
  type ProjectUniverseId,
  type SourceId,
  type SourceManifestId,
  type SourceRevisionId,
  type SymbolId,
} from '../analysis/index.ts'
import { combineCompleteness } from '../analysis/internal/completeness.ts'
import { materializeTransaction, serializeMaterialized } from '../analysis/internal/state.ts'
import { stableJson } from '../analysis/identity/model.ts'
import {
  admitFactPayloadCodecs,
  bindPhysicalFact,
  createFactWithPhysicalPayload,
} from '../analysis/facts/representation/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import {
  createSQLiteAnalysisStore,
  DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION,
} from '../analysis/sqlite/index.ts'
import {
  validateFunctionBodyIR,
  type FunctionBodyIR,
} from '../analysis/typescript/body/index.ts'
import { TYPESCRIPT_BODY_PAYLOAD_CODEC } from '../analysis/typescript/physical/index.ts'
import {
  createTypeScriptFactReader,
  createTypeScriptAnalysisPipeline,
  createTypeScriptAnalysisService,
  typeScriptDependencyIdentity,
  typeScriptDependencyOccurrenceIdentity,
} from '../analysis/typescript/index.ts'
import {
  DEFAULT_BOUNDED_VALUE_LIMITS,
  createBoundedValueEvaluator,
  resolveBoundedValueLimits,
  type ValueResult,
} from '../analysis/typescript/value/index.ts'
import { createNodeRepositoryScanner, inventoryRepository } from '../repository/index.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('TypeSpec V2 generic analysis foundation', () => {
  it('publishes bounded native transport defaults', () => {
    expect(DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS).toEqual({
      maximumFrameBytes: 64 * 1_024 * 1_024,
      transactionChunkFrameBytes: 8 * 1_024 * 1_024,
      maximumTransactionBytes: 384 * 1_024 * 1_024,
      maximumPhysicalTransactionBytes: 512 * 1_024 * 1_024,
      maximumErrorBytes: 1 * 1_024 * 1_024,
    })
    expect(Object.isFrozen(DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS)).toBe(true)
  })

  it('defaults SQLite to independently addressable payloads', () => {
    expect(DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION).toBe('inline-json')
  })

  it('canonicalizes Unicode separators exactly across JavaScript and Go', () => {
    expect(
      stableJson({
        actual: 'line\u2028paragraph\u2029separator',
        literal: String.raw`line\u2028paragraph\u2029separator`,
      }),
    ).toBe(
      String.raw`{"actual":"line\u2028paragraph\u2029separator","literal":"line\\u2028paragraph\\u2029separator"}`,
    )
  })

  it('publishes and validates the effective bounded-value evaluator budget', () => {
    expect(DEFAULT_BOUNDED_VALUE_LIMITS).toEqual({
      maximumDepth: 12,
      maximumSteps: 2_000,
      maximumAlternatives: 32,
    })
    expect(resolveBoundedValueLimits({ maximumDepth: 4 })).toEqual({
      maximumDepth: 4,
      maximumSteps: 2_000,
      maximumAlternatives: 32,
    })
    expect(() => resolveBoundedValueLimits({ maximumSteps: 0 })).toThrow('positive integer')
  })

  it('canonicalizes and deduplicates completeness reasons independently of traversal order', () => {
    const first = {
      code: 'FIRST_LIMIT',
      message: 'First bounded limitation.',
      effective: { z: 2, a: 1 },
    }
    const second = {
      code: 'SECOND_LIMIT',
      message: 'Second bounded limitation.',
      effective: { maximum: 3 },
    }
    const forward = combineCompleteness(
      { kind: 'partial', reasons: [second, first] },
      { kind: 'partial', reasons: [first] },
    )
    const reverse = combineCompleteness(
      { kind: 'partial', reasons: [first] },
      { kind: 'partial', reasons: [first, second] },
    )

    expect(forward).toEqual(reverse)
    expect(forward).toEqual({ kind: 'partial', reasons: [first, second] })
  })

  it('derives canonical portable identities and rejects checkout-local paths', () => {
    expect(deriveAnalysisId('fact', 'fixture', { b: 2, a: 1 })).toBe(
      deriveAnalysisId('fact', 'fixture', { a: 1, b: 2 }),
    )
    expect(
      deriveAnalysisId('fact', 'canonical-order-regression', {
        callables: [],
        callSignatureCount: 0,
      }),
    ).toBe('fact:d8c98fc5a89d3233ac42d490abf22448ea72347dcab305496c549e9efd2a9e35')
    expect(deriveAnalysisId('fact', 'canonical-unicode-regression', { 𐀀: 1, '\uE000': 2 })).toBe(
      'fact:2e638331e9b9e369c79a58f2efa7a31d2edab58e18a5f79f878fbfaaf92a778c',
    )
    expect(portablePath('src/../src/index.ts')).toBe('src/index.ts')
    expect(() => portablePath('../outside.ts')).toThrow('escapes')
    expect(() => portablePath(resolve('/tmp/outside.ts'))).toThrow('relative POSIX')
    expect(() => portablePath('windows\\path.ts')).toThrow('relative POSIX')
  })

  it('keeps dependency relationship identity stable while preserving reordered occurrences', () => {
    const relationship = {
      sourceModule: 'fixture.source',
      targetModule: 'fixture.target',
      kind: 'api' as const,
      sourceFile: 'src/index.ts',
      targetFile: 'target/index.ts',
    }
    const dependency = typeScriptDependencyIdentity(relationship)
    const occurrences = [
      {
        typeOnly: true,
        specifier: './target.js',
        deep: false,
        location: { file: 'src/index.ts', line: 3, column: 1 } as const,
      },
      {
        typeOnly: true,
        specifier: '<public-type-closure>',
        deep: false,
        location: { file: 'target/index.ts', line: 8, column: 1 } as const,
        declaration: 'ts:target/index.ts:0:266#Target',
      },
    ]
    expect(typeScriptDependencyIdentity({ ...relationship })).toBe(dependency)
    expect(
      occurrences
        .map((occurrence) => typeScriptDependencyOccurrenceIdentity(dependency, occurrence))
        .sort(),
    ).toEqual(
      [...occurrences]
        .reverse()
        .map((occurrence) => typeScriptDependencyOccurrenceIdentity(dependency, occurrence))
        .sort(),
    )
    expect(
      typeScriptDependencyOccurrenceIdentity(dependency, {
        ...occurrences[0]!,
        publicPath: ['ts:fixture#Root', 'ts:provider#Value'],
      }),
    ).not.toBe(typeScriptDependencyOccurrenceIdentity(dependency, occurrences[0]!))
  })

  it('enforces the extraction-ready production import DAG and headless boundary', async () => {
    const analysisRoot = resolve(import.meta.dirname, '../analysis')
    const files = await typescriptFiles(analysisRoot)
    const allowed: Record<string, ReadonlySet<string>> = {
      facade: new Set([
        'facts',
        'generation',
        'identity',
        'memory',
        'pass',
        'policy',
        'profiling',
        'protocol',
        'query',
        'source',
      ]),
      identity: new Set(),
      facts: new Set(['identity']),
      generation: new Set(['facts', 'identity']),
      query: new Set(['facts', 'generation', 'identity']),
      source: new Set(['identity']),
      pass: new Set(['facts', 'generation', 'identity', 'query']),
      policy: new Set(['facts', 'identity', 'pass', 'query']),
      profiling: new Set(),
      internal: new Set(['facts', 'generation', 'identity', 'query']),
      memory: new Set(['generation', 'identity', 'internal', 'profiling', 'query']),
      protocol: new Set(['facts', 'generation', 'identity', 'profiling']),
      sqlite: new Set(['facts', 'generation', 'identity', 'internal', 'profiling', 'query']),
      typescript: new Set([
        'facts',
        'generation',
        'identity',
        'memory',
        'pass',
        'profiling',
        'protocol',
        'query',
      ]),
    }
    const violations: string[] = []
    for (const file of files) {
      const sourceOwner = analysisOwner(analysisRoot, file)
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(/@astrale-os\/spec|\.\.\/catalog|\.\.\/server|\.\.\/viewer/u)
      for (const specifier of relativeImports(source)) {
        const target = resolve(file, '..', specifier)
        const targetOwner = analysisOwner(analysisRoot, target)
        if (
          targetOwner !== sourceOwner &&
          targetOwner !== 'facade' &&
          !allowed[sourceOwner]?.has(targetOwner)
        ) {
          violations.push(`${sourceOwner}:${file} -> ${targetOwner}:${specifier}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('returns source text only after its digest and generation revision still match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-source-text-'))
    temporary.push(root)
    const path = 'src/example.ts'
    await mkdir(join(root, 'src'), { recursive: true })
    const original = 'export const value = 1\n'
    await writeFile(join(root, path), original)
    const source = deriveAnalysisId('source', 'source-text-fixture', { path })
    const textDigest = createHash('sha256').update(original).digest('hex')
    const revision = deriveAnalysisId('source-revision', source, { digest: textDigest })
    const expectation = { source, revision, logicalPath: path, textDigest }
    const reader = createNodeSourceTextReader(root)

    await expect(readVerifiedSourceText(expectation, reader)).resolves.toEqual({
      kind: 'verified',
      source,
      revision,
      logicalPath: path,
      textDigest,
      text: original,
    })
    await writeFile(join(root, path), 'export const value = 2\n')
    const stale = await readVerifiedSourceText(expectation, reader)
    expect(stale).toMatchObject({
      kind: 'stale',
      source,
      revision,
      logicalPath: path,
      expectedDigest: textDigest,
    })
    expect(stale).not.toHaveProperty('text')
    await expect(
      readVerifiedSourceText({ ...expectation, logicalPath: '../outside.ts' }, reader),
    ).rejects.toThrow('escapes')
  })

  /** @evidence CODEGRAPH-PROTOCOL-CANCELLATION */
  it('adapts, validates, aborts, and disposes an explicit native process session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-native-session-'))
    temporary.push(root)
    const sidecar = join(root, 'sidecar.mjs')
    const generation = deriveAnalysisId('generation', 'qualification-sidecar', {})
    await writeFile(
      sidecar,
      `
import { createInterface } from 'node:readline'
const unsupported = ['--payload-codecs-json']
  .filter((argument) => process.argv.includes(argument))
if (unsupported.length) throw new Error('unexpected optional arguments: ' + unsupported.join(','))
const physicalLimit = process.argv.indexOf('--maximum-physical-transaction-bytes')
if (physicalLimit < 0 || process.argv[physicalLimit + 1] !== String(512 * 1024 * 1024)) {
  throw new Error('resolved physical transaction limit was not forwarded')
}
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
  if (request.changed?.includes('hang')) return
  if (request.changed?.includes('legacy-error')) {
    process.stdout.write(JSON.stringify({
      id: request.id,
      protocolVersion: 1,
      kind: 'error',
      code: 'LEGACY_ERROR',
      message: 'legacy protocol-v1 omitted false retryability'
    }) + '\\n')
    return
  }
  if (request.changed?.includes('malformed')) {
    process.stdout.write(JSON.stringify({
      id: request.id,
      protocolVersion: 1,
      kind: 'transaction',
      transaction: {}
    }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({
    id: request.id,
    protocolVersion: 1,
    kind: 'unchanged',
    generation: ${JSON.stringify(generation)}
  }) + '\\n')
})
`,
    )
    const factory = createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
    })
    const project = {
      root,
      config: 'tsconfig.json',
      capabilities: ['fixture'],
      modules: [
        {
          id: 'fixture.root',
          name: 'RootFixture',
          project: 'tsconfig.json',
          root: '.',
          entrypoint: 'index.ts',
          facades: [],
          aliases: [],
          internals: [],
        },
      ],
    }
    const session = await factory.open(project)
    expect(await session.request({ id: 1, kind: 'refresh' })).toEqual({
      id: 1,
      protocolVersion: 1,
      kind: 'unchanged',
      generation,
    })
    expect(await session.request({
      id: 2,
      kind: 'refresh',
      changed: ['legacy-error'],
    })).toEqual({
      id: 2,
      protocolVersion: 1,
      kind: 'error',
      code: 'LEGACY_ERROR',
      message: 'legacy protocol-v1 omitted false retryability',
      retryable: false,
    })
    await session.dispose()
    expect(() => session.request({ id: 3, kind: 'refresh' })).toThrow('disposed')

    const aborted = await factory.open(project)
    const controller = new AbortController()
    const pending = aborted.request(
      { id: 1, kind: 'refresh', changed: ['hang'] },
      { signal: controller.signal },
    )
    controller.abort(new Error('qualification cancellation'))
    await expect(pending).rejects.toThrow('qualification cancellation')
    await aborted.dispose()

    const malformed = await factory.open(project)
    await expect(
      malformed.request({ id: 1, kind: 'refresh', changed: ['malformed'] }),
    ).rejects.toThrow('invalid protocol frame')
    await malformed.dispose()
  })

  it('keeps diagnostic telemetry on a separate descriptor and semantics unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-telemetry-session-'))
    temporary.push(root)
    const sidecar = join(root, 'sidecar.mjs')
    const generation = deriveAnalysisId('generation', 'telemetry-sidecar', {})
    await writeFile(
      sidecar,
      `
import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline'
const profiled = process.argv.includes('--telemetry-fd')
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
  if (profiled) writeSync(3, JSON.stringify({
    format: 'astrale.codegraph.analysis-telemetry',
    version: 1,
    component: 'native',
    phase: 'fixture.refresh',
    request: request.id,
    durationNs: 1,
    metrics: { facts: 0 }
  }) + '\\n')
  process.stdout.write(JSON.stringify({
    id: request.id,
    protocolVersion: 1,
    kind: 'unchanged',
    generation: ${JSON.stringify(generation)}
  }) + '\\n')
})
`,
    )
    const project = {
      root,
      config: 'tsconfig.json',
      capabilities: ['fixture'],
    }
    const plain = await createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
    }).open(project)
    const events: import('../analysis/index.ts').AnalysisTelemetryEvent[] = []
    const profiled = await createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
      telemetry: (event) => events.push(event),
    }).open(project)
    const request = { id: 1, kind: 'refresh' as const }
    const [plainResponse, profiledResponse] = await Promise.all([
      plain.request(request),
      profiled.request(request),
    ])
    expect(profiledResponse).toEqual(plainResponse)
    await expect.poll(() => events.some((event) => event.phase === 'fixture.refresh')).toBe(true)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'native', phase: 'fixture.refresh', request: 1 }),
        expect.objectContaining({ component: 'transport', phase: 'request.roundtrip', request: 1 }),
      ]),
    )
    await Promise.all([plain.dispose(), profiled.dispose()])
  })

  it('terminates a native session with visible evidence when its resident budget is exceeded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-native-resident-limit-'))
    temporary.push(root)
    const sidecar = join(root, 'sidecar.mjs')
    await writeFile(
      sidecar,
      `
import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
})
`,
    )
    const events: import('../analysis/index.ts').AnalysisTelemetryEvent[] = []
    const session = await createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
      maximumResidentBytes: 1_024,
      sampleResidentBytes: async () => 2_048,
      telemetry: (event) => events.push(event),
    }).open({ root, config: 'tsconfig.json', capabilities: ['fixture'] })
    await expect(
      Promise.resolve().then(() => session.request({ id: 1, kind: 'refresh' })),
    ).rejects.toMatchObject({
      name: 'NativeAnalysisProcessResourceError',
      code: 'NATIVE_ANALYSIS_RESIDENT_LIMIT',
      message: expect.stringContaining('resident memory exceeded the configured limit'),
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'transport',
          phase: 'process.resources',
          metrics: expect.objectContaining({ maximumResidentBytes: 1_024 }),
        }),
      ]),
    )
    await session.dispose()
  })

  /** @evidence CODEGRAPH-PROTOCOL-BOUNDED-FRAMES */
  it('assembles bounded native transaction frames and rejects unsafe stream sequences', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-native-framing-'))
    temporary.push(root)
    const sidecar = join(root, 'sidecar.mjs')
    const transaction = buildTransaction({
      sequence: 1,
      values: [`bounded-${'payload'.repeat(900)}`],
    })
    const serialized = JSON.stringify(transaction)
    const digest = createHash('sha256').update(serialized).digest('hex')
    await writeFile(
      sidecar,
      `
import { createInterface } from 'node:readline'
const encoded = Buffer.from(${JSON.stringify(serialized)}, 'utf8')
const digest = ${JSON.stringify(digest)}
const chunkBytes = 256
const chunks = Math.ceil(encoded.length / chunkBytes)
const frame = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const start = (id, overrides = {}) => ({
  id,
  protocolVersion: 1,
  kind: 'transaction-start',
  encoding: 'base64-json',
  bytes: encoded.length,
  chunks,
  sha256: digest,
  ...overrides,
})
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
  const mode = request.changed?.[0]
  if (mode === 'oversized-frame') {
    process.stdout.write('x'.repeat(1025) + '\\n')
    return
  }
  if (mode === 'transaction-limit') {
    frame(start(request.id, { bytes: 40000 }))
    return
  }
  frame(start(request.id))
  if (mode === 'incomplete') {
    process.stdout.write('', () => process.exit(0))
    return
  }
  if (mode === 'out-of-order') {
    frame({
      id: request.id,
      protocolVersion: 1,
      kind: 'transaction-chunk',
      sequence: 1,
      data: encoded.subarray(chunkBytes, chunkBytes * 2).toString('base64'),
    })
    return
  }
  for (let sequence = 0; sequence < chunks; sequence++) {
    frame({
      id: request.id,
      protocolVersion: 1,
      kind: 'transaction-chunk',
      sequence,
      data: encoded.subarray(sequence * chunkBytes, (sequence + 1) * chunkBytes).toString('base64'),
    })
  }
  frame({
    id: request.id,
    protocolVersion: 1,
    kind: 'transaction-end',
    bytes: encoded.length,
    chunks,
    sha256: digest,
  })
})
`,
    )
    const factory = createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
      maximumFrameBytes: 1_024,
      maximumTransactionBytes: 32 * 1_024,
      maximumPhysicalTransactionBytes: 32 * 1_024,
    })
    const project = {
      root,
      config: 'tsconfig.json',
      capabilities: ['fixture.values'],
    }

    const successful = await factory.open(project)
    await expect(successful.request({ id: 1, kind: 'refresh' })).resolves.toEqual({
      id: 1,
      protocolVersion: 1,
      kind: 'transaction',
      transaction,
    })
    await successful.dispose()

    const outOfOrder = await factory.open(project)
    await expect(
      outOfOrder.request({ id: 1, kind: 'refresh', changed: ['out-of-order'] }),
    ).rejects.toThrow('invalid protocol frame')
    await outOfOrder.dispose()

    const incomplete = await factory.open(project)
    await expect(
      incomplete.request({ id: 1, kind: 'refresh', changed: ['incomplete'] }),
    ).rejects.toThrow('exited')
    await incomplete.dispose()

    const oversized = await factory.open(project)
    await expect(
      oversized.request({ id: 1, kind: 'refresh', changed: ['oversized-frame'] }),
    ).rejects.toThrow('exceeds the configured frame limit')
    await oversized.dispose()

    const transactionLimit = await factory.open(project)
    await expect(
      transactionLimit.request({ id: 1, kind: 'refresh', changed: ['transaction-limit'] }),
    ).rejects.toThrow('invalid protocol frame')
    await transactionLimit.dispose()
  })

  /** @evidence CODEGRAPH-PROTOCOL-SEMANTIC-PAYLOAD-LIMIT */
  it('enforces decoded semantic payload limits independently of compact wire size', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-native-semantic-limit-'))
    temporary.push(root)
    const sidecar = join(root, 'sidecar.mjs')
    const semantic = 'x'.repeat(2_048)
    const transaction = buildTransaction({ sequence: 1, values: [semantic] })
    const wire = structuredClone(transaction) as unknown as {
      upserts: { facts: Record<string, unknown>[] }[]
    }
    for (const shard of wire.upserts) {
      for (const fact of shard.facts) {
        delete fact.payload
        fact.physicalPayload = {
          codec: 'qualification.semantic-limit/1',
          data: 'small-token',
        }
      }
    }
    await writeFile(
      sidecar,
      `
import { createInterface } from 'node:readline'
const transaction = ${JSON.stringify(wire)}
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
  process.stdout.write(JSON.stringify({
    id: request.id,
    protocolVersion: 1,
    kind: 'transaction',
    transaction,
  }) + '\\n')
})
`,
    )
    const factory = createProcessNativeAnalysisSessionFactory({
      command: process.execPath,
      arguments: [sidecar],
      maximumTransactionBytes: 1_024,
      maximumPhysicalTransactionBytes: 64 * 1_024,
      payloadCodecs: [
        {
          id: 'qualification.semantic-limit/1',
          decode: () => semantic,
        },
      ],
    })
    const session = await factory.open({
      root,
      config: 'tsconfig.json',
      capabilities: ['fixture.values'],
    })
    await expect(session.request({ id: 1, kind: 'refresh' })).rejects.toMatchObject({
      message: 'Native analysis returned an invalid protocol frame.',
      cause: expect.objectContaining({
        message: expect.stringContaining('decoded semantic payload limit'),
      }),
    })
    await session.dispose()
  })

  it('validates semantic shard digests without a cyclic enclosing-generation hash', () => {
    const transaction = buildTransaction({ sequence: 1, values: ['one', 'two'] })
    expect(transaction.upserts.map(validateFactShard)).toEqual([[]])
    expect(validateFactTransaction(transaction)).toEqual([])
    const changedBinding = {
      ...transaction.upserts[0]!,
      facts: transaction.upserts[0]!.facts.map((fact) => ({
        ...fact,
        generation: deriveAnalysisId('generation', 'different', {}),
      })),
    }
    expect(factShardDigest(changedBinding)).toBe(transaction.upserts[0]!.digest)
    expect(validateFactShard(changedBinding)).toEqual([])
  })

  it('commits atomically, rejects stale bases, pins readers, and binds cursors to filters', async () => {
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    try {
      const first = buildTransaction({ sequence: 1, values: ['a', 'b', 'c'] })
      await store.commit(first)
      const pinned = await store.open(first.next.universe)
      try {
        expect((await pinned.facts({}, { limit: 2 })).total).toBeUndefined()
        const page = await pinned.facts({}, { limit: 2, includeTotal: true })
        const expected = first.upserts[0]!.facts.map((fact) => fact.payload)
        expect(page.facts.map((fact) => fact.payload)).toEqual(expected.slice(0, 2))
        expect(page.total).toBe(3)
        expect(page.nextCursor).toBeDefined()
        expect(
          (await pinned.facts({}, { limit: 2, cursor: page.nextCursor })).facts.map(
            (fact) => fact.payload,
          ),
        ).toEqual(expected.slice(2))
        await expect(
          pinned.facts({ kinds: ['different'] }, { limit: 2, cursor: page.nextCursor }),
        ).rejects.toThrow('invalid or stale')

        const second = buildTransaction({
          sequence: 2,
          base: first.next.id,
          values: ['next'],
        })
        await store.commit(second)
        expect((await pinned.facts()).facts.map((fact) => fact.payload)).toEqual(expected)
        const current = await store.open(second.next.universe)
        try {
          expect((await current.facts()).facts.map((fact) => fact.payload)).toEqual(['next'])
        } finally {
          await current.dispose()
        }
        await expect(
          store.commit({ ...second, next: { ...second.next, sequence: 3 } }),
        ).rejects.toThrow('BASE_STALE')
        expect((await store.current(second.next.universe))?.id).toBe(second.next.id)
      } finally {
        await pinned.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  it('rebinds carried semantic shards to the newly committed generation', async () => {
    const store = createMemoryAnalysisStore()
    try {
      const first = buildTransaction({ sequence: 1, values: ['stable'] })
      await store.commit(first)
      const sourceManifest = deriveAnalysisId('source-manifest', 'qualification', {
        revision: 2,
      }) as SourceManifestId
      const id = generationIdentity(
        {
          universe: first.next.universe,
          producer: first.next.producer,
          sourceManifest,
          capabilities: first.next.capabilities,
        },
        first.manifest,
      )
      await store.commit({
        protocolVersion: 1,
        base: first.next.id,
        next: {
          ...first.next,
          id,
          sequence: 2,
          sourceManifest,
        },
        manifest: first.manifest,
        upserts: [],
        deletes: [],
      })

      const query = await store.open(first.next.universe)
      try {
        const page = await query.facts({}, { limit: 10 })
        expect(page.facts).toHaveLength(1)
        expect(page.facts[0]!.generation).toBe(id)
      } finally {
        await query.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  it('rolls compiler-derived universes over as complete lineages and reuses a restored universe', async () => {
    const firstUniverse = deriveAnalysisId('project-universe', 'universe-rollover', {
      configuration: 'first',
    })
    const secondUniverse = deriveAnalysisId('project-universe', 'universe-rollover', {
      configuration: 'second',
    })
    const first = buildTransaction({
      universe: firstUniverse,
      sequence: 1,
      sourceRevision: 'first',
      values: ['first'],
    })
    const second = buildTransaction({
      universe: secondUniverse,
      sequence: 1,
      sourceRevision: 'second',
      values: ['second'],
    })
    const responses = [first, second, first]
    const sessions: NativeAnalysisSessionFactory = {
      async open() {
        return {
          async request(request) {
            const transaction = responses.shift()
            if (!transaction) throw new Error('Unexpected universe rollover request.')
            return {
              id: request.id,
              protocolVersion: 1,
              kind: 'transaction' as const,
              transaction,
            }
          },
          async dispose() {},
        }
      },
    }
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 4 })
    const service = await createTypeScriptAnalysisService({
      project: {
        root: resolve('/tmp/typespec-v2-universe-rollover'),
        config: 'tsconfig.json',
        capabilities: ['fixture.values'],
      },
      sessions,
      store,
    })
    try {
      const initial = await service.refresh()
      expect(initial.generation).toEqual(first.next)
      expect(initial.transaction).toEqual(first)

      const rolled = await service.refresh({ changed: ['tsconfig.json'] })
      expect(service.universe).toBe(secondUniverse)
      expect(rolled.generation).toEqual(second.next)
      expect(rolled.transaction?.base).toBeUndefined()

      const restored = await service.refresh({ changed: ['tsconfig.json'] })
      expect(service.universe).toBe(firstUniverse)
      expect(restored.generation).toEqual(first.next)
      expect(restored.transaction).toBeUndefined()
      expect(await snapshotOfFacts(store, firstUniverse)).toEqual(['first'])
      expect(await snapshotOfFacts(store, secondUniverse)).toEqual(['second'])
    } finally {
      await service.dispose()
      await store.dispose()
    }
  })

  /** @evidence CODEGRAPH-PROTOCOL-COMMIT-LATE */
  it('acknowledges native publication only after the application store commits', async () => {
    const transaction = buildTransaction({ sequence: 1, values: ['commit-late'] })
    const backing = createMemoryAnalysisStore()
    let rejectCommit = true
    const store: AnalysisStore = {
      dispose: () => backing.dispose(),
      current: (universe) => backing.current(universe),
      commit: async (candidate, options) => {
        if (rejectCommit) throw new Error('qualified store rejection')
        await backing.commit(candidate, options)
      },
      open: (universe, generation) => backing.open(universe, generation),
      snapshotSet: (generations, inventory) => backing.snapshotSet(generations, inventory),
    }
    const acknowledged: string[] = []
    const sessions: NativeAnalysisSessionFactory = {
      async open() {
        return {
          async request(request) {
            if (request.kind !== 'refresh') throw new Error('Unexpected native request.')
            return {
              id: request.id,
              protocolVersion: 1,
              kind: 'transaction' as const,
              transaction,
            }
          },
          async acknowledge(value) {
            acknowledged.push(value.generation)
          },
          async dispose() {},
        }
      },
    }
    const service = await createTypeScriptAnalysisService({
      project: {
        root: resolve('/tmp/typespec-v2-commit-late'),
        config: 'tsconfig.json',
        capabilities: ['fixture.values'],
      },
      sessions,
      store,
    })
    try {
      await expect(service.refresh()).rejects.toThrow('qualified store rejection')
      expect(acknowledged).toEqual([])
      expect(await backing.current(transaction.next.universe)).toBeUndefined()

      rejectCommit = false
      await expect(service.refresh()).resolves.toMatchObject({ generation: transaction.next })
      expect(acknowledged).toEqual([transaction.next.id])
      expect(await backing.current(transaction.next.universe)).toEqual(transaction.next)
    } finally {
      await service.dispose()
      await store.dispose()
    }
  })

  it('allows a content-addressed generation to recur at a later sequence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-recurrence-'))
    temporary.push(root)
    const stores: AnalysisStore[] = [
      createMemoryAnalysisStore({ maximumRetainedGenerations: 4 }),
      await createSQLiteAnalysisStore({
        file: join(root, 'analysis.sqlite'),
        namespace: 'recurrence',
      }),
    ]
    for (const store of stores) {
      try {
        const first = buildTransaction({ sequence: 1, values: ['a'], sourceRevision: 'a' })
        const second = buildTransaction({
          sequence: 2,
          base: first.next.id,
          values: ['b'],
          sourceRevision: 'b',
        })
        const third = buildTransaction({
          sequence: 3,
          base: second.next.id,
          values: ['a'],
          sourceRevision: 'a',
        })
        expect(third.next.id).toBe(first.next.id)
        await store.commit(first)
        await store.commit(second)
        await store.commit(third)
        expect(await store.current(first.next.universe)).toMatchObject({
          id: first.next.id,
          sequence: 3,
        })
        const query = await store.open(first.next.universe, first.next.id)
        try {
          expect(query.generation.sequence).toBe(3)
          expect((await query.facts()).facts.map((fact) => fact.payload)).toEqual(['a'])
        } finally {
          await query.dispose()
        }
      } finally {
        await store.dispose()
      }
    }
  })

  it('keeps memory and SQLite query semantics equivalent and persists exact snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const transaction = buildTransaction({ sequence: 1, values: ['alpha', 'beta'] })
    const memory = createMemoryAnalysisStore()
    const sqlite = await createSQLiteAnalysisStore({ file, namespace: 'qualification' })
    try {
      await memory.commit(transaction)
      await sqlite.commit(transaction)
      expect(await snapshot(memory, transaction.next.universe)).toEqual(
        await snapshot(sqlite, transaction.next.universe),
      )
      await sqlite.dispose()

      const reopened = await createSQLiteAnalysisStore({ file, namespace: 'qualification' })
      try {
        expect(await snapshot(reopened, transaction.next.universe)).toEqual(
          await snapshot(memory, transaction.next.universe),
        )
      } finally {
        await reopened.dispose()
      }
    } finally {
      await sqlite.dispose()
      await memory.dispose()
    }
  })

  it('preserves arbitrary semantic payload keys across memory and SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-semantic-payload-'))
    temporary.push(root)
    const payload = { $codegraph: 'semantic-domain-tag', data: 1 }
    const transaction = buildTransaction({ sequence: 1, values: [payload] })
    const memory = createMemoryAnalysisStore()
    try {
      await memory.commit(transaction)
      expect(await snapshotOfFacts(memory, transaction.next.universe)).toEqual([payload])
      for (const payloadMaterialization of ['inline-json', 'shard-brotli'] as const) {
        const options = {
          file: join(root, `${payloadMaterialization}.sqlite`),
          namespace: `semantic-payload-${payloadMaterialization}`,
          payloadMaterialization,
        }
        const sqlite = await createSQLiteAnalysisStore(options)
        try {
          await sqlite.commit(transaction)
          expect(await snapshotOfFacts(sqlite, transaction.next.universe)).toEqual([payload])
        } finally {
          await sqlite.dispose()
        }
        const reopened = await createSQLiteAnalysisStore(options)
        try {
          expect(await snapshotOfFacts(reopened, transaction.next.universe)).toEqual([payload])
        } finally {
          await reopened.dispose()
        }
      }
    } finally {
      await memory.dispose()
    }
  })

  it('decodes physical payload identity ephemerally and memoizes public reads', () => {
    const transaction = buildTransaction({ sequence: 1, values: ['semantic'] })
    const original = transaction.upserts[0]!.facts[0]!
    let decodes = 0
    const codecs = admitFactPayloadCodecs([
      {
        id: 'qualification.counted/1',
        decode(data) {
          decodes += 1
          return { data }
        },
      },
    ])
    const fact = createFactWithPhysicalPayload(
      {
        id: original.id,
        generation: original.generation,
        namespace: original.namespace,
        schemaVersion: original.schemaVersion,
        kind: original.kind,
        subject: original.subject,
        completeness: original.completeness,
        provenance: original.provenance,
      },
      { codec: 'qualification.counted/1', data: 'physical' },
      codecs,
      'qualification fact',
    )
    const draft = {
      key: transaction.upserts[0]!.key,
      namespace: fact.namespace,
      schemaVersion: fact.schemaVersion,
      completion: { kind: 'complete' } as const,
      facts: [fact],
    }
    const digest = factShardDigest(draft)
    const afterIdentity = decodes
    const shard = { ...draft, digest }
    expect(validateFactShard(shard)).toEqual([])
    expect(decodes).toBe(afterIdentity + 1)
    expect(validateFactShard(shard)).toEqual([])
    expect(decodes).toBe(afterIdentity + 1)
    const first = fact.payload
    const second = fact.payload
    expect(first).toBe(second)
    expect(first).toEqual({ data: 'physical' })
    expect(decodes).toBe(afterIdentity + 2)
  })

  it('selects memory and SQLite headers without decoding physical payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-header-hydration-'))
    temporary.push(root)
    const semantic = buildTransaction({ sequence: 1, values: ['semantic'] })
    const original = semantic.upserts[0]!.facts[0]!
    let decodes = 0
    const codec = {
      id: 'qualification.header-counted/1',
      decode(data: unknown) {
        decodes += 1
        return { data }
      },
    }
    const codecs = admitFactPayloadCodecs([codec])
    const physical = createFactWithPhysicalPayload(
      {
        id: original.id,
        generation: original.generation,
        namespace: original.namespace,
        schemaVersion: original.schemaVersion,
        kind: original.kind,
        subject: original.subject,
        completeness: original.completeness,
        provenance: original.provenance,
      },
      { codec: codec.id, data: 'physical' },
      codecs,
      'header qualification fact',
    )
    const draft = {
      key: semantic.upserts[0]!.key,
      namespace: physical.namespace,
      schemaVersion: physical.schemaVersion,
      completion: { kind: 'complete' } as const,
      facts: [physical],
    }
    const shard = { ...draft, digest: factShardDigest(draft) }
    const manifest = [shardReference(shard)]
    const generation = generationIdentity(
      {
        universe: semantic.next.universe,
        producer: semantic.next.producer,
        sourceManifest: semantic.next.sourceManifest,
        capabilities: semantic.next.capabilities,
      },
      manifest,
    )
    const transaction: FactTransaction = {
      protocolVersion: 1,
      next: { ...semantic.next, id: generation },
      manifest,
      upserts: [{ ...shard, facts: [bindPhysicalFact(physical, generation)] }],
      deletes: [],
    }
    const memory = createMemoryAnalysisStore()
    const sqlite = await createSQLiteAnalysisStore({
      file: join(root, 'analysis.sqlite'),
      namespace: 'header-hydration',
      payloadCodecs: [codec],
      payloadMaterialization: 'shard-brotli',
    })
    try {
      await memory.commit(transaction)
      await sqlite.commit(transaction)
      const afterCommit = decodes
      const memoryQuery = await memory.open(transaction.next.universe)
      const sqliteQuery = await sqlite.open(transaction.next.universe)
      try {
        for (const query of [memoryQuery, sqliteQuery]) {
          const page = await query.headers({}, { limit: 1 })
          expect(page.headers).toHaveLength(1)
          expect(page.total).toBeUndefined()
          expect((await query.headers({}, { limit: 1, includeTotal: true })).total).toBe(1)
          expect(Object.hasOwn(page.headers[0]!, 'payload')).toBe(false)
          expect(page.headers[0]).toEqual(factHeader(transaction.upserts[0]!.facts[0]!))
          expect(await query.headersById([original.id])).toEqual(page.headers)
          const exported = []
          for await (const header of query.exportHeaders()) exported.push(header)
          expect(exported).toEqual(page.headers)
        }
        expect(decodes).toBe(afterCommit)
        expect((await memoryQuery.factsById([original.id]))[0]!.payload).toEqual({ data: 'physical' })
        expect((await sqliteQuery.factsById([original.id]))[0]!.payload).toEqual({ data: 'physical' })
        expect(decodes).toBe(afterCommit + 2)
      } finally {
        await sqliteQuery.dispose()
        await memoryQuery.dispose()
      }
    } finally {
      await sqlite.dispose()
      await memory.dispose()
    }
  })

  it('binds snapshot-set identity to the exact repository inventory revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-snapshot-inventory-'))
    temporary.push(root)
    const transaction = buildTransaction({ sequence: 1, values: ['alpha'] })
    const memory = createMemoryAnalysisStore()
    const sqlite = await createSQLiteAnalysisStore({
      file: join(root, 'analysis.sqlite'),
      namespace: 'snapshot-inventory',
    })
    const firstInventory = deriveAnalysisId('source-manifest', 'repository-inventory', {
      revision: 1,
    })
    const secondInventory = deriveAnalysisId('source-manifest', 'repository-inventory', {
      revision: 2,
    })
    const generations = new Map([[transaction.next.universe, transaction.next.id]])
    try {
      await memory.commit(transaction)
      await sqlite.commit(transaction)
      const memoryFirst = await memory.snapshotSet(generations, firstInventory)
      const sqliteFirst = await sqlite.snapshotSet(generations, firstInventory)
      const memorySecond = await memory.snapshotSet(generations, secondInventory)
      try {
        expect(memoryFirst.id).toBe(sqliteFirst.id)
        expect(memoryFirst.id).toBe(deriveAnalysisSnapshotSetId(generations, firstInventory))
        expect(memoryFirst.inventory).toBe(firstInventory)
        expect(sqliteFirst.inventory).toBe(firstInventory)
        expect([...memoryFirst.generations]).toEqual([...generations])
        expect([...sqliteFirst.generations]).toEqual([...generations])
        expect(memorySecond.id).not.toBe(memoryFirst.id)
      } finally {
        await memorySecond.dispose()
        await sqliteFirst.dispose()
        await memoryFirst.dispose()
      }
    } finally {
      await sqlite.dispose()
      await memory.dispose()
    }
  })

  it('uses normalized content-addressed rows and preserves indexed query equivalence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-normalized-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const transaction = buildRichTransaction()
    const memory = createMemoryAnalysisStore()
    const sqlite = await createSQLiteAnalysisStore({
      file,
      namespace: 'normalized',
    })
    try {
      await memory.commit(transaction)
      await sqlite.commit(transaction)
      const symbol = transaction.upserts[0]!.facts[0]!.subject as SymbolId
      const source = transaction.upserts[0]!.facts[0]!.provenance.evidence[0]!.source
      const filters = [
        {},
        { namespaces: ['fixture.values'] },
        { kinds: ['symbol'] },
        { subjects: [symbol] },
        { sources: [source] },
        { symbols: [symbol] },
        { completeness: ['partial'] as const },
      ]
      for (const filter of filters) {
        const left = await memory.open(transaction.next.universe)
        const right = await sqlite.open(transaction.next.universe)
        try {
          const leftPage = await left.facts(filter, { limit: 1, includeTotal: true })
          const rightPage = await right.facts(filter, { limit: 1, includeTotal: true })
          expect(rightPage.facts).toEqual(leftPage.facts)
          expect(rightPage.total).toBe(leftPage.total)
          if (rightPage.nextCursor) {
            expect(
              (await right.facts(filter, { limit: 1, cursor: rightPage.nextCursor })).facts,
            ).toEqual((await left.facts(filter, { limit: 10 })).facts.slice(1))
          }
          const leftHeaders = await left.headers(filter, { limit: 1, includeTotal: true })
          const rightHeaders = await right.headers(filter, { limit: 1, includeTotal: true })
          expect(rightHeaders.headers).toEqual(leftHeaders.headers)
          expect(rightHeaders.total).toBe(leftHeaders.total)
          expect(Boolean(rightHeaders.nextCursor)).toBe(Boolean(leftHeaders.nextCursor))
          expect(rightHeaders.headers).toEqual(leftPage.facts.map(factHeader))
          if (rightHeaders.nextCursor) {
            expect(
              (await right.headers(filter, { limit: 1, cursor: rightHeaders.nextCursor })).headers,
            ).toEqual((await left.headers(filter, { limit: 10 })).headers.slice(1))
          }
        } finally {
          await right.dispose()
          await left.dispose()
        }
      }

      const nextManifest = deriveAnalysisId('source-manifest', 'normalized-carry', {
        revision: 2,
      }) as SourceManifestId
      const nextId = generationIdentity(
        {
          universe: transaction.next.universe,
          producer: transaction.next.producer,
          sourceManifest: nextManifest,
          capabilities: transaction.next.capabilities,
        },
        transaction.manifest,
      )
      const carry: FactTransaction = {
        protocolVersion: 1,
        base: transaction.next.id,
        next: {
          ...transaction.next,
          id: nextId,
          sequence: 2,
          sourceManifest: nextManifest,
        },
        manifest: transaction.manifest,
        upserts: [],
        deletes: [],
      }
      await memory.commit(carry)
      await sqlite.commit(carry)
      expect(await snapshot(memory, transaction.next.universe)).toEqual(
        await snapshot(sqlite, transaction.next.universe),
      )
    } finally {
      await sqlite.dispose()
      await memory.dispose()
    }

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      const generationColumns = database
        .prepare('PRAGMA table_info(analysis_generations)')
        .all()
        .map((column) => (column as { readonly name: string }).name)
      expect(generationColumns).not.toContain('snapshot_json')
      expect(tableCount(database, 'analysis_generations')).toBe(2)
      expect(tableCount(database, 'analysis_shards')).toBe(1)
      expect(tableCount(database, 'analysis_facts')).toBe(2)
      expect(tableCount(database, 'analysis_fact_evidence')).toBe(1)
      expect(tableCount(database, 'analysis_fact_inputs')).toBe(1)
      expect(
        database
          .prepare('SELECT DISTINCT payload_layout FROM analysis_shards')
          .all()
          .map((row) => (row as { readonly payload_layout: string }).payload_layout),
      ).toEqual(['inline-json/1'])
      expect(
        database
          .prepare('PRAGMA table_info(analysis_shards)')
          .all()
          .map((column) => (column as { readonly name: string }).name),
      ).toContain('payload_layout')
      expect(
        database
          .prepare("PRAGMA index_list('analysis_facts')")
          .all()
          .map((index) => (index as { readonly name: string }).name),
      ).toContain('analysis_facts_by_completeness')
    } finally {
      database.close()
    }
  })

  it('rejects a delta when an unaffected shard still consumes a removed fact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-delta-closure-'))
    temporary.push(root)
    const base = buildTwoShardTransaction()
    const owner = base.upserts.find((shard) => shard.namespace === 'fixture.values')!
    const consumer = base.upserts.find((shard) => shard.namespace === 'fixture.other')!
    const consumerDraft = {
      ...consumer,
      facts: consumer.facts.map((fact) => ({
        ...fact,
        provenance: { ...fact.provenance, inputs: [owner.facts[0]!.id] },
      })),
    }
    const consuming = { ...consumerDraft, digest: factShardDigest(consumerDraft) }
    const initialDrafts = [owner, consuming].sort((left, right) => left.key.localeCompare(right.key))
    const initialManifest = initialDrafts.map(shardReference)
    const initialId = generationIdentity(
      {
        universe: base.next.universe,
        producer: base.next.producer,
        sourceManifest: base.next.sourceManifest,
        capabilities: base.next.capabilities,
      },
      initialManifest,
    )
    const initial: FactTransaction = {
      ...base,
      next: { ...base.next, id: initialId },
      manifest: initialManifest,
      upserts: initialDrafts.map((shard) => ({
        ...shard,
        facts: shard.facts.map((fact) => ({ ...fact, generation: initialId })),
      })),
    }

    const replacementValue = 'replacement-owner'
    const replacementFact = {
      ...owner.facts[0]!,
      id: deriveAnalysisId('fact', owner.namespace, { value: replacementValue }),
      subject: replacementValue,
      payload: replacementValue,
    }
    const replacementDraft = { ...owner, facts: [replacementFact] }
    const replacement = { ...replacementDraft, digest: factShardDigest(replacementDraft) }
    const nextManifest = [replacement, consuming]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(shardReference)
    const nextSourceManifest = deriveAnalysisId('source-manifest', 'delta-closure', {
      revision: 2,
    }) as SourceManifestId
    const nextId = generationIdentity(
      {
        universe: initial.next.universe,
        producer: initial.next.producer,
        sourceManifest: nextSourceManifest,
        capabilities: initial.next.capabilities,
      },
      nextManifest,
    )
    const invalid: FactTransaction = {
      protocolVersion: 1,
      base: initialId,
      next: {
        ...initial.next,
        id: nextId,
        sequence: 2,
        sourceManifest: nextSourceManifest,
      },
      manifest: nextManifest,
      upserts: [{
        ...replacement,
        facts: replacement.facts.map((fact) => ({ ...fact, generation: nextId })),
      }],
      deletes: [],
    }

    const stores: AnalysisStore[] = [
      createMemoryAnalysisStore(),
      await createSQLiteAnalysisStore({
        file: join(root, 'analysis.sqlite'),
        namespace: 'delta-closure',
      }),
    ]
    for (const store of stores) {
      try {
        await store.commit(initial)
        await expect(store.commit(invalid)).rejects.toThrow('names unavailable derivation input')
        expect(await store.current(initial.next.universe)).toEqual(initial.next)
      } finally {
        await store.dispose()
      }
    }
  })

  it('renews SQLite leases across connections and collects only released generations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-lease-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const options = {
      file,
      namespace: 'lease-qualification',
      leaseTimeoutMs: 1_000,
      maximumRetainedGenerations: 1,
    }
    const writer = await createSQLiteAnalysisStore(options)
    const reader = await createSQLiteAnalysisStore(options)
    try {
      const first = buildTransaction({ sequence: 1, values: ['first'] })
      await writer.commit(first)
      const pinned = await reader.open(first.next.universe, first.next.id)
      try {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200))
        const second = buildTransaction({
          sequence: 2,
          base: first.next.id,
          values: ['second'],
        })
        await writer.commit(second)
        const retained = await writer.open(first.next.universe, first.next.id)
        await retained.dispose()
        expect((await pinned.facts()).facts.map((fact) => fact.payload)).toEqual(['first'])
      } finally {
        await pinned.dispose()
      }
      const current = await writer.current(first.next.universe)
      const third = buildTransaction({
        sequence: 3,
        base: current!.id,
        values: ['third'],
      })
      await writer.commit(third)
      await expect(writer.open(first.next.universe, first.next.id)).rejects.toThrow('unavailable')
    } finally {
      await reader.dispose()
      await writer.dispose()
    }
  })

  it('migrates the version-1 durable schema without changing its materialized facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-migration-'))
    temporary.push(root)
    const legacyFile = join(root, 'legacy.sqlite')
    const transaction = buildTransaction({ sequence: 1, values: ['migrated'] })
    const snapshotJson = serializeMaterialized(materializeTransaction(undefined, transaction))

    const legacy = new DatabaseSync(legacyFile)
    legacy.exec(`
CREATE TABLE analysis_generations (
  namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (namespace, universe, generation_id),
  UNIQUE (namespace, universe, sequence)
) STRICT;
CREATE TABLE analysis_current (
  namespace TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  PRIMARY KEY (namespace, universe),
  FOREIGN KEY (namespace, universe, generation_id)
    REFERENCES analysis_generations(namespace, universe, generation_id)
) STRICT;
CREATE TABLE analysis_leases (
  namespace TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  universe TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, lease_id),
  FOREIGN KEY (namespace, universe, generation_id)
    REFERENCES analysis_generations(namespace, universe, generation_id)
) STRICT;
PRAGMA user_version = 1;
`)
    legacy
      .prepare(
        `INSERT INTO analysis_generations
          (namespace, universe, generation_id, sequence, snapshot_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'migration',
        transaction.next.universe,
        transaction.next.id,
        transaction.next.sequence,
        snapshotJson,
      )
    legacy
      .prepare(
        `INSERT INTO analysis_current (namespace, universe, generation_id)
         VALUES (?, ?, ?)`,
      )
      .run('migration', transaction.next.universe, transaction.next.id)
    legacy.close()

    const migrated = await createSQLiteAnalysisStore({ file: legacyFile, namespace: 'migration' })
    try {
      expect(await snapshotOfFacts(migrated, transaction.next.universe)).toEqual(['migrated'])
    } finally {
      await migrated.dispose()
    }
    const verified = new DatabaseSync(legacyFile, { readOnly: true })
    expect(
      (verified.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(7)
    expect(
      verified
        .prepare('PRAGMA table_info(analysis_shards)')
        .all()
        .map((column) => (column as { readonly name: string }).name),
    ).toContain('capabilities_json')
    verified.close()
  })

  it('converges inline schema 4/5 and compressed schema 6 on one schema-7 layout', async () => {
    const roots = await Promise.all(
      ['v4', 'v5', 'v6'].map((version) => mkdtemp(join(tmpdir(), `codegraph-${version}-migration-`))),
    )
    temporary.push(...roots)
    for (const [index, version] of [4, 5].entries()) {
      const file = join(roots[index]!, 'analysis.sqlite')
      const options = {
        file,
        namespace: `migration-v${version}`,
        payloadMaterialization: 'inline-json' as const,
      }
      const transaction = buildTransaction({ sequence: 1, values: [`v${version}`] })
      const store = await createSQLiteAnalysisStore(options)
      await store.commit(transaction)
      await store.dispose()
      const legacy = new DatabaseSync(file)
      legacy.exec(`
DROP INDEX analysis_facts_by_completeness;
ALTER TABLE analysis_shards DROP COLUMN payload_layout;
PRAGMA user_version = ${version};
`)
      legacy.close()
      const migrated = await createSQLiteAnalysisStore(options)
      try {
        expect(await snapshotOfFacts(migrated, transaction.next.universe)).toEqual([`v${version}`])
      } finally {
        await migrated.dispose()
      }
      assertCurrentSQLiteSchema(file)
    }

    const file = join(roots[2]!, 'analysis.sqlite')
    const options = { file, namespace: 'migration-v6' }
    const transaction = buildTransaction({ sequence: 1, values: ['v6'] })
    const store = await createSQLiteAnalysisStore(options)
    await store.commit(transaction)
    await store.dispose()
    const legacy = new DatabaseSync(file)
    legacy
      .prepare(
        `UPDATE analysis_shard_payloads
         SET encoding = 'brotli-json/1', payloads_blob = ?`,
      )
      .run(brotliCompressSync(Buffer.from(JSON.stringify(['v6']))))
    legacy.exec(`
DROP INDEX analysis_facts_by_completeness;
ALTER TABLE analysis_shards DROP COLUMN payload_layout;
PRAGMA user_version = 6;
`)
    legacy.close()
    const migrated = await createSQLiteAnalysisStore(options)
    try {
      expect(await snapshotOfFacts(migrated, transaction.next.universe)).toEqual(['v6'])
    } finally {
      await migrated.dispose()
    }
    assertCurrentSQLiteSchema(file)
  })

  it('quarantines corrupt derived snapshots and permits a clean rebuild', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-quarantine-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const options = { file, namespace: 'quarantine' }
    const transaction = buildTransaction({ sequence: 1, values: ['before-corruption'] })
    const store = await createSQLiteAnalysisStore(options)
    await store.commit(transaction)
    await store.dispose()

    const corrupt = new DatabaseSync(file)
    corrupt.prepare('UPDATE analysis_facts SET payload_json = ?').run('{invalid-json')
    corrupt.close()
    await expect(createSQLiteAnalysisStore(options)).rejects.toThrow('quarantined 1')

    const evidence = new DatabaseSync(file, { readOnly: true })
    expect(
      (
        evidence.prepare('SELECT COUNT(*) AS count FROM analysis_quarantine').get() as {
          count: number
        }
      ).count,
    ).toBe(1)
    expect(
      (
        evidence.prepare('SELECT COUNT(*) AS count FROM analysis_generations').get() as {
          count: number
        }
      ).count,
    ).toBe(0)
    evidence.close()

    const rebuilt = await createSQLiteAnalysisStore(options)
    try {
      expect(await rebuilt.current(transaction.next.universe)).toBeUndefined()
      await rebuilt.commit(transaction)
      expect(await snapshotOfFacts(rebuilt, transaction.next.universe)).toEqual([
        'before-corruption',
      ])
    } finally {
      await rebuilt.dispose()
    }
  })

  it('quarantines invalid compact payload ordinals even when their JSON remains valid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-semantic-corruption-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const options = {
      file,
      namespace: 'semantic-corruption',
      payloadMaterialization: 'shard-brotli' as const,
    }
    const transaction = buildTransaction({ sequence: 1, values: ['before-corruption'] })
    const store = await createSQLiteAnalysisStore(options)
    await store.commit(transaction)
    await store.dispose()

    const corrupt = new DatabaseSync(file)
    corrupt
      .prepare('UPDATE analysis_facts SET payload_json = ?')
      .run(JSON.stringify('changed-without-a-new-digest'))
    corrupt.close()

    await expect(createSQLiteAnalysisStore(options)).rejects.toThrow('quarantined 1')
    const evidence = new DatabaseSync(file, { readOnly: true })
    expect(
      (evidence.prepare('SELECT reason FROM analysis_quarantine').get() as { reason: string })
        .reason,
    ).toContain('payload ordinal is invalid')
    evidence.close()
  })

  it('quarantines missing or corrupt shard payloads and duplicate payload ordinals', async () => {
    const blobRoot = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-payload-blob-'))
    const missingRoot = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-payload-missing-'))
    const ordinalRoot = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-payload-ordinal-'))
    temporary.push(blobRoot, missingRoot, ordinalRoot)

    const blobOptions = {
      file: join(blobRoot, 'analysis.sqlite'),
      namespace: 'blob-corruption',
      payloadMaterialization: 'shard-brotli' as const,
    }
    const blobTransaction = buildTransaction({ sequence: 1, values: ['one'] })
    const blobStore = await createSQLiteAnalysisStore(blobOptions)
    await blobStore.commit(blobTransaction)
    await blobStore.dispose()
    const corruptBlob = new DatabaseSync(blobOptions.file)
    corruptBlob
      .prepare('UPDATE analysis_shard_payloads SET payloads_blob = ?')
      .run(Buffer.from([0]))
    corruptBlob.close()
    await expect(createSQLiteAnalysisStore(blobOptions)).rejects.toThrow('quarantined 1')

    const missingOptions = {
      file: join(missingRoot, 'analysis.sqlite'),
      namespace: 'missing-payload',
      payloadMaterialization: 'shard-brotli' as const,
    }
    const missingTransaction = buildTransaction({ sequence: 1, values: ['one'] })
    const missingStore = await createSQLiteAnalysisStore(missingOptions)
    await missingStore.commit(missingTransaction)
    await missingStore.dispose()
    const missingBlob = new DatabaseSync(missingOptions.file)
    missingBlob.prepare('DELETE FROM analysis_shard_payloads').run()
    missingBlob.close()
    await expect(createSQLiteAnalysisStore(missingOptions)).rejects.toThrow('quarantined 1')
    const missingEvidence = new DatabaseSync(missingOptions.file, { readOnly: true })
    expect(
      (
        missingEvidence.prepare('SELECT reason FROM analysis_quarantine').get() as {
          reason: string
        }
      ).reason,
    ).toContain('payload storage is missing')
    missingEvidence.close()

    const ordinalOptions = {
      file: join(ordinalRoot, 'analysis.sqlite'),
      namespace: 'ordinal-corruption',
      payloadMaterialization: 'shard-brotli' as const,
    }
    const ordinalTransaction = buildTransaction({ sequence: 1, values: ['one', 'two'] })
    const ordinalStore = await createSQLiteAnalysisStore(ordinalOptions)
    await ordinalStore.commit(ordinalTransaction)
    await ordinalStore.dispose()
    const corruptOrdinals = new DatabaseSync(ordinalOptions.file)
    corruptOrdinals.prepare('UPDATE analysis_facts SET payload_json = ?').run('0')
    corruptOrdinals.close()
    await expect(createSQLiteAnalysisStore(ordinalOptions)).rejects.toThrow('quarantined 1')
    const ordinalEvidence = new DatabaseSync(ordinalOptions.file, { readOnly: true })
    expect(
      (
        ordinalEvidence.prepare('SELECT reason FROM analysis_quarantine').get() as {
          reason: string
        }
      ).reason,
    ).toContain('payload ordinals are invalid')
    ordinalEvidence.close()
  })

  it('bounds decompressed shard payloads before acquiring the SQLite writer lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-payload-limit-'))
    temporary.push(root)
    const store = await createSQLiteAnalysisStore({
      file: join(root, 'analysis.sqlite'),
      namespace: 'payload-limit',
      maximumDecompressedShardPayloadBytes: 1_024,
      maximumCachedShardPayloadBytes: 1_024,
    })
    const transaction = buildTransaction({ sequence: 1, values: ['x'.repeat(2_048)] })
    try {
      await expect(store.commit(transaction)).rejects.toThrow('decompressed limit')
      expect(await store.current(transaction.next.universe)).toBeUndefined()
    } finally {
      await store.dispose()
    }
  })

  it('queries pages spanning more decoded shards than the bounded cache retains', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-sqlite-bounded-cache-'))
    temporary.push(root)
    const transaction = buildTwoShardTransaction()
    const store = await createSQLiteAnalysisStore({
      file: join(root, 'analysis.sqlite'),
      namespace: 'bounded-cache',
      payloadMaterialization: 'shard-brotli',
      maximumDecompressedShardPayloadBytes: 1_024,
      maximumCachedShardPayloadBytes: 1_024,
    })
    try {
      await store.commit(transaction)
      const query = await store.open(transaction.next.universe)
      try {
        const page = await query.facts({}, { limit: 10 })
        expect(page.facts.map((fact) => fact.payload).sort()).toEqual([
          `left-${'x'.repeat(500)}`,
          `right-${'x'.repeat(500)}`,
        ])
      } finally {
        await query.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  it('isolates durable namespaces while retaining identical portable fact identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-isolation-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const left = await createSQLiteAnalysisStore({ file, namespace: 'repository-a:worktree-one' })
    const right = await createSQLiteAnalysisStore({ file, namespace: 'repository-a:worktree-two' })
    const leftTransaction = buildTransaction({ sequence: 1, values: ['left'] })
    const rightTransaction = buildTransaction({ sequence: 1, values: ['right'] })
    try {
      await left.commit(leftTransaction)
      await right.commit(rightTransaction)
      expect(await snapshotOfFacts(left, leftTransaction.next.universe)).toEqual(['left'])
      expect(await snapshotOfFacts(right, rightTransaction.next.universe)).toEqual(['right'])
      expect(leftTransaction.upserts[0]?.facts[0]?.id).not.toBe(
        rightTransaction.upserts[0]?.facts[0]?.id,
      )
      const same = buildTransaction({ sequence: 1, values: ['portable'] })
      const third = await createSQLiteAnalysisStore({
        file,
        namespace: 'repository-b:worktree-one',
      })
      const fourth = await createSQLiteAnalysisStore({
        file,
        namespace: 'repository-c:worktree-one',
      })
      try {
        await third.commit(same)
        await fourth.commit(same)
        expect((await third.open(same.next.universe)).generation.id).toBe(same.next.id)
        expect((await fourth.open(same.next.universe)).generation.id).toBe(same.next.id)
      } finally {
        await fourth.dispose()
        await third.dispose()
      }
    } finally {
      await right.dispose()
      await left.dispose()
    }
  })

  it('serializes a store writer behind a separate process holding the SQLite write lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-process-writer-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const store = await createSQLiteAnalysisStore({
      file,
      namespace: 'process-writer',
      busyTimeoutMs: 2_000,
    })
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(process.argv[1], { timeout: 2000 })
database.exec('BEGIN IMMEDIATE')
process.stdout.write('READY\\n')
setTimeout(() => {
  database.exec('COMMIT')
  database.close()
}, 300)
`,
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const exited = once(child, 'exit')
    try {
      const [ready] = (await once(child.stdout!, 'data')) as [Buffer]
      expect(ready.toString()).toContain('READY')
      const transaction = buildTransaction({ sequence: 1, values: ['serialized'] })
      await store.commit(transaction)
      expect(await snapshotOfFacts(store, transaction.next.universe)).toEqual(['serialized'])
      const [code] = (await exited) as [number]
      expect(code).toBe(0)
    } finally {
      child.kill()
      await store.dispose()
    }
  })

  it('recovers with no partial generation after a writer process exits mid-transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-sqlite-process-crash-'))
    temporary.push(root)
    const file = join(root, 'analysis.sqlite')
    const initialized = await createSQLiteAnalysisStore({ file, namespace: 'process-crash' })
    await initialized.dispose()
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(process.argv[1])
database.exec('BEGIN IMMEDIATE')
database.prepare(
  'INSERT INTO analysis_generations (store_namespace, universe, sequence, generation_id, producer_id, producer_name, producer_version, protocol_version, source_manifest, capabilities_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run('process-crash', 'project-universe:partial', 1, 'analysis-generation:partial', 'producer:partial', 'partial', '0.0.0', 1, 'source-manifest:partial', '[]')
process.exit(0)
`,
        file,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    const [code] = (await once(child, 'exit')) as [number]
    expect(code).toBe(0)

    const recovered = await createSQLiteAnalysisStore({ file, namespace: 'process-crash' })
    try {
      expect(
        await recovered.current('project-universe:partial' as ProjectUniverseId),
      ).toBeUndefined()
      const database = new DatabaseSync(file, { readOnly: true })
      expect(
        (
          database.prepare('SELECT COUNT(*) AS count FROM analysis_generations').get() as {
            count: number
          }
        ).count,
      ).toBe(0)
      database.close()
    } finally {
      await recovered.dispose()
    }
  })

  it('rolls back rejected transactions identically in memory and SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-store-rollback-'))
    temporary.push(root)
    const stores: AnalysisStore[] = [
      createMemoryAnalysisStore(),
      await createSQLiteAnalysisStore({
        file: join(root, 'analysis.sqlite'),
        namespace: 'rollback',
      }),
    ]
    for (const store of stores) {
      try {
        const first = buildTransaction({ sequence: 1, values: ['committed'] })
        await store.commit(first)
        const invalid = buildTransaction({
          sequence: 2,
          base: first.next.id,
          values: ['must-not-commit'],
        })
        await expect(store.commit({ ...invalid, manifest: [] })).rejects.toThrow('MANIFEST')
        expect(await snapshotOfFacts(store, first.next.universe)).toEqual(['committed'])
        expect(await store.current(first.next.universe)).toEqual(first.next)
      } finally {
        await store.dispose()
      }
    }
  })

  it('falls back only for advisory persistence and exposes the causal failure', async () => {
    const cause = new Error('fixture durable store unavailable')
    const advisory = await selectAnalysisStore({
      persistence: 'advisory',
      async openDurable() {
        throw cause
      },
    })
    try {
      expect(advisory).toMatchObject({
        backend: 'memory',
        persistence: 'advisory',
        fallback: {
          code: 'DURABLE_STORE_UNAVAILABLE',
          message: cause.message,
          cause,
        },
      })
    } finally {
      await advisory.store.dispose()
    }
    await expect(
      selectAnalysisStore({
        persistence: 'required',
        async openDurable() {
          throw cause
        },
      }),
    ).rejects.toMatchObject({ code: 'DURABLE_STORE_UNAVAILABLE', cause })
    await expect(selectAnalysisStore({ persistence: 'required' })).rejects.toMatchObject({
      code: 'DURABLE_STORE_UNAVAILABLE',
    })
  })

  it('plans only the requested compatible pass closure and rejects cycles', () => {
    const base = pass('base', ['base'], [], [], [{ namespace: 'base', version: 1 }])
    const body = pass(
      'body',
      ['body'],
      ['base'],
      [{ namespace: 'base', minimumVersion: 1, maximumVersion: 1 }],
      [{ namespace: 'body', version: 2 }],
    )
    const policy = pass(
      'policy',
      ['policy'],
      ['body'],
      [{ namespace: 'body', minimumVersion: 2, maximumVersion: 2 }],
      [{ namespace: 'policy', version: 1 }],
    )
    expect(planPasses([policy, base, body], ['policy']).ordered.map((entry) => entry.id)).toEqual([
      base.id,
      body.id,
      policy.id,
    ])
    const cycleA = pass('cycle-a', ['cycle-a'], ['cycle-b'], [], [])
    const cycleB = pass('cycle-b', ['cycle-b'], ['cycle-a'], [], [])
    expect(() => planPasses([cycleA, cycleB], ['cycle-a'])).toThrow('cycle')
  })

  it('runs staged portable passes and commits optional failure as unavailable', async () => {
    const store = createMemoryAnalysisStore()
    try {
      const base = buildTransaction({ sequence: 1, values: ['input'] })
      await store.commit(base)
      const query = await store.open(base.next.universe)
      try {
        const derivedManifest = pass(
          'derived',
          ['fixture.derived'],
          ['fixture.values'],
          [{ namespace: 'fixture.values', minimumVersion: 1, maximumVersion: 1 }],
          [{ namespace: 'fixture.derived', version: 1 }],
        ) as PortablePass['manifest']
        const optionalManifest = {
          ...pass(
            'optional',
            ['fixture.optional'],
            ['fixture.derived'],
            [{ namespace: 'fixture.derived', minimumVersion: 1, maximumVersion: 1 }],
            [{ namespace: 'fixture.optional-facts', version: 1 }],
          ),
          mandatory: false,
        } as PortablePass['manifest']
        const plan = planPasses([optionalManifest, derivedManifest], ['fixture.optional'], {
          availableCapabilities: ['fixture.values'],
          availableSchemas: [{ namespace: 'fixture.values', version: 1 }],
        })
        const derived: PortablePass = {
          manifest: derivedManifest,
          async run(context) {
            const inputs = await context.query.facts({ namespaces: ['fixture.values'] })
            return {
              completion: { kind: 'complete' },
              shards: [passShard(derivedManifest, context.generation.id, inputs.facts)],
              diagnostics: [],
            }
          },
        }
        const optional: PortablePass = {
          manifest: optionalManifest,
          async run(context) {
            expect(
              (await context.query.facts({ namespaces: ['fixture.derived'] })).facts,
            ).toHaveLength(1)
            throw new Error('qualified optional failure')
          },
        }
        const producer: ProducerIdentity = {
          id: deriveAnalysisId('producer', 'qualification-portable', { version: 1 }),
          name: 'qualification-portable',
          version: '1.0.0',
          protocolVersion: 1,
        }
        const result = await runPortablePasses({
          plan,
          passes: [optional, derived],
          query,
          producer,
        })
        expect(result.executed).toEqual([derivedManifest.id, optionalManifest.id])
        expect(result.unavailable).toEqual([optionalManifest.id])
        expect(result.transaction).toBeDefined()
        await store.commit(result.transaction!)
      } finally {
        await query.dispose()
      }

      const current = await store.open(base.next.universe)
      try {
        expect((await current.facts({ namespaces: ['fixture.derived'] })).facts).toHaveLength(1)
        expect(
          (await current.capabilities()).find(
            (capability) => capability.capability === 'fixture.optional',
          )?.completeness.kind,
        ).toBe('unavailable')
        expect(
          (await current.capabilities()).find(
            (capability) => capability.capability === 'fixture.optional-facts',
          )?.completeness.kind,
        ).toBe('unavailable')
      } finally {
        await current.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  it('hydrates only declared portable-pass inputs and rejects undeclared reads', async () => {
    const store = createMemoryAnalysisStore()
    try {
      const base = buildTransaction({ sequence: 1, values: ['input'] })
      await store.commit(base)
      const query = await store.open(base.next.universe)
      try {
        const exports: (readonly string[] | undefined)[] = []
        const headerExports: (readonly string[] | undefined)[] = []
        const observed: AnalysisQuery = {
          generation: query.generation,
          manifest: () => query.manifest(),
          capabilities: () => query.capabilities(),
          headers: (filter, page) => query.headers(filter, page),
          headersById: (ids) => query.headersById(ids),
          exportHeaders(filter = {}) {
            headerExports.push(filter.namespaces)
            return query.exportHeaders(filter)
          },
          facts: (filter, page) => query.facts(filter, page),
          factsById: (ids) => query.factsById(ids),
          export(filter = {}) {
            exports.push(filter.namespaces)
            return query.export(filter)
          },
          async dispose() {},
        }
        const manifest = pass(
          'selective-input',
          ['fixture.selective'],
          ['fixture.values'],
          [{ namespace: 'fixture.values', minimumVersion: 1, maximumVersion: 1 }],
          [{ namespace: 'fixture.selective', version: 1 }],
        ) as PortablePass['manifest']
        const implementation: PortablePass = {
          manifest,
          async run(context) {
            await expect(
              context.query.facts({ namespaces: ['fixture.undeclared'] }),
            ).rejects.toThrow('undeclared input namespace fixture.undeclared')
            const headers = await context.query.headers()
            expect(headers.headers).toHaveLength(1)
            expect(headers.total).toBeUndefined()
            expect(
              (await context.query.headers({}, { limit: 100, includeTotal: true })).total,
            ).toBe(1)
            const inputs = await context.query.facts()
            expect(inputs.total).toBeUndefined()
            expect(
              (await context.query.facts({}, { limit: 100, includeTotal: true })).total,
            ).toBe(1)
            return {
              completion: { kind: 'complete' },
              shards: [passShard(manifest, context.generation.id, inputs.facts)],
              diagnostics: [],
            }
          },
        }
        const producer: ProducerIdentity = {
          id: deriveAnalysisId('producer', 'qualification-selective-pass', { version: 1 }),
          name: 'qualification-selective-pass',
          version: '1.0.0',
          protocolVersion: 1,
        }
        const plan = planPasses([manifest], ['fixture.selective'], {
          availableCapabilities: ['fixture.values'],
          availableSchemas: [{ namespace: 'fixture.values', version: 1 }],
        })
        const result = await runPortablePasses({
          plan,
          passes: [implementation],
          query: observed,
          producer,
        })
        expect(result.executed).toEqual([manifest.id])
        expect(exports).toEqual([['fixture.values'], ['fixture.values']])
        expect(headerExports).toEqual([['fixture.values'], ['fixture.values']])
      } finally {
        await query.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  /** @evidence TYPESCRIPT-ATOMIC-PUBLICATION */
  it('publishes native and portable analysis atomically while retaining private native lineage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-pipeline-'))
    temporary.push(root)
    const native = buildTransaction({ sequence: 1, values: ['input'] })
    const unrelatedDraft = {
      key: deriveAnalysisId('fact-shard-key', 'fixture.unrelated', { fixture: true }),
      namespace: 'fixture.unrelated',
      schemaVersion: 1,
      completion: { kind: 'complete' } as const,
      facts: [
        {
          id: deriveAnalysisId('fact', 'fixture.unrelated', { fixture: true }),
          generation: native.next.id,
          namespace: 'fixture.unrelated',
          schemaVersion: 1,
          kind: 'unrelated',
          subject: 'unrelated',
          completeness: { kind: 'complete' } as const,
          provenance: {
            pass: deriveAnalysisId('pass', 'fixture.unrelated', { version: 1 }),
            passVersion: '1.0.0',
            evidence: [],
            inputs: [],
          },
          payload: 'unrelated',
        },
      ],
    }
    const unrelatedShard = {
      ...unrelatedDraft,
      digest: factShardDigest(unrelatedDraft),
    }
    const unrelatedManifest = [...native.manifest, shardReference(unrelatedShard)].sort((left, right) =>
      left.key.localeCompare(right.key),
    )
    const unrelatedGeneration = {
      universe: native.next.universe,
      producer: native.next.producer,
      sourceManifest: deriveAnalysisId('source-manifest', 'qualification', { revision: 2 }),
      capabilities: [...native.next.capabilities, 'fixture.unrelated'].sort(),
    }
    const unrelatedGenerationId = generationIdentity(unrelatedGeneration, unrelatedManifest)
    const unrelatedTransaction: FactTransaction = {
      protocolVersion: 1,
      base: native.next.id,
      next: {
        ...unrelatedGeneration,
        id: unrelatedGenerationId,
        sequence: 2,
      },
      manifest: unrelatedManifest,
      upserts: [
        {
          ...unrelatedShard,
          facts: unrelatedShard.facts.map((fact) => ({
            ...fact,
            generation: unrelatedGenerationId,
          })),
        },
      ],
      deletes: [],
    }
    const changedValuesBase = buildTransaction({
      universe: native.next.universe,
      sequence: 3,
      base: unrelatedGenerationId,
      values: ['changed-input'],
      sourceRevision: 3,
    })
    const changedValues: FactTransaction = {
      ...changedValuesBase,
      deletes: [unrelatedShard.key],
    }
    const bases: Array<AnalysisGenerationId | undefined> = []
    let requests = 0
    let disposed = false
    const sessions: NativeAnalysisSessionFactory = {
      async open() {
        return {
          async request(request) {
            if (request.kind !== 'refresh') throw new Error('Unexpected native request.')
            bases.push(request.base)
            requests++
            return requests === 1
              ? {
                  id: request.id,
                  protocolVersion: 1 as const,
                  kind: 'transaction' as const,
                  transaction: native,
                }
              : requests === 2
                ? {
                    id: request.id,
                    protocolVersion: 1 as const,
                    kind: 'transaction' as const,
                    transaction: unrelatedTransaction,
                  }
                : requests === 3
                  ? {
                      id: request.id,
                      protocolVersion: 1 as const,
                      kind: 'transaction' as const,
                      transaction: changedValues,
                    }
                  : {
                  id: request.id,
                  protocolVersion: 1 as const,
                  kind: 'unchanged' as const,
                  generation: changedValues.next.id,
                }
          },
          async dispose() {
            disposed = true
          },
        }
      },
    }
    const manifest = pass(
      'pipeline-derived',
      ['fixture.derived'],
      ['fixture.values'],
      [{ namespace: 'fixture.values', minimumVersion: 1, maximumVersion: 1 }],
      [{ namespace: 'fixture.derived', version: 1 }],
    ) as PortablePass['manifest']
    const derived: PortablePass = {
      manifest,
      async run(context) {
        derivedRuns += 1
        const inputs = await context.query.facts({ namespaces: ['fixture.values'] })
        return {
          completion: { kind: 'complete' },
          shards: [passShard(manifest, context.generation.id, inputs.facts)],
          diagnostics: [],
        }
      },
    }
    let derivedRuns = 0
    const producer: ProducerIdentity = {
      id: deriveAnalysisId('producer', 'qualification-pipeline', { version: 1 }),
      name: 'qualification-pipeline',
      version: '1.0.0',
      protocolVersion: 1,
    }
    const store = createMemoryAnalysisStore()
    const pipeline = await createTypeScriptAnalysisPipeline({
      project: {
        root,
        config: 'tsconfig.json',
        capabilities: ['fixture.values'],
      },
      sessions,
      store,
      passes: [derived],
      requestedCapabilities: ['fixture.derived'],
      producer,
    })
    try {
      const first = await pipeline.refresh()
      expect(first.transaction?.next.sequence).toBe(1)
      expect(first.generation.producer).toEqual(producer)
      expect((await store.current(native.next.universe))?.sequence).toBe(1)
      const query = await store.open(native.next.universe)
      try {
        expect((await query.manifest()).map((entry) => entry.namespace).sort()).toEqual([
          'fixture.derived',
          'fixture.values',
        ])
        expect((await query.facts({}, { limit: 10 })).facts).toHaveLength(2)
      } finally {
        await query.dispose()
      }

      const second = await pipeline.refresh()
      expect(second.transaction).toBeDefined()
      expect(second.invalidatedPasses).not.toContain(manifest.id)
      const third = await pipeline.refresh()
      expect(third.transaction).toBeDefined()
      expect(third.invalidatedPasses).toContain(manifest.id)
      const fourth = await pipeline.refresh()
      expect(fourth.transaction).toBeUndefined()
      expect(fourth.generation.id).toBe(third.generation.id)
      expect(derivedRuns).toBe(2)
      expect(bases).toEqual([
        undefined,
        native.next.id,
        unrelatedGenerationId,
        changedValues.next.id,
      ])
    } finally {
      await pipeline.dispose()
      await store.dispose()
    }
    expect(disposed).toBe(true)
  })

  it('runs policies read-only and makes unavailable evidence indeterminate', async () => {
    const store = createMemoryAnalysisStore()
    const base = buildTransaction({ sequence: 1, values: ['input'] })
    await store.commit(base)
    const query = await store.open(base.next.universe)
    let unavailableInvoked = false
    const policy = (
      name: string,
      capability: string,
      evaluate: AnalysisPolicy['evaluate'],
    ): AnalysisPolicy => ({
      manifest: {
        id: deriveAnalysisId('policy', 'qualification', { name }),
        version: '1.0.0',
        requiresCapabilities: [capability],
        inputs: [],
        rules: [`${name.toUpperCase()}-RULE`],
        limits: {},
      },
      evaluate,
    })
    const available = policy('available', 'fixture.values', async () => [
      {
        rule: 'AVAILABLE-RULE',
        status: 'fail',
        diagnostics: [
          {
            code: 'FIXTURE_REJECTED',
            severity: 'error',
            message: 'Qualified policy failure.',
            rule: 'AVAILABLE-RULE',
            evidence: [],
            inputs: [],
          },
        ],
        matched: 0,
        total: 1,
      },
    ])
    const unavailable = policy('unavailable', 'fixture.missing', async () => {
      unavailableInvoked = true
      return []
    })
    try {
      const evaluation = await runAnalysisPolicies({
        query,
        policies: [available, unavailable],
      })
      const byPolicy = new Map(evaluation.policies.map((result) => [result.policy, result]))
      expect(byPolicy.get(available.manifest.id)?.status).toBe('fail')
      expect(byPolicy.get(unavailable.manifest.id)?.status).toBe('indeterminate')
      expect(byPolicy.get(unavailable.manifest.id)?.rules[0]?.diagnostics[0]?.code).toBe(
        'POLICY_EVIDENCE_UNAVAILABLE',
      )
      expect(unavailableInvoked).toBe(false)
      expect(Object.isFrozen(byPolicy.get(available.manifest.id)?.rules[0])).toBe(true)
      expect(await store.current(base.next.universe)).toEqual(base.next)
    } finally {
      await query.dispose()
      await store.dispose()
    }
  })

  it('permits sound rule-scoped evaluation when unrelated body evidence is partial', async () => {
    const store = createMemoryAnalysisStore()
    const base = buildTransaction({ sequence: 1, values: ['selected-body'] })
    const partialCompletion = {
      kind: 'partial' as const,
      reasons: [
        {
          code: 'CFG_EXPRESSION_BRANCH_PARTIAL',
          message: 'An unrelated expression branch is not fully modeled.',
          effective: { construct: 'ConditionalExpression' },
        },
      ],
    }
    const partialDraft = {
      key: deriveAnalysisId('fact-shard-key', 'fixture.values', { partial: 'unrelated' }),
      namespace: 'fixture.values',
      schemaVersion: 1,
      completion: partialCompletion,
      facts: [],
      capabilities: ['fixture.values'],
    }
    const partialShard = { ...partialDraft, digest: factShardDigest(partialDraft) }
    const manifest = [...base.manifest, shardReference(partialShard)].sort((left, right) =>
      left.key.localeCompare(right.key),
    )
    const generation = {
      universe: base.next.universe,
      producer: base.next.producer,
      sourceManifest: base.next.sourceManifest,
      capabilities: base.next.capabilities,
    }
    const id = generationIdentity(generation, manifest)
    await store.commit({
      protocolVersion: 1,
      next: { ...generation, id, sequence: 1 },
      manifest,
      upserts: [
        ...base.upserts.map((shard) => ({
          ...shard,
          facts: shard.facts.map((fact) => ({ ...fact, generation: id })),
        })),
        partialShard,
      ],
      deletes: [],
    })
    const query = await store.open(base.next.universe)
    try {
      const manifest = {
        id: deriveAnalysisId('policy', 'qualification-scoped', { version: 1 }),
        version: '1.0.0',
        requiresCapabilities: [],
        scopedCapabilities: ['fixture.values'],
        inputs: [{ namespace: 'fixture.values', minimumVersion: 1, maximumVersion: 1 }],
        rules: ['SELECTED-BODY-SOUND'],
        limits: {},
      } as const
      const sound: AnalysisPolicy = {
        manifest,
        async evaluate(context) {
          expect(context.capability('fixture.values')?.kind).toBe('partial')
          const selected = await context.query.facts({
            namespaces: ['fixture.values'],
            subjects: [base.upserts[0]!.facts[0]!.subject],
          })
          expect(selected.facts).toHaveLength(1)
          return [
            {
              rule: 'SELECTED-BODY-SOUND',
              status: 'pass',
              diagnostics: [],
              matched: 1,
              total: 1,
              evidenceCompleteness: { kind: 'complete' },
            },
          ]
        },
      }
      const unsound: AnalysisPolicy = {
        manifest: { ...manifest, id: deriveAnalysisId('policy', 'qualification-unsound', { version: 1 }) },
        async evaluate() {
          return [
            {
              rule: 'SELECTED-BODY-SOUND',
              status: 'pass',
              diagnostics: [],
              matched: 0,
              total: 0,
              evidenceCompleteness: partialCompletion,
            },
          ]
        },
      }
      const evaluation = await runAnalysisPolicies({ query, policies: [sound, unsound] })
      const byPolicy = new Map(evaluation.policies.map((policy) => [policy.policy, policy]))
      expect(byPolicy.get(sound.manifest.id)?.status).toBe('pass')
      expect(byPolicy.get(unsound.manifest.id)?.status).toBe('error')
    } finally {
      await query.dispose()
      await store.dispose()
    }
  })

  it('validates bounded body topology and keeps the four value states closed', () => {
    const body = bodyFixture()
    expect(validateFunctionBodyIR(body)).toEqual([])
    expect(
      validateFunctionBodyIR({
        ...body,
        edges: [{ from: 'entry', to: 'missing', kind: 'return' }],
      }),
    ).toContain('BODY_EDGE_BLOCK_UNKNOWN')
    const values: readonly ValueResult<string>[] = [
      { kind: 'known', value: 'x', evidence: [] },
      {
        kind: 'unknown',
        reasons: [{ code: 'DYNAMIC', message: 'runtime', retryable: false }],
        evidence: [],
      },
      {
        kind: 'ambiguous',
        values: ['x', 'y'],
        reasons: [{ code: 'BRANCH', message: 'finite branch', effective: { branches: 2 } }],
        evidence: [],
      },
      { kind: 'unsupported', construct: 'eval', evidence: [] },
    ]
    expect(values.map((value) => value.kind)).toEqual([
      'known',
      'unknown',
      'ambiguous',
      'unsupported',
    ])
  })

  it('decodes compact bodies exactly and rejects corrupt dictionaries and ordinals', () => {
    const packed = packedBodyFixture()
    const decoded = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(packed) as {
      readonly body: FunctionBodyIR
      readonly values: Readonly<Record<string, ValueResult<unknown>>>
    }
    expect(validateFunctionBodyIR(decoded.body)).toEqual([])
    expect(decoded.body.function).toBe(`symbol:${'03'.repeat(32)}`)
    expect(decoded.body.occurrences[0]).toMatchObject({
      id: `occurrence:${'04'.repeat(32)}`,
      owner: decoded.body.function,
      span: {
        source: `source:${'01'.repeat(32)}`,
        revision: `source-revision:${'02'.repeat(32)}`,
        start: 0,
        end: 1,
      },
    })

    const duplicated = structuredClone(packed)
    duplicated.t.push(duplicated.t[0]!)
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(duplicated)).toThrow('duplicated')

    const outside = structuredClone(packed)
    outside.p.push(0)
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(outside)).toThrow('outside')

    const malformed = structuredClone(packed)
    malformed.c[0] = 'not-an-identity'
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(malformed)).toThrow('identity is invalid')

    const repeatedValue = structuredClone(packed)
    repeatedValue.v.push(
      [0, { kind: 'known', value: 1, evidence: [] }],
      [0, { kind: 'known', value: 1, evidence: [] }],
    )
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(repeatedValue)).toThrow(
      'repeats a value occurrence',
    )

    const invalidCompleteness = structuredClone(packed)
    invalidCompleteness.q = { kind: 'mystery' }
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(invalidCompleteness)).toThrow(
      'completeness.kind is invalid',
    )

    const invalidValue = structuredClone(packed)
    invalidValue.v.push([0, { kind: 'mystery', evidence: [] }])
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(invalidValue)).toThrow(
      'value.kind is invalid',
    )

    const invalidOccurrenceKind = structuredClone(packed)
    invalidOccurrenceKind.t.push('not-an-occurrence-kind')
    invalidOccurrenceKind.o[0]![1] = invalidOccurrenceKind.t.length - 1
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(invalidOccurrenceKind)).toThrow(
      'BODY_OCCURRENCE_KIND_INVALID',
    )

    const invalidSpan = structuredClone(packed)
    invalidSpan.o[0]![2] = 2
    invalidSpan.o[0]![3] = 1
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(invalidSpan)).toThrow(
      'BODY_OCCURRENCE_SPAN_INVALID',
    )
  })

  it('evaluates helper parameters and return summaries in the calling context', async () => {
    const { transaction, calls } = bodyEvaluationTransaction()
    const store = createMemoryAnalysisStore()
    try {
      await store.commit(transaction)
      const query = await store.open(transaction.next.universe)
      try {
        const evaluator = await createBoundedValueEvaluator({ query })
        await expect(evaluator.evaluate<string>(calls.first)).resolves.toMatchObject({
          kind: 'known',
          value: 'first',
          limits: {
            maximumDepth: 12,
            maximumSteps: 2_000,
            maximumAlternatives: 32,
          },
        })
        await expect(evaluator.evaluate<string>(calls.second)).resolves.toMatchObject({
          kind: 'known',
          value: 'second',
        })
      } finally {
        await query.dispose()
      }
    } finally {
      await store.dispose()
    }
  })

  it('admits typed TypeScript facts and rejects malformed payloads at the reader boundary', async () => {
    const { transaction } = bodyEvaluationTransaction()
    const store = createMemoryAnalysisStore()
    try {
      await store.commit(transaction)
      const query = await store.open(transaction.next.universe)
      try {
        const reader = createTypeScriptFactReader(query)
        const page = await reader.facts('body', {}, { limit: 10 })
        expect(page.facts).toHaveLength(2)
        expect(page.facts[0]?.payload.body.function).toMatch(/^symbol:/u)
        const all = []
        for await (const fact of reader.exportAll()) all.push(fact)
        expect(all).toHaveLength(2)
        expect(all.every((fact) => fact.namespace === 'typescript.body')).toBe(true)
      } finally {
        await query.dispose()
      }

      const malformed = {
        ...transaction.upserts[0]!.facts[0]!,
        payload: { body: 'not-an-ir' },
      }
      const malformedQuery = {
        generation: transaction.next,
        dispose: async () => undefined,
        manifest: async () => [],
        capabilities: async () => [],
        headers: async () => ({ headers: [] }),
        headersById: async () => [],
        async *exportHeaders() {},
        facts: async () => ({ facts: [malformed] }),
        factsById: async () => [malformed],
        async *export() {
          yield malformed
        },
      } as AnalysisQuery
      await expect(
        createTypeScriptFactReader(malformedQuery).facts('body', {}, { limit: 1 }),
      ).rejects.toMatchObject({ code: 'TYPESCRIPT_FACT_CONTRACT_INVALID', kind: 'body' })
      await expect(async () => {
        for await (const _fact of createTypeScriptFactReader(malformedQuery).exportAll()) {
          // Admission happens before a malformed fact becomes visible to the consumer.
        }
      }).rejects.toMatchObject({ code: 'TYPESCRIPT_FACT_CONTRACT_INVALID', kind: 'body' })
    } finally {
      await store.dispose()
    }
  })

  it('inventories tests, fixtures, generated code, specifications, and unknowns independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'typespec-v2-repository-'))
    temporary.push(root)
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, '__tests__'), { recursive: true })
    await mkdir(join(root, 'fixtures'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await mkdir(join(root, 'module/.spec'), { recursive: true })
    await Promise.all([
      writeFile(join(root, 'src/main.ts'), 'export const value = 1\n'),
      writeFile(join(root, '__tests__/main.test.ts'), 'void 0\n'),
      writeFile(join(root, 'fixtures/input.ts'), 'void 0\n'),
      writeFile(join(root, 'dist/main.js'), 'export const value = 1\n'),
      writeFile(join(root, 'module/.spec/api.d.ts'), 'export interface API {}\n'),
      writeFile(join(root, 'root.ts'), 'export const root = true\n'),
      writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2])),
    ])
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'qualification', { root: 'logical' }),
      root,
      scanner: createNodeRepositoryScanner(),
    })
    expect(
      inventory.files.map((file) => [
        file.path,
        file.classification.purpose,
        file.classification.provenance,
      ]),
    ).toEqual([
      ['__tests__/main.test.ts', 'test', 'authored'],
      ['blob.bin', 'unknown', 'authored'],
      ['dist/main.js', 'implementation', 'generated'],
      ['fixtures/input.ts', 'fixture', 'authored'],
      ['module/.spec/api.d.ts', 'specification', 'authored'],
      ['root.ts', 'implementation', 'authored'],
      ['src/main.ts', 'implementation', 'authored'],
    ])
    expect(inventory.files.every((file) => file.classification.evidence.length >= 4)).toBe(true)
    const implementationOnly = await inventoryRepository({
      repository: inventory.repository,
      root,
      scope: { purposes: ['implementation'], provenance: ['authored'] },
    })
    expect(implementationOnly.files.map((file) => file.path)).toEqual(['root.ts', 'src/main.ts'])
    const sourceGlob = await inventoryRepository({
      repository: inventory.repository,
      root,
      scope: {
        include: ['**/*.{ts,js}'],
        exclude: ['**/{__tests__,fixtures,dist}/**'],
      },
    })
    expect(sourceGlob.files.map((file) => file.path)).toEqual(['root.ts', 'src/main.ts'])
  })
})

async function snapshot(store: AnalysisStore, universe: ProjectUniverseId): Promise<unknown> {
  const query = await store.open(universe)
  try {
    return {
      generation: query.generation,
      capabilities: await query.capabilities(),
      facts: (await query.facts({}, { limit: 10_000 })).facts,
    }
  } finally {
    await query.dispose()
  }
}

async function snapshotOfFacts(
  store: AnalysisStore,
  universe: ProjectUniverseId,
): Promise<readonly unknown[]> {
  const query = await store.open(universe)
  try {
    return (await query.facts({}, { limit: 10_000 })).facts.map((fact) => fact.payload)
  } finally {
    await query.dispose()
  }
}

function buildTransaction(options: {
  readonly universe?: ProjectUniverseId
  readonly sequence: number
  readonly base?: AnalysisGenerationId
  readonly values: readonly unknown[]
  readonly sourceRevision?: string | number
}): FactTransaction {
  const universe =
    options.universe ??
    deriveAnalysisId('project-universe', 'qualification', {
      config: 'tsconfig.json',
    })
  const producer: ProducerIdentity = {
    id: deriveAnalysisId('producer', 'qualification', { name: 'fixture', version: '1.0.0' }),
    name: 'fixture',
    version: '1.0.0',
    protocolVersion: 1,
  }
  const sourceManifest = deriveAnalysisId('source-manifest', 'qualification', {
    revision: options.sourceRevision ?? options.sequence,
  }) as SourceManifestId
  const pending = deriveAnalysisId('generation', 'pending', { sequence: options.sequence })
  const namespace = 'fixture.values'
  const key = deriveAnalysisId('fact-shard-key', namespace, { owner: 'fixture' })
  const facts: Fact[] = options.values
    .map((value) => {
      const subject = typeof value === 'string' ? value : stableJson(value)
      return {
      id: deriveAnalysisId('fact', namespace, { value }),
      generation: pending,
      namespace,
      schemaVersion: 1,
      kind: 'value',
      subject,
      completeness: { kind: 'complete' } as const,
      provenance: {
        pass: deriveAnalysisId('pass', namespace, { name: 'fixture' }),
        passVersion: '1.0.0',
        evidence: [],
        inputs: [],
      },
      payload: value,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const draft = {
    key,
    namespace,
    schemaVersion: 1,
    completion: { kind: 'complete' } as const,
    facts,
  }
  const digest = factShardDigest(draft)
  const draftReference: FactShardReference = {
    key,
    digest,
    namespace,
    schemaVersion: 1,
    facts: facts.length,
  }
  const generation = generationIdentity(
    {
      universe,
      producer,
      sourceManifest,
      capabilities: ['fixture.values'],
    },
    [draftReference],
  )
  const shard: FactShard = {
    ...draft,
    digest,
    facts: facts.map((fact) => ({ ...fact, generation })),
  }
  const manifest = [shardReference(shard)]
  return {
    protocolVersion: 1,
    ...(options.base ? { base: options.base } : {}),
    next: {
      id: generation,
      sequence: options.sequence,
      universe,
      producer,
      sourceManifest,
      capabilities: ['fixture.values'],
    },
    manifest,
    upserts: [shard],
    deletes: [],
  }
}

function buildRichTransaction(): FactTransaction {
  const base = buildTransaction({ sequence: 1, values: ['alpha', 'beta'] })
  const source = deriveAnalysisId('source', 'normalized-query', {
    path: 'src/fixture.ts',
  }) as SourceId
  const revision = deriveAnalysisId('source-revision', source, {
    digest: 'fixture',
  }) as SourceRevisionId
  const symbol = deriveAnalysisId('symbol', 'normalized-query', {
    name: 'alpha',
  }) as SymbolId
  const original = base.upserts[0]!
  const facts = original.facts.map((fact, index) =>
    index === 0
      ? {
          ...fact,
          kind: 'symbol',
          subject: symbol,
          provenance: {
            ...fact.provenance,
            evidence: [{ source, revision, start: 0, end: 5 }],
          },
        }
      : {
          ...fact,
          completeness: {
            kind: 'partial' as const,
            reasons: [
              {
                code: 'FIXTURE_LIMIT',
                message: 'Qualified bounded fixture.',
                effective: { maximum: 1 },
              },
            ],
          },
          provenance: {
            ...fact.provenance,
            inputs: [original.facts[0]!.id],
          },
        },
  )
  const draft = { ...original, facts, digest: original.digest }
  const digest = factShardDigest(draft)
  const shard = { ...draft, digest }
  const manifest = [shardReference(shard)]
  const id = generationIdentity(
    {
      universe: base.next.universe,
      producer: base.next.producer,
      sourceManifest: base.next.sourceManifest,
      capabilities: base.next.capabilities,
    },
    manifest,
  )
  return {
    ...base,
    next: { ...base.next, id },
    manifest,
    upserts: [
      {
        ...shard,
        facts: shard.facts.map((fact) => ({ ...fact, generation: id })),
      },
    ],
  }
}

function buildTwoShardTransaction(): FactTransaction {
  const base = buildTransaction({ sequence: 1, values: [`left-${'x'.repeat(500)}`] })
  const first = base.upserts[0]!
  const namespace = 'fixture.other'
  const pending = deriveAnalysisId('generation', 'pending-two-shards', {})
  const value = `right-${'x'.repeat(500)}`
  const fact: Fact = {
    ...first.facts[0]!,
    id: deriveAnalysisId('fact', namespace, { value }),
    generation: pending,
    namespace,
    subject: value,
    payload: value,
  }
  const secondDraft = {
    key: deriveAnalysisId('fact-shard-key', namespace, { owner: 'fixture' }),
    namespace,
    schemaVersion: 1,
    completion: { kind: 'complete' } as const,
    facts: [fact],
  }
  const second: FactShard = { ...secondDraft, digest: factShardDigest(secondDraft) }
  const drafts = [first, second].sort((left, right) => left.key.localeCompare(right.key))
  const references = drafts.map(shardReference)
  const capabilities = ['fixture.other', 'fixture.values']
  const generation = generationIdentity(
    {
      universe: base.next.universe,
      producer: base.next.producer,
      sourceManifest: base.next.sourceManifest,
      capabilities,
    },
    references,
  )
  const upserts = drafts.map((shard) => ({
    ...shard,
    facts: shard.facts.map((entry) => ({ ...entry, generation })),
  }))
  return {
    protocolVersion: 1,
    next: {
      ...base.next,
      id: generation,
      capabilities,
    },
    manifest: references,
    upserts,
    deletes: [],
  }
}

function tableCount(database: DatabaseSync, table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      readonly count: number
    }
  ).count
}

function assertCurrentSQLiteSchema(file: string): void {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    expect(
      (database.prepare('PRAGMA user_version').get() as { readonly user_version: number })
        .user_version,
    ).toBe(7)
    expect(
      database
        .prepare('PRAGMA table_info(analysis_shards)')
        .all()
        .map((column) => (column as { readonly name: string }).name),
    ).toContain('payload_layout')
    expect(
      database
        .prepare("PRAGMA index_list('analysis_facts')")
        .all()
        .map((index) => (index as { readonly name: string }).name),
    ).toContain('analysis_facts_by_completeness')
  } finally {
    database.close()
  }
}

function pass(
  name: string,
  providesCapabilities: readonly string[],
  requiresCapabilities: readonly string[],
  inputs: PassManifest['inputs'],
  outputs: PassManifest['outputs'],
): PassManifest {
  return {
    id: deriveAnalysisId('pass', 'qualification', { name }),
    version: '1.0.0',
    runtime: 'portable-typescript',
    scope: 'project',
    providesCapabilities,
    requiresCapabilities,
    inputs,
    outputs,
    invalidatesOn: [],
    limits: {},
    mandatory: true,
  }
}

function bodyEvaluationTransaction(): {
  readonly transaction: FactTransaction
  readonly calls: {
    readonly first: FunctionBodyIR['calls'][number]['occurrence']
    readonly second: FunctionBodyIR['calls'][number]['occurrence']
  }
} {
  const universe = deriveAnalysisId('project-universe', 'body-evaluation', {})
  const source = deriveAnalysisId('source', 'body-evaluation', { path: 'src/helpers.ts' })
  const revision = deriveAnalysisId('source-revision', `${source}`, { digest: 'body-evaluation' })
  const span = (start: number, end = start + 1) => ({ source, revision, start, end })
  const helper = deriveAnalysisId('symbol', 'body-evaluation', { name: 'helper' })
  const caller = deriveAnalysisId('symbol', 'body-evaluation', { name: 'caller' })
  const parameter = deriveAnalysisId('symbol', 'body-evaluation', { name: 'parameter' })
  const occurrence = (name: string) => deriveAnalysisId('occurrence', 'body-evaluation', { name })
  const parameterDefinition = occurrence('parameter-definition')
  const parameterUse = occurrence('parameter-use')
  const returned = occurrence('return')
  const firstArgument = occurrence('first-argument')
  const firstCall = occurrence('first-call')
  const secondArgument = occurrence('second-argument')
  const secondCall = occurrence('second-call')
  const helperBody: FunctionBodyIR = {
    function: helper,
    parameters: [parameter],
    occurrences: [
      {
        id: parameterDefinition,
        kind: 'definition',
        span: span(0),
        owner: helper,
        syntax: 'Parameter',
        symbol: parameter,
      },
      {
        id: parameterUse,
        kind: 'use',
        span: span(10),
        owner: helper,
        syntax: 'Identifier',
        symbol: parameter,
      },
      { id: returned, kind: 'return', span: span(8, 12), owner: helper, syntax: 'ReturnStatement' },
    ],
    relations: [{ parent: returned, child: parameterUse, role: 'expression' }],
    blocks: [
      { id: 'entry', occurrences: [] },
      { id: 'return', occurrences: [parameterDefinition, returned, parameterUse] },
      { id: 'exit', occurrences: [] },
    ],
    edges: [
      { from: 'entry', to: 'return', kind: 'fallthrough' },
      { from: 'return', to: 'exit', kind: 'return', evidence: returned },
    ],
    definitions: [
      {
        definition: parameterDefinition,
        use: parameterUse,
        symbol: parameter,
        reaching: 'definite',
      },
    ],
    calls: [],
    summary: {
      function: helper,
      returns: [returned],
      throws: [],
      captures: [],
      calls: [],
      escapes: [],
      recursion: false,
    },
  }
  const call = (
    callOccurrence: typeof firstCall,
    argument: typeof firstArgument,
  ): FunctionBodyIR['calls'][number] => ({
    occurrence: callOccurrence,
    target: helper,
    signature: '(parameter: string) => string',
    typeArguments: [],
    arguments: [argument],
    bindings: [{ argument, parameter, index: 0, rest: false }],
    callbacks: [],
    dynamic: false,
  })
  const callerBody: FunctionBodyIR = {
    function: caller,
    parameters: [],
    occurrences: [
      {
        id: firstArgument,
        kind: 'expression',
        span: span(20),
        owner: caller,
        syntax: 'StringLiteral',
      },
      { id: firstCall, kind: 'call', span: span(18, 22), owner: caller, syntax: 'CallExpression' },
      {
        id: secondArgument,
        kind: 'expression',
        span: span(30),
        owner: caller,
        syntax: 'StringLiteral',
      },
      { id: secondCall, kind: 'call', span: span(28, 32), owner: caller, syntax: 'CallExpression' },
    ],
    relations: [
      { parent: firstCall, child: firstArgument, role: 'argument:0' },
      { parent: secondCall, child: secondArgument, role: 'argument:0' },
    ],
    blocks: [
      { id: 'entry', occurrences: [] },
      { id: 'calls', occurrences: [firstCall, firstArgument, secondCall, secondArgument] },
      { id: 'exit', occurrences: [] },
    ],
    edges: [
      { from: 'entry', to: 'calls', kind: 'fallthrough' },
      { from: 'calls', to: 'exit', kind: 'fallthrough' },
    ],
    definitions: [],
    calls: [call(firstCall, firstArgument), call(secondCall, secondArgument)],
    summary: {
      function: caller,
      returns: [],
      throws: [],
      captures: [],
      calls: [firstCall, secondCall],
      escapes: [],
      recursion: false,
    },
  }
  const producer: ProducerIdentity = {
    id: deriveAnalysisId('producer', 'body-evaluation', { version: 1 }),
    name: 'body-evaluation',
    version: '1.0.0',
    protocolVersion: 1,
  }
  const passId = deriveAnalysisId('pass', 'body-evaluation', { version: 1 })
  const pending = deriveAnalysisId('generation', 'body-evaluation-pending', {})
  const makeFact = (
    body: FunctionBodyIR,
    values: Readonly<Record<string, ValueResult<unknown>>>,
  ) => ({
    id: deriveAnalysisId('fact', 'typescript.body', { function: body.function }),
    generation: pending,
    namespace: 'typescript.body',
    schemaVersion: 1,
    kind: 'function-body',
    subject: body.function,
    completeness: { kind: 'complete' } as const,
    provenance: { pass: passId, passVersion: '1.0.0', evidence: [], inputs: [] },
    payload: { body, values, completeness: { kind: 'complete' } },
  })
  const facts = [
    makeFact(helperBody, {}),
    makeFact(callerBody, {
      [firstArgument]: { kind: 'known', value: 'first', evidence: [] },
      [firstCall]: { kind: 'unsupported', construct: 'CallExpression', evidence: [] },
      [secondArgument]: { kind: 'known', value: 'second', evidence: [] },
      [secondCall]: { kind: 'unsupported', construct: 'CallExpression', evidence: [] },
    }),
  ].sort((left, right) => left.id.localeCompare(right.id))
  const draft = {
    key: deriveAnalysisId('fact-shard-key', 'typescript.body', { fixture: 'body-evaluation' }),
    namespace: 'typescript.body',
    schemaVersion: 1,
    completion: { kind: 'complete' } as const,
    facts,
  }
  const shard = { ...draft, digest: factShardDigest(draft) }
  const manifest = [shardReference(shard)]
  const sourceManifest = deriveAnalysisId('source-manifest', 'body-evaluation', { revision })
  const generation = generationIdentity(
    { universe, producer, sourceManifest, capabilities: ['typescript.body'] },
    manifest,
  )
  return {
    calls: { first: firstCall, second: secondCall },
    transaction: {
      protocolVersion: 1,
      next: {
        id: generation,
        sequence: 1,
        universe,
        producer,
        sourceManifest,
        capabilities: ['typescript.body'],
      },
      manifest,
      upserts: [{ ...shard, facts: facts.map((fact) => ({ ...fact, generation })) }],
      deletes: [],
    },
  }
}

function passShard(
  manifest: PortablePass['manifest'],
  generation: AnalysisGenerationId,
  inputs: readonly Fact[],
): FactShard {
  const schema = manifest.outputs[0]!
  const facts: Fact[] = inputs
    .map((input) => ({
      id: deriveAnalysisId('fact', schema.namespace, { input: input.id }),
      generation,
      namespace: schema.namespace,
      schemaVersion: schema.version,
      kind: 'derived',
      subject: input.subject,
      completeness: { kind: 'complete' } as const,
      provenance: {
        pass: manifest.id,
        passVersion: manifest.version,
        evidence: input.provenance.evidence,
        inputs: [input.id],
      },
      payload: { input: input.id },
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const draft = {
    key: deriveAnalysisId('fact-shard-key', schema.namespace, { pass: manifest.id }),
    namespace: schema.namespace,
    schemaVersion: schema.version,
    completion: { kind: 'complete' } as const,
    facts,
  }
  return { ...draft, digest: factShardDigest(draft) }
}

function bodyFixture(): FunctionBodyIR {
  const source = deriveAnalysisId('source', 'qualification', { path: 'src/body.ts' })
  const revision = deriveAnalysisId('source-revision', `${source}`, { digest: 'body' })
  const functionId = deriveAnalysisId('symbol', 'qualification', { name: 'body' })
  const occurrence = deriveAnalysisId('occurrence', 'qualification', { source, start: 0 })
  return {
    function: functionId,
    parameters: [],
    occurrences: [
      {
        id: occurrence,
        kind: 'return',
        span: { source, revision, start: 0, end: 8 },
        owner: functionId,
        syntax: 'return',
      },
    ],
    relations: [],
    blocks: [
      { id: 'entry', occurrences: [occurrence] },
      { id: 'exit', occurrences: [] },
    ],
    edges: [{ from: 'entry', to: 'exit', kind: 'return', evidence: occurrence }],
    definitions: [],
    calls: [],
    summary: {
      function: functionId,
      returns: [occurrence],
      throws: [],
      captures: [],
      calls: [],
      escapes: [],
      recursion: false,
    },
  }
}

function packedBodyFixture() {
  const compact = (byte: number) => Buffer.alloc(32, byte).toString('base64url')
  return {
    c: [compact(1), compact(2), compact(3)],
    s: [] as string[],
    t: ['statement', 'ExpressionStatement', 'entry'],
    p: [] as number[],
    o: [[compact(4), 0, 0, 1, 1, -1]],
    r: [] as unknown[],
    b: [[2, [0]]],
    e: [] as unknown[],
    d: [] as unknown[],
    a: [] as unknown[],
    u: [[], [], [], [], [], 0],
    v: [] as unknown[][],
    q: { kind: 'complete' },
  }
}

async function typescriptFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const handle = await opendir(directory)
    for await (const entry of handle) {
      if (entry.name === '.spec') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
    }
  }
  await visit(root)
  return files.sort()
}

function analysisOwner(root: string, file: string): string {
  const relative = file.slice(root.length + 1).replaceAll('\\', '/')
  const first = relative.split('/')[0]!
  return first.includes('.') ? 'facade' : first
}

function relativeImports(source: string): readonly string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()(['"])(\.[^'"]+)\1/gu)].map(
    (match) => match[2]!,
  )
}
