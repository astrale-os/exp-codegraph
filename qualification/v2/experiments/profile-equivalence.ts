import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  createProcessNativeAnalysisSessionFactory,
  type AnalysisTelemetryEvent,
  type Fact,
} from '../../../analysis/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'
import {
  createTypeScriptAnalysisService,
  TYPESCRIPT_FACT_NAMESPACES,
  TYPESCRIPT_FACT_PAYLOAD_CODECS,
} from '../../../analysis/typescript/index.ts'

const binary = requiredArgument('--native-binary')
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-profile-equivalence-'))

try {
  await mkdir(join(temporary, 'src'), { recursive: true })
  await writeFile(
    join(temporary, 'tsconfig.json'),
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
  )
  await writeFile(
    join(temporary, 'src/index.ts'),
    `export const nestedCallback = () => () => 'nested'

export function choose(value: number): string {
  const prefix = 'value'
  return value > 0 ? \`${'${prefix}'}:${'${value}'}\` : 'none'
}
`,
  )

  const events: AnalysisTelemetryEvent[] = []
  const plain = await analyze(undefined, false)
  const profiled = await analyze((event) => events.push(event), true)
  assert.equal(profiled.semantic, plain.semantic)
  assert(events.some((event) => event.component === 'native' && event.phase === 'compiler.open'))
  assert(events.some((event) => event.component === 'native' && event.phase === 'projection.bodies'))
  assert(events.some((event) => event.component === 'transport' && event.phase === 'request.roundtrip'))
  assert(events.some((event) => event.component === 'analysis' && event.phase === 'transaction.materialize'))
  assert(events.some((event) => event.component === 'memory-store' && event.phase === 'transaction.commit'))
  process.stdout.write(`${JSON.stringify({
    format: 'astrale.codegraph.profile-equivalence',
    version: 1,
    semanticDigest: plain.digest,
    facts: plain.facts,
    telemetryEvents: events.length,
    phases: [...new Set(events.map((event) => `${event.component}:${event.phase}`))].sort(),
  }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function analyze(
  telemetry: ((event: AnalysisTelemetryEvent) => void) | undefined,
  compact: boolean,
): Promise<{ readonly semantic: string; readonly digest: string; readonly facts: number }> {
  const store = createMemoryAnalysisStore({
    maximumRetainedGenerations: 1,
    ...(telemetry ? { telemetry } : {}),
  })
  const sessions = createProcessNativeAnalysisSessionFactory({
    command: resolve(binary),
    ...(compact ? { payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS } : {}),
    ...(telemetry ? { telemetry } : {}),
  })
  const service = await createTypeScriptAnalysisService({
    project: {
      root: temporary,
      config: 'tsconfig.json',
      capabilities: [
        TYPESCRIPT_FACT_NAMESPACES.body,
        TYPESCRIPT_FACT_NAMESPACES.diagnostic,
        TYPESCRIPT_FACT_NAMESPACES.occurrence,
        TYPESCRIPT_FACT_NAMESPACES.project,
        TYPESCRIPT_FACT_NAMESPACES.source,
        TYPESCRIPT_FACT_NAMESPACES.symbol,
      ],
    },
    sessions,
    store,
    ...(telemetry ? { telemetry } : {}),
  })
  try {
    const refreshed = await service.refresh()
    const query = await store.open(refreshed.generation.universe, refreshed.generation.id)
    try {
      const facts: Fact[] = []
      for await (const fact of query.export()) facts.push(fact)
      const owners = new Map<string, string>()
      for (const fact of facts.filter((candidate) => candidate.namespace === 'typescript.body')) {
        const payload = fact.payload as import('../../../analysis/typescript/index.ts').TypeScriptBodyFacts
        for (const occurrence of payload.body.occurrences) {
          const owner = owners.get(occurrence.id)
          assert(
            owner === undefined || owner === occurrence.owner,
            `Occurrence ${occurrence.id} has multiple function owners.`,
          )
          owners.set(occurrence.id, occurrence.owner)
        }
        if (payload.body.occurrences.some((occurrence) => occurrence.syntax === 'ArrowFunction')) {
          assert.equal(payload.body.summary.returns.length, 1)
        }
      }
      const semantic = stableJson({
        generation: refreshed.generation,
        transaction: refreshed.transaction,
        manifest: await query.manifest(),
        capabilities: await query.capabilities(),
        facts,
      })
      return {
        semantic,
        digest: (await import('node:crypto')).createHash('sha256').update(semantic).digest('hex'),
        facts: facts.length,
      }
    } finally {
      await query.dispose()
    }
  } finally {
    await service.dispose()
    await store.dispose()
  }
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`Usage: profile-equivalence.ts ${name} <path>`)
  return value
}
