import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/index.ts'
import type { AnalysisTelemetryEvent, AnalysisTelemetrySink } from '../analysis/profiling/index.ts'
import {
  createTypeScriptAnalysisService,
  createTypeScriptFactReader,
  type TypeScriptBodyFacts,
} from '../analysis/typescript/index.ts'
import { validateFunctionBodyIR } from '../analysis/typescript/body/index.ts'
import { TYPESCRIPT_BODY_PAYLOAD_CODEC, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'
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

async function fixture(source: string, packed: boolean, telemetry?: AnalysisTelemetrySink, prepare?: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-module-body-'))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true },
    include: ['*.ts'],
  }))
  await writeFile(join(root, 'builder.ts'), `
export const helper = () => 'query-id'
export function defineQuery<T>() { return (options: (domain: T) => unknown) => options }
export function from(input: unknown) { return { select: (selection: unknown) => ({ input, selection }) } }
`)
  await writeFile(join(root, 'index.ts'), source)
  await prepare?.(root)
  const store = createMemoryAnalysisStore()
  const service = await createTypeScriptAnalysisService({
    project: { root, config: 'tsconfig.json', capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] },
    store,
    sessions: createProcessNativeAnalysisSessionFactory({ command, ...(packed ? { payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS } : {}), ...(telemetry ? { telemetry } : {}) }),
  })
  const read = async () => {
    const query = await store.open(service.universe!)
    try {
      const reader = createTypeScriptFactReader(query)
      const sources = new Map((await reader.facts('source')).facts.map((fact) => [fact.payload.source, fact.payload.logicalPath]))
      const bodies = []
      for await (const fact of reader.export('body')) {
        expect(validateFunctionBodyIR(fact.payload.body)).toEqual([])
        bodies.push({ ...fact.payload, kind: fact.kind, file: sources.get(fact.provenance.evidence[0]!.source) })
      }
      return bodies
    } finally { await query.dispose() }
  }
  return {
    root, read, service,
    async close() { await service.dispose(); await store.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

// The currying and factory callback shape comes from the real employee Domain's
// readEmployee/readWorkerDirectory declarations. Bodies stay small enough that
// this regression exercises the native producer on every normal test run.
const source = `import { defineQuery as query, from, helper as importedHelper } from './builder.js'
export const readEmployee = query<{ readonly employee: string }>()((domain) => ({
  id: importedHelper(),
  build: (employeeId: string) => from({ nodes: [employeeId] }).select({ kind: 'nodes' }),
  project: (value: unknown) => value,
}))
const localHelper = () => 'local'
export const local = localHelper()
`

describe('native executable scope facts', () => {
  it('encodes only changed identity entries while retaining the complete generation manifest', async () => {
    const events: AnalysisTelemetryEvent[] = []
    const text = `export function current() { return 1 }\n`
    const current = await fixture(text, true, (event) => events.push(event), async (root) => {
      await Promise.all(Array.from({ length: 64 }, (_, index) => writeFile(
        join(root, `unrelated${index}.ts`), `export function unrelated${index}() { return ${index} }\n`,
      )))
    })
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      events.length = 0
      await writeFile(join(current.root, 'index.ts'), text + '// private edit\n')
      await current.service.refresh({ changed: ['index.ts'], signal: AbortSignal.timeout(20_000) })
      const metrics = (phase: string) => events.find((event) => event.component === 'native' && event.phase === phase)!.metrics!
      expect(metrics('projection.source-inventory')).toMatchObject({ ownedSources: 66, hashedSources: 1, reusedSources: 65 })
      expect(metrics('transaction.source-manifest')).toMatchObject({ sources: 66, encodedSources: 1 })
      const identity = metrics('transaction.generation-identity')
      expect(identity.manifestShards).toBeGreaterThan(250)
      expect(identity.encodedReferences).toBe(metrics('transaction.materialize').upsertShards)
      expect(identity.encodedReferences).toBeLessThan(10)
      expect((await current.read()).filter((entry) => entry.body.scope === 'function')).toHaveLength(70)
    } finally { await current.close() }
  })

  it.each([false, true])('joins shorthand values to their lexical bindings while preserving authored keys (packed=%s)', async (packed) => {
    const text = `import { helper as importedHelper } from './builder.js'
export const path = 'module'
export function capture(path: string) { const local = 'local'; return { path, local, importedHelper } }
export const direct = importedHelper
`
    const current = await fixture(text, packed)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const bodies = await current.read()
      const body = bodies.find((entry) => entry.file === 'index.ts' && entry.body.parameters.length === 1)!.body
      const properties = body.occurrences.filter((entry) => entry.syntax === 'ShorthandPropertyAssignment')
      expect(properties.map((entry) => entry.propertyName)).toEqual(['path', 'local', 'importedHelper'])
      const valueOf = (name: string) => {
        const property = properties.find((entry) => entry.propertyName === name)!
        return body.occurrences.find((entry) => entry.syntax === 'Identifier' && entry.span.start === property.span.start)!
      }
      expect(valueOf('path')).toMatchObject({ kind: 'use', symbol: body.parameters[0] })
      const local = body.occurrences.find((entry) => entry.kind === 'definition' && text.slice(entry.span.start, entry.span.end) === 'local')!
      expect(valueOf('local')).toMatchObject({ kind: 'use', symbol: local.symbol })
      const direct = bodies.find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!.body.occurrences
        .find((entry) => entry.syntax === 'Identifier' && entry.span.start === text.lastIndexOf('importedHelper'))!
      expect(direct.symbol).toBeTruthy()
      expect(valueOf('importedHelper')).toMatchObject({ kind: 'use', symbol: direct.symbol })
    } finally { await current.close() }
  })

  it('keeps signature identities stable across generic instantiations, body edits and cold compilers', async () => {
    const text = `export function identity<T>(value: T): T { return value }
export function overloaded(value: string): string
export function overloaded(value: number): number
export function overloaded(value: string | number) { return value }
export function probe() { identity<string>('a'); identity<number>(1); overloaded('a'); overloaded(1) }
`
    const current = await fixture(text, true)
    let cold: Awaited<ReturnType<typeof fixture>> | undefined
    try {
      const signatures = async (project: typeof current) => {
        const bodies = await project.read()
        return bodies.filter((entry) => entry.file === 'index.ts').flatMap((entry) => entry.body.calls).map((call) => call.signature).sort()
      }
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const initial = await signatures(current)
      expect(initial).toHaveLength(4)
      expect(initial.every((signature) => /^signature:[a-f0-9]{64}$/.test(signature!))).toBe(true)
      expect(new Set(initial).size).toBe(3)
      await writeFile(join(current.root, 'index.ts'), text.replace('{ return value }', '{ const result = value; return result }'))
      await current.service.refresh({ changed: ['index.ts'], signal: AbortSignal.timeout(20_000) })
      expect(await signatures(current)).toEqual(initial)
      await current.service.refresh({ invalidate: true, signal: AbortSignal.timeout(20_000) })
      expect(await signatures(current)).toEqual(initial)
      cold = await fixture(text, true)
      await cold.service.refresh({ signal: AbortSignal.timeout(20_000) })
      expect(await signatures(cold)).toEqual(initial)
    } finally { await cold?.close(); await current.close() }
  })

  it('uses the last completed straight-line definition and remains conservative across branches', async () => {
    const text = `export function overwrite() { let request: unknown = { canonical: true }; request = { kind: 'invented-request' }; return request }
export function selfRead() { let request = 'old'; request = request; return request }
export function branch(flag: boolean) { let request = 'old'; if (flag) request = 'new'; return request }
export function loop(flag: boolean) { let request = 'old'; while (flag) { request = 'new'; break }; return request }
`
    const current = await fixture(text, true)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const bodies = (await current.read()).filter((entry) => entry.file === 'index.ts' && entry.body.scope === 'function')
      const returned = (name: string) => {
        const body = bodies.find((entry) => entry.body.occurrences.some((value) => text.slice(value.span.start, value.span.end).startsWith(`let request`) && value.span.start > text.indexOf(`function ${name}`) && value.span.start < text.indexOf('\n', text.indexOf(`function ${name}`))))!.body
        const returns = new Set(body.summary.returns)
        const use = body.relations.find((relation) => returns.has(relation.parent) && relation.role === 'expression')!.child
        return { body, definitions: body.definitions.filter((entry) => entry.use === use) }
      }
      const overwrite = returned('overwrite')
      expect(overwrite.definitions).toHaveLength(1)
      expect(overwrite.definitions[0]!.reaching).toBe('definite')
      const overwritten = overwrite.body.occurrences.find((entry) => entry.id === overwrite.definitions[0]!.definition)!
      expect(overwritten.span.start).toBe(text.indexOf('request = { kind:'))
      const self = returned('selfRead')
      const right = self.body.occurrences.find((entry) => entry.span.start === text.indexOf('= request;') + 2)!
      const oldDefinition = self.body.definitions.find((entry) => entry.use === right.id)!
      const old = self.body.occurrences.find((entry) => entry.id === oldDefinition.definition)!
      expect(old.span.start).toBe(text.indexOf("request = 'old'"))
      for (const name of ['branch', 'loop']) {
        const result = returned(name)
        expect(result.definitions).toHaveLength(2)
        expect(result.definitions.every((entry) => entry.reaching === 'possible')).toBe(true)
      }
    } finally { await current.close() }
  })

  it('bounds collision inventories by files while keeping same-spelled function owners distinct', async () => {
    const events: AnalysisTelemetryEvent[] = []
    const text = `export const callbacks = [function repeated() { return 'first' }, function repeated() { return 'second' }]\n` +
      Array.from({ length: 300 }, (_, index) => `export function fn${index}() { const value${index} = ${index}; return value${index} }`).join('\n')
    const current = await fixture(text, true, (event) => events.push(event))
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const discovery = events.find((event) => event.component === 'native' && event.phase === 'projection.symbol-discovery')!
      expect(discovery.metrics!.identityInventories).toBe(2)
      const functions = (await current.read()).filter((entry) => entry.file === 'index.ts' && entry.body.scope === 'function')
      expect(functions).toHaveLength(302)
      expect(new Set(functions.map((entry) => entry.body.function)).size).toBe(302)
    } finally { await current.close() }
  })

  it('reads persisted version-1 bodies as functions and requires explicit scope in version 2', () => {
    const constants = [1, 2, 3].map((byte) => Buffer.alloc(32, byte).toString('base64url'))
    const packed = { c: constants, s: [], t: [], p: [], o: [], r: [], b: [], e: [], d: [], a: [], u: [[], [], [], [], [], 0], v: [], q: { kind: 'complete' } }
    const legacy = TYPESCRIPT_FACT_PAYLOAD_CODECS.find((codec) => codec.id === 'typescript.body.packed/1')!
    expect((legacy.decode(packed) as TypeScriptBodyFacts).body.scope).toBeUndefined()
    const previous = TYPESCRIPT_FACT_PAYLOAD_CODECS.find((codec) => codec.id === 'typescript.body.packed/2')!
    const occurrence = { ...packed, c: [...constants, 'module', ''], t: ['expression', 'Identifier', 'entry'], o: [[constants[0], 0, 0, 1, 1, -1]], b: [[2, [0]]] }
    expect((previous.decode(occurrence) as TypeScriptBodyFacts).body.occurrences[0]!.symbolOrigin).toBeUndefined()
    const version3 = TYPESCRIPT_FACT_PAYLOAD_CODECS.find((codec) => codec.id === 'typescript.body.packed/3')!
    expect((version3.decode({ ...occurrence, o: [[...occurrence.o[0]!, null]] }) as TypeScriptBodyFacts).body.occurrences[0]!.operator).toBeUndefined()
    const version4 = TYPESCRIPT_FACT_PAYLOAD_CODECS.find((codec) => codec.id === 'typescript.body.packed/4')!
    expect((version4.decode({ ...occurrence, o: [[...occurrence.o[0]!, null, -1]] }) as TypeScriptBodyFacts).body.occurrences[0]!.symbolKind).toBeUndefined()
    expect((TYPESCRIPT_BODY_PAYLOAD_CODEC.decode({ ...packed, c: [...constants, 'module', ''] }) as TypeScriptBodyFacts).body.scope).toBe('module')
    expect(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode({ ...packed, c: [...constants, 'invalid', ''] })).toThrow('scope is invalid')
  })

  it.each([false, true])('joins module factories, option callbacks and imported helpers (packed=%s)', async (packed) => {
    const current = await fixture(source, packed)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const bodies = await current.read()
      const module = bodies.find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!
      expect(module.kind).toBe('module-body')
      expect(module.body.parameters).toEqual([])
      expect(module.body.summary.returns).toEqual([])
      expect(module.body.calls).toHaveLength(3)
      const bodyByOwner = new Map(bodies.map((entry) => [entry.body.function, entry.body]))
      const factoryCall = module.body.calls.find((call) => call.callbacks.length === 1)!
      const factory = bodyByOwner.get(factoryCall.callbacks[0]!)!
      expect(factory.scope).toBe('function')
      expect(factory.parameters).toHaveLength(1)
      const optionCallback = factory.occurrences.find((occurrence) => occurrence.syntax === 'ArrowFunction' && occurrence.symbol && bodyByOwner.get(occurrence.symbol)?.parameters.length === 1)!
      expect(optionCallback.symbol).toBeTruthy()
      expect(factory.relations.some((relation) => relation.child === optionCallback.id && relation.role === 'initializer')).toBe(true)
      // Calls made by the build callback never enter the factory or module's execution.
      expect(bodyByOwner.get(optionCallback.symbol!)!.calls).toHaveLength(2)
      expect(factory.calls).toHaveLength(1)
      expect(bodyByOwner.has(factory.calls[0]!.target!)).toBe(true)
      const localCall = module.body.calls.find((call) => call.arguments.length === 0 && call.target && bodyByOwner.get(call.target)?.summary.returns.length === 1)!
      expect(localCall).toBeDefined()
      expect(bodyByOwner.get(localCall.target!)!.scope).toBe('function')
      const returned = factory.summary.returns[0]!
      expect(factory.relations.some((relation) => relation.parent === returned && relation.role === 'expression')).toBe(true)
    } finally { await current.close() }
  })

  it('preserves module owner across updates and removes deleted callback bodies', async () => {
    const current = await fixture(source, true)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const initial = await current.read()
      const module = initial.find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!
      await writeFile(join(current.root, 'index.ts'), 'export const updated = 42\n')
      await current.service.refresh({ changed: ['index.ts'], signal: AbortSignal.timeout(20_000) })
      const updated = await current.read()
      const changed = updated.filter((entry) => entry.file === 'index.ts')
      expect(changed).toHaveLength(1)
      expect(changed[0]!.body.function).toBe(module.body.function)
      expect(changed[0]!.body.calls).toEqual([])
      const beforeCold = updated.map((entry) => entry.body)
      await current.service.refresh({ invalidate: true, signal: AbortSignal.timeout(20_000) })
      expect((await current.read()).map((entry) => entry.body)).toEqual(beforeCold)
    } finally { await current.close() }
  })

  it('reports short-circuit and excluded nested initialization as incomplete control flow', async () => {
    const current = await fixture(`export function and(value: boolean) { return value && effect() }
export function or(value: boolean) { return value || effect() }
export function nullish(value: boolean | undefined) { return value ?? effect() }
declare function effect(): boolean
export class Deferred { field = effect() }
`, true)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const bodies = (await current.read()).filter((entry) => entry.file === 'index.ts')
      const module = bodies.find((entry) => entry.body.scope === 'module')!
      expect(module.body.calls).toEqual([])
      expect(reasons(module)).toContain('CFG_NESTED_SCOPE_UNSUPPORTED')
      const functions = bodies.filter((entry) => entry.body.scope === 'function')
      expect(functions).toHaveLength(3)
      expect(functions.every((entry) => reasons(entry).includes('CFG_EXPRESSION_BRANCH_PARTIAL'))).toBe(true)
    } finally { await current.close() }
  })

  it.each([false, true])('proves canonical package declarations through reexports and const aliases (packed=%s)', async (packed) => {
    const text = `import { defineQuery, Lookalike } from '@fixture/canonical'
import { defineQuery as other } from '@fixture/other'
const alias = defineQuery
const secondAlias = alias
let mutable = defineQuery
defineQuery(); secondAlias(); other(); Lookalike.defineQuery(); mutable();
`
    const current = await fixture(text, packed, undefined, async (root) => {
      for (const name of ['canonical', 'other']) {
        const directory = join(root, 'node_modules/@fixture', name)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, types: 'index.d.ts' }))
        await writeFile(join(directory, 'index.d.ts'), "export { defineQuery, Lookalike } from './Builders.js'\n")
        await writeFile(join(directory, 'Builders.d.ts'), 'export declare function defineQuery(): unknown\nexport declare namespace Lookalike { function defineQuery(): unknown }\n')
      }
    })
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const module = (await current.read()).find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!.body
      const calls = new Map(module.calls.map((call) => {
        const occurrence = module.occurrences.find((entry) => entry.id === call.occurrence)!
        return [text.slice(occurrence.span.start, occurrence.span.end), call]
      }))
      const canonical = calls.get('defineQuery()')!
      expect(canonical.targetOrigin).toEqual({ package: '@fixture/canonical', file: 'Builders.d.ts', path: ['defineQuery'] })
      expect(calls.get('secondAlias()')!.target).toBe(canonical.target)
      expect(calls.get('secondAlias()')!.targetOrigin).toEqual(canonical.targetOrigin)
      expect(calls.get('other()')!.targetOrigin).toEqual({ package: '@fixture/other', file: 'Builders.d.ts', path: ['defineQuery'] })
      expect(calls.get('Lookalike.defineQuery()')!.targetOrigin).toEqual({ package: '@fixture/canonical', file: 'Builders.d.ts', path: ['Lookalike', 'defineQuery'] })
      expect(calls.get('mutable()')!.targetOrigin).toBeUndefined()
    } finally { await current.close() }
  })

  it.each([false, true])('separates canonical receiver identity from a third-party compatible type (packed=%s)', async (packed) => {
    const text = `import { Query } from '@fixture/canonical'
import { facade } from '@fixture/other'
Query.from(); facade.from();
`
    const current = await fixture(text, packed, undefined, async (root) => {
      for (const name of ['canonical', 'other']) {
        const directory = join(root, 'node_modules/@fixture', name)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, types: 'index.d.ts' }))
        await writeFile(join(directory, 'index.d.ts'), name === 'canonical'
          ? 'export declare const Query: { from(): unknown }\n'
          : "import { Query } from '@fixture/canonical'\nexport declare const facade: typeof Query\n")
      }
    })
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const module = (await current.read()).find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!.body
      expect(module.calls).toHaveLength(2)
      const origins = [...module.calls].sort((left, right) => module.occurrences.find((entry) => entry.id === left.occurrence)!.span.start - module.occurrences.find((entry) => entry.id === right.occurrence)!.span.start).map((call) => ({
        target: call.targetOrigin,
        receiver: module.occurrences.find((entry) => entry.id === call.receiver)!.symbolOrigin,
      }))
      expect(origins[0]!.target).toEqual(origins[1]!.target)
      expect(origins[0]!.receiver).toEqual({ package: '@fixture/canonical', file: 'index.d.ts', path: ['Query'] })
      expect(origins[1]!.receiver).toEqual({ package: '@fixture/other', file: 'index.d.ts', path: ['facade'] })
    } finally { await current.close() }
  })

  it.each([false, true])('marks only actual module namespace values across reexports (packed=%s)', async (packed) => {
    const text = `import * as API from '@fixture/reexport'
import type * as Types from '@fixture/reexport'
import { facade } from '@fixture/fabricated'
const local = {} as typeof API
const alias = API
API.defineQuery(); alias.defineQuery(); facade.defineQuery(); local.defineQuery(); Types.defineQuery();
`
    const current = await fixture(text, packed, undefined, async (root) => {
      for (const [name, declaration] of [
        ['canonical', 'export declare function defineQuery(): unknown\n'],
        ['reexport', "export * from '@fixture/canonical'\n"],
        ['fabricated', "export declare const facade: typeof import('@fixture/canonical')\n"],
      ]) {
        const directory = join(root, 'node_modules/@fixture', name!)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, types: 'index.d.ts' }))
        await writeFile(join(directory, 'index.d.ts'), declaration!)
      }
    })
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const module = (await current.read()).find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!.body
      const calls = new Map(module.calls.map((call) => {
        const occurrence = module.occurrences.find((entry) => entry.id === call.occurrence)!
        return [text.slice(occurrence.span.start, occurrence.span.end), call]
      }))
      const receiver = (expression: string) => module.occurrences.find((entry) => entry.id === calls.get(expression)!.receiver)!
      expect(receiver('API.defineQuery()').symbolKind).toBe('module-namespace')
      expect(receiver('facade.defineQuery()').symbolKind).toBeUndefined()
      expect(receiver('local.defineQuery()').symbolKind).toBeUndefined()
      expect(receiver('alias.defineQuery()').symbolKind).toBeUndefined()
      expect(receiver('Types.defineQuery()').symbolKind).toBeUndefined()
      expect(receiver('Types.defineQuery()').symbolOrigin).toBeUndefined()
      // The member's type-level call target alone cannot distinguish these cases.
      expect(calls.get('facade.defineQuery()')!.targetOrigin).toEqual(calls.get('API.defineQuery()')!.targetOrigin)
    } finally { await current.close() }
  })

  it.each([false, true])('distinguishes direct and compound assignments without source-text inference (packed=%s)', async (packed) => {
    const text = `export function assignments() {
  let value: unknown = 'old'
  value = { kind: 'replacement' }
  value += 'suffix'
  value *= 2
  return value
}`
    const current = await fixture(text, packed)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const body = (await current.read()).find((entry) => entry.file === 'index.ts' && entry.body.scope === 'function')!.body
      const operations = body.occurrences.filter((entry) => entry.syntax === 'BinaryExpression')
      expect(operations.map((entry) => entry.operator).sort()).toEqual(['AsteriskEqualsToken', 'EqualsToken', 'PlusEqualsToken'])
      expect(operations.every((entry) => entry.kind === 'assignment')).toBe(true)
    } finally { await current.close() }
  })

  it('retains spread operands as properties without taking ownership of callback execution', async () => {
    const current = await fixture(`const options = { build: () => 1 }
export const wrapped = { id: 'query', ...options }
`, true)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const body = (await current.read()).find((entry) => entry.file === 'index.ts' && entry.body.scope === 'module')!.body
      const spread = body.occurrences.find((entry) => entry.syntax === 'SpreadAssignment')!
      expect(body.relations.some((relation) => relation.child === spread.id && relation.role.startsWith('property:'))).toBe(true)
      expect(body.relations.some((relation) => relation.parent === spread.id && relation.role === 'expression')).toBe(true)
      expect(body.calls).toEqual([])
    } finally { await current.close() }
  })

  it('exposes the four function execution forms without inferring them from return types', async () => {
    const current = await fixture('export function sync() {}\nexport async function asynchronous() {}\nexport function* generator() {}\nexport async function* both() {}\n', true)
    try {
      await current.service.refresh({ signal: AbortSignal.timeout(20_000) })
      const bodies = (await current.read()).filter((entry) => entry.file === 'index.ts')
      expect(bodies.find((entry) => entry.body.scope === 'module')!.body.execution).toBeUndefined()
      expect(bodies.filter((entry) => entry.body.scope === 'function').map((entry) => entry.body.execution).sort()).toEqual(['async', 'async-generator', 'generator', 'sync'])
    } finally { await current.close() }
  })
})

function reasons(payload: TypeScriptBodyFacts): readonly string[] {
  return payload.completeness.kind === 'complete' ? [] : payload.completeness.reasons.map((reason) => reason.code)
}
