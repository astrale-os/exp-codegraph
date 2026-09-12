import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/index.ts'
import type { AnalysisQuery } from '../analysis/query/index.ts'
import { createTypeScriptAnalysisService, createTypeScriptFactReader, TYPESCRIPT_ANALYSIS_CAPABILITIES } from '../analysis/typescript/index.ts'
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'
import { resolveTtscNativeAnalysis } from '../analysis/typescript/ttsc/index.ts'

let command: string
beforeAll(async () => {
  command = (await resolveTtscNativeAnalysis({
    root: resolve(import.meta.dirname, '..'), config: 'tsconfig.json',
    cacheDirectory: join(tmpdir(), 'codegraph-test-ttsc'),
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
  })).command
}, 120_000)

function source(prefix: string, newline = '\n') {
  return `${prefix}export function café() {${newline}` +
    `  let value = 'first';${newline}  /* élève 🪐 */ value = 'second';${newline}` +
    `  return value${newline}}${newline}` +
    `/* é🪐 */ export const answer = café()${newline}` +
    `/* é🪐 */ export const bad: number = 'no'${newline}`
}

async function inspect(query: AnalysisQuery, text: string) {
  const reader = createTypeScriptFactReader(query)
  const sources = (await reader.facts('source')).facts
  expect(sources).toHaveLength(1)
  expect(sources[0]!.payload.textDigest).toBe(createHash('sha256').update(text).digest('hex'))
  const parsed = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true)
  const syntaxSpans = new Set<string>()
  const visit = (node: ts.Node) => {
    syntaxSpans.add(`${node.getStart(parsed)}:${node.end}`)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  const callStart = text.lastIndexOf('café()')
  const callSpan = { start: callStart, end: callStart + 'café()'.length }
  const occurrences = (await reader.facts('occurrence')).facts
  expect(occurrences.filter(fact => fact.payload.kind === 'call').map(fact => ({
    start: fact.payload.span.start, end: fact.payload.span.end,
  }))).toEqual([callSpan])
  for (const fact of occurrences) {
    expect(syntaxSpans.has(`${fact.payload.span.start}:${fact.payload.span.end}`)).toBe(true)
    expect(fact.provenance.evidence).toEqual([fact.payload.span])
  }
  const symbols = (await reader.facts('symbol')).facts
  const declaration = parsed.statements.find(ts.isFunctionDeclaration)!
  expect(symbols.find(fact => fact.payload.name === 'café')!.payload.declarations).toEqual([
    expect.objectContaining({ start: declaration.getStart(parsed), end: declaration.end }),
  ])
  const bodies = (await reader.facts('body')).facts
  expect(bodies.some(fact => fact.payload.body.occurrences.some(occurrence =>
    occurrence.kind === 'call' && occurrence.span.start === callSpan.start && occurrence.span.end === callSpan.end,
  ))).toBe(true)
  for (const fact of bodies) {
    for (const occurrence of fact.payload.body.occurrences) {
      expect(syntaxSpans.has(`${occurrence.span.start}:${occurrence.span.end}`)).toBe(true)
    }
  }
  const functionBody = bodies.find(fact => fact.kind === 'function-body')!.payload.body
  const returnUse = functionBody.occurrences.find(occurrence => occurrence.kind === 'use' && occurrence.span.start === text.indexOf('return value') + 'return '.length)!.id
  const reaching = functionBody.definitions.find(definition => definition.use === returnUse)!
  expect(reaching.reaching).toBe('definite')
  expect(functionBody.occurrences.find(occurrence => occurrence.id === reaching.definition)!.span.start)
    .toBe(text.indexOf("value = 'second'"))

  const bad = text.indexOf('bad: number')
  const diagnostic = (await reader.facts('diagnostic')).facts.find(fact => fact.payload.code === 2322)!
  expect(diagnostic.payload.span).toMatchObject({ start: bad, end: bad + 3 })
  expect(diagnostic.provenance.evidence).toEqual([diagnostic.payload.span])
  const modules = []
  for await (const fact of reader.export('module')) modules.push(fact)
  expect(modules).toHaveLength(1)
  const module = modules[0]!
  expect(module.provenance.evidence).toEqual([expect.objectContaining({ start: 0, end: text.length })])
  const expectedLocation = (position: number) => {
    const { line, character } = parsed.getLineAndCharacterOfPosition(position)
    return { file: 'index.ts', line: line + 1, column: character + 1 }
  }
  expect(module.payload.declarations.find(value => value.name === 'café')!.location)
    .toEqual(expectedLocation(declaration.getStart(parsed)))
  expect(module.payload.issues.find(issue => issue.code === 'TYPESCRIPT_2322')!.location)
    .toEqual(expectedLocation(bad))
  return { occurrences, symbols, bodies, diagnostic, module }
}

describe('native TypeScript source coordinates', () => {
  for (const packed of [false, true]) {
    it(`preserves exact UTF-16 facts and old pins through Unicode edits (${packed ? 'packed' : 'logical'})`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'codegraph-source-coordinates-'))
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true },
        include: ['index.ts'],
      }))
      const versions = [
        source(''), source('/* déjà */ '), source('\ufeff/* 👩🏽‍💻 */\r\n', '\r\n'),
        source('/* é */\r'), source('/* ab */\u2028'), source('/* 🪐 */\u2029'),
      ]
      await writeFile(join(root, 'index.ts'), versions[0]!)
      const store = createMemoryAnalysisStore()
      const project = { root, config: 'tsconfig.json', capabilities: TYPESCRIPT_ANALYSIS_CAPABILITIES,
        modules: [{ id: 'fixture', name: 'Fixture', project: 'tsconfig.json', root: '.', entrypoint: 'index.ts', facades: [], aliases: [], internals: [] }],
      }
      const sessions = createProcessNativeAnalysisSessionFactory({ command, ...(packed ? { payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS } : {}) })
      const service = await createTypeScriptAnalysisService({ project, store, sessions })
      const pins: AnalysisQuery[] = []
      try {
        for (const [index, text] of versions.entries()) {
          await writeFile(join(root, 'index.ts'), text)
          await service.refresh(index === 0 ? {} : { changed: ['index.ts'] })
          const pin = await store.open(service.universe!)
          pins.push(pin)
          await inspect(pin, text)
          const freshStore = createMemoryAnalysisStore()
          const fresh = await createTypeScriptAnalysisService({ project, store: freshStore, sessions })
          try {
            await fresh.refresh()
            const query = await freshStore.open(fresh.universe!)
            try {
              const values = await inspect(query, text)
              // The compiler generation sequence is process-local; all portable
              // facts, evidence and identities must otherwise agree exactly.
              const portable = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => key === 'generation' ? undefined : entry))
              expect(portable(await inspect(pin, text))).toEqual(portable(values))
            } finally { await query.dispose() }
          } finally { await fresh.dispose(); await freshStore.dispose() }
          for (let previous = 0; previous < index; previous++) await inspect(pins[previous]!, versions[previous]!)
        }
      } finally {
        for (const pin of pins) await pin.dispose()
        await service.dispose(); await store.dispose(); await rm(root, { recursive: true, force: true })
      }
    }, 90_000)
  }
})
