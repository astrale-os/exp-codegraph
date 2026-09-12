import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { beforeAll, expect, it } from 'vitest'

import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import type { AnalysisTelemetryEvent } from '../analysis/profiling/index.ts'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/index.ts'
import {
  createTypeScriptAnalysisService,
  createTypeScriptFactReader,
  type TypeScriptModuleFact,
} from '../analysis/typescript/index.ts'
import { resolveTtscNativeAnalysis } from '../analysis/typescript/ttsc/index.ts'

let command: string
beforeAll(async () => {
  command = (await resolveTtscNativeAnalysis({
    root: resolve(import.meta.dirname, '..'),
    config: 'tsconfig.json',
    cacheDirectory: join(tmpdir(), 'codegraph-test-ttsc'),
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
  })).command
}, 120_000)

it('refreshes inbound dependency coordinates after same-byte-length Unicode and line-ending edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-dependency-coordinates-'))
  const path = 'source/index.ts'
  const sourceText = (prefix: string) => `import { value } from ${prefix}'../target/index.js'\nexport function read(): number { return value }\n`
  // These private comments move the exported location without moving any
  // compiler byte range or changing the declaration emitted for read().
  const prefixes = ['/*é*/ ', '/*ab*/ ', '/*\r\n*/ ', '/*\n\n*/ ', '/*\r */ ', '/* \r*/ ']
  expect(new Set(prefixes.map((prefix) => Buffer.byteLength(prefix))).size).toBe(1)

  try {
    await Promise.all(['source', 'target'].map((directory) => mkdir(join(root, directory))))
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
      include: ['**/*.ts'],
    }))
    await writeFile(join(root, 'target/index.ts'), 'export const value: number = 1\n')
    await writeFile(join(root, path), sourceText(prefixes[0]!))
    const resident = await open(root)
    try {
      let previousLocation: unknown
      for (const [index, prefix] of prefixes.entries()) {
        const text = sourceText(prefix)
        if (index > 0) await writeFile(join(root, path), text)
        await resident.service.refresh({
          ...(index > 0 ? { changes: [{ path, kind: 'change' as const }] } : {}),
          signal: AbortSignal.timeout(20_000),
        })
        const current = await resident.read()
        const source = current.find((module) => module.target.id === 'source')!
        const target = current.find((module) => module.target.id === 'target')!
        const outbound = source.dependencies.filter((edge) => edge.targetModule === 'target' && edge.kind === 'runtime')
        const inbound = target.inboundDependencies.filter((edge) => edge.sourceModule === 'source' && edge.kind === 'runtime')
        expect(outbound, prefix).toHaveLength(1)
        expect(inbound, prefix).toEqual(outbound)
        expect(inbound[0]!.occurrences, prefix).toHaveLength(1)

        // Use TypeScript's public source model as an independent UTF-16 and
        // ECMAScript-line oracle, including CRLF as one line terminator.
        const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
        const reference = (parsed.statements[0] as ts.ImportDeclaration).moduleSpecifier
        const position = parsed.getLineAndCharacterOfPosition(reference.getStart(parsed))
        const location = { file: path, line: position.line + 1, column: position.character + 1 }
        expect(inbound[0]!.occurrences[0]!.location, prefix).toEqual(location)
        if (previousLocation) expect(location, prefix).not.toEqual(previousLocation)
        previousLocation = location

        const fresh = await open(root)
        try {
          await fresh.service.refresh({ signal: AbortSignal.timeout(20_000) })
          expect(current, prefix).toEqual(await fresh.read())
        } finally { await fresh.close() }
      }
    } finally { await resident.close() }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120_000)

it('replaces shared declaration evidence in every consuming module while keeping unchanged supports local', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-shared-declaration-coordinates-'))
  const path = 'source/index.ts'
  const sourceText = (hidden: string) => `const hidden = '${hidden}'; export interface A { value: string }\n`
  const versions = ['é', 'ab', 'cd'].map(sourceText)
  expect(new Set(versions.map((text) => Buffer.byteLength(text))).size).toBe(1)

  try {
    await Promise.all(['source', 'target'].map((directory) => mkdir(join(root, directory))))
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
      include: ['**/*.ts'],
    }))
    await writeFile(join(root, 'target/index.ts'), "import type { A } from '../source/index.js'; export interface B { value: A }\n")
    await writeFile(join(root, path), versions[0]!)
    const resident = await open(root)
    try {
      let previousSupport: string | undefined
      for (const [index, text] of versions.entries()) {
        if (index > 0) await writeFile(join(root, path), text)
        resident.events.length = 0
        const refresh = await resident.service.refresh({
          ...(index > 0 ? { changes: [{ path, kind: 'change' as const }] } : {}),
          signal: AbortSignal.timeout(20_000),
        })
        const modules = await resident.read()
        const supports = (await resident.declarations()).filter((fact) => fact.payload.declaration.name === 'A')
        // A is one normalized support even though both modules include it in
        // their public closure. Keeping the old support for B is inconsistent.
        expect(supports).toHaveLength(1)
        const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
        const declaration = parsed.statements.find(ts.isInterfaceDeclaration)!
        const position = parsed.getLineAndCharacterOfPosition(declaration.getStart(parsed))
        const location = { file: path, line: position.line + 1, column: position.character + 1 }
        expect(modules).toHaveLength(2)
        for (const module of modules) {
          expect(module.declarations.find((value) => value.name === 'A')!.location).toEqual(location)
        }
        if (index === 1) expect(supports[0]!.id).not.toBe(previousSupport)
        if (index === 2) {
          // Changing a private initializer without moving any public evidence
          // must preserve the shared support and avoid reprojecting its users.
          expect(supports[0]!.id).toBe(previousSupport)
          expect(refresh.changedModules).toEqual(['source'])
          expect(resident.events.find((event) => event.phase === 'projection.modules')?.metrics?.moduleOwners).toBe(1)
        }
        previousSupport = supports[0]!.id

        const fresh = await open(root)
        try {
          await fresh.service.refresh({ signal: AbortSignal.timeout(20_000) })
          expect(modules).toEqual(await fresh.read())
        } finally { await fresh.close() }
      }
    } finally { await resident.close() }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120_000)

async function open(root: string) {
  const store = createMemoryAnalysisStore()
  const events: AnalysisTelemetryEvent[] = []
  const service = await createTypeScriptAnalysisService({
    project: {
      root,
      config: 'tsconfig.json',
      capabilities: ['astrale.typescript.module'],
      modules: ['source', 'target'].map((id) => ({
        id, name: id, project: 'tsconfig.json', root: id,
        entrypoint: `${id}/index.ts`, facades: [], aliases: [], internals: [],
      })),
    },
    store,
    sessions: createProcessNativeAnalysisSessionFactory({ command, telemetry: (event) => events.push(event) }),
  })
  return {
    service, events,
    async read(): Promise<TypeScriptModuleFact[]> {
      const query = await store.open(service.universe!)
      try {
        const modules: TypeScriptModuleFact[] = []
        for await (const fact of createTypeScriptFactReader(query).export('module')) {
          expect(fact.completeness).toEqual({ kind: 'complete' })
          modules.push(fact.payload)
        }
        return modules.sort((left, right) => left.target.id.localeCompare(right.target.id))
      } finally { await query.dispose() }
    },
    async declarations() {
      const query = await store.open(service.universe!)
      try { return (await createTypeScriptFactReader(query).facts('declaration')).facts }
      finally { await query.dispose() }
    },
    async close() { try { await service.dispose() } finally { await store.dispose() } },
  }
}
