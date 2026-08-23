import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compileApi,
  compileApiIsolated,
  compileApis,
  compileApisIsolated,
} from '../compiler/index.ts'
import { API_COMPILER_BATCH_CAPACITY } from '../compiler/isolate.ts'
import {
  apiCompilerWorkerResourceReport,
  parseApiCompilerWorkerResourceReport,
} from '../compiler/isolation-work.optimization.ts'
import { planDeclarationCompilerUniverses } from '../api/project.ts'
import { emitJsonSchema } from '../json-schema/index.ts'
import { apiOutline } from '../viewer/specification/api.tsx'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('native declaration API foundation', () => {
  it('admits only an exact declaration-worker peak-residency record', () => {
    expect(
      parseApiCompilerWorkerResourceReport(Buffer.from(apiCompilerWorkerResourceReport())),
    ).toBeGreaterThan(0)
    expect(() =>
      parseApiCompilerWorkerResourceReport(
        Buffer.from('{"format":"astrale.codegraph.api-compiler-worker-resource","version":1}'),
      ),
    ).toThrow('resource report is invalid')
  })

  it('preserves the authored V2 declaration algebra', async () => {
    const current = await declarationFixture(`
export type Intrinsics = bigint
export type SocketConstructor = new (url: string | URL) => WebSocket
export interface ExecutionControl { readonly signal: AbortSignal }
export interface Lease { readonly signal: ExecutionControl['signal'] }
export type Endpoint = string | URL
export declare function connect(endpoint?: Endpoint): void
export interface ViewProps { readonly id: string }
export interface ViewContext { readonly revision: string }
export interface ViewDocument { readonly title: string }
export type ViewComponent<Props> = (props: Props, context: ViewContext) => ViewDocument
export declare const View: ViewComponent<ViewProps>
`)
    const v2Only = await declarationFixture(`
export type ExactBigInt = 9007199254740993n
export type ExtendedIntrinsics = symbol | object
`)

    const specification = await compileApi({
      mainFile: current.api,
      projectRoot: current.root,
      semantics: 'specification-v2',
    })
    const extended = await compileApi({
      mainFile: v2Only.api,
      projectRoot: v2Only.root,
      semantics: 'specification-v2',
    })

    expect(specification.diagnostics).toEqual([])
    expect(extended.diagnostics).toEqual([])
    expect(specification.ok).toBe(true)
    expect(specification.api?.version).toBe(2)

    const declaration = (name: string) =>
      specification.api?.surface.declarations.find((item) => item.name === name)
    const extendedDeclaration = (name: string) =>
      extended.api?.surface.declarations.find((item) => item.name === name)
    expect(extendedDeclaration('ExactBigInt')?.valueType).toEqual({
      kind: 'bigint-literal',
      value: '9007199254740993',
    })
    expect(declaration('Intrinsics')?.valueType).toEqual({
      kind: 'primitive',
      name: 'bigint',
    })
    expect(extendedDeclaration('ExtendedIntrinsics')?.valueType).toEqual({
      kind: 'union',
      types: expect.arrayContaining([
        { kind: 'primitive', name: 'object' },
        { kind: 'primitive', name: 'symbol' },
      ]),
    })
    expect(declaration('SocketConstructor')?.valueType).toMatchObject({
      kind: 'constructor',
      callable: {
        parameters: [{ name: 'url', type: { kind: 'union' } }],
        returns: { kind: 'reference', name: 'WebSocket' },
      },
    })
    expect(declaration('Lease')?.properties?.[0]?.type).toMatchObject({
      kind: 'indexed-access',
      object: { kind: 'reference', name: 'ExecutionControl' },
      index: { kind: 'literal', value: 'signal' },
    })
    expect(declaration('connect')?.callable?.parameters[0]?.type).toMatchObject({
      kind: 'reference',
      name: 'Endpoint',
    })
    expect(declaration('View')?.callable).toMatchObject({
      parameters: [
        { name: 'props', type: { kind: 'reference', name: 'ViewProps' } },
        { name: 'context', type: { kind: 'reference', name: 'ViewContext' } },
      ],
      returns: { kind: 'reference', name: 'ViewDocument' },
    })

  })

  it('compiles a located, serializable semantic model directly from api.d.ts', async () => {
    const current = await declarationFixture(`
/** Stable identifier. */
export type Identifier = string

export interface Payload {
  readonly id: Identifier
  readonly labels?: readonly string[]
}

export declare class Client {
  /** @throws NOT_FOUND */
  load(id: Identifier): Promise<Payload>
}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(() => JSON.stringify(result.api)).not.toThrow()
    expect(result.api).toMatchObject({
      format: 'astrale.api',
      version: 2,
      entrypoint: '.spec/api.d.ts',
    })
    expect(result.api?.sourceRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(result.api?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual([
      'Identifier',
      'Payload',
      'Client',
    ])
    const identifier = result.api?.surface.declarations.find(({ name }) => name === 'Identifier')
    const client = result.api?.surface.declarations.find(({ name }) => name === 'Client')
    expect(client).toMatchObject({ kind: 'class' })
    expect(result.api?.metadata[identifier!.identity]?.form).toBe('type-alias')
    expect(result.api?.metadata[client!.identity]?.form).toBe('class')
    expect(result.api?.metadata[`${client?.identity}#load`]).toMatchObject({
      errors: ['NOT_FOUND'],
      form: 'method',
    })
    expect(result.api?.tokens).toContainEqual(
      expect.objectContaining({ text: 'load', declaration: `${client?.identity}#load` }),
    )
    expect(result.api?.tokens.some(({ target }) => target?.includes('Identifier'))).toBe(true)

    const semanticOnly = await compileApi({
      mainFile: current.api,
      projectRoot: current.root,
      declarationNavigation: false,
    })
    expect(semanticOnly.api?.tokens).toEqual([])
    expect(semanticOnly.api?.fingerprint).toBe(result.api?.fingerprint)
    expect(semanticOnly.api?.surface).toEqual(result.api?.surface)
    expect(semanticOnly.api?.metadata).toEqual(result.api?.metadata)
    expect(semanticOnly.api?.sources).toEqual(
      result.api?.sources.map(({ text: _text, ...source }) => source),
    )

    const diagnosticsOnly = await compileApi({
      mainFile: current.api,
      projectRoot: current.root,
      declarationModel: false,
      declarationNavigation: false,
    })
    expect(diagnosticsOnly).toEqual({
      ok: true,
      diagnostics: [],
      dependencies: result.dependencies,
    })
  })

  it('tracks imported declaration sources and separates semantic from textual revisions', async () => {
    const current = await declarationFixture(
      `import type { Value } from './value.js'\nexport interface Root { readonly value: Value }\n`,
      { 'value.d.ts': 'export type Value = string\n' },
    )
    const before = await compileApi({ mainFile: current.api, projectRoot: current.root })
    await writeFile(
      join(current.root, '.spec/value.d.ts'),
      '\nexport type Value = string\n',
      'utf8',
    )
    const after = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(before.ok).toBe(true)
    expect(after.ok).toBe(true)
    expect(after.api?.sources.map(({ file }) => file)).toEqual([
      '.spec/api.d.ts',
      '.spec/value.d.ts',
    ])
    expect(after.api?.fingerprint).toBe(before.api?.fingerprint)
    expect(after.api?.sourceRevision).not.toBe(before.api?.sourceRevision)
  })

  it('admits large hierarchical APIs while retaining the declaration-byte ceiling', async () => {
    const fragments = Object.fromEntries(
      Array.from({ length: 160 }, (_, index) => [
        `fragment-${index}.d.ts`,
        `${index < 159 ? `import type { Fragment${index + 1} } from './fragment-${index + 1}.js'\n` : ''}export interface Fragment${index} { readonly next: ${index < 159 ? `Fragment${index + 1}` : 'string'} }\n`,
      ]),
    )
    const current = await declarationFixture(
      `import type { Fragment0 } from './fragment-0.js'\nexport interface Root { readonly value: Fragment0 }\n`,
      fragments,
    )
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.sources).toHaveLength(161)
  })

  it('keeps semantic issue ranges relative to the analyzed project rather than process cwd', async () => {
    const current = await declarationFixture(`
export interface MixedRecord {
  readonly fixed: string
  readonly [key: string]: string
}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TYPESCRIPT_INDEX_SIGNATURE_UNSUPPORTED',
        range: expect.objectContaining({ file: '.spec/api.d.ts' }),
      }),
    )
  })

  it('represents inherited index semantics through heritage without inventing an own signature', async () => {
    const current = await declarationFixture(`
/** @conformance identity */
export interface StringRecord {
  readonly [key: string]: string
}
export interface BrandedRecord extends StringRecord {
  readonly brand: 'record'
}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const branded = result.api?.surface.declarations.find(({ name }) => name === 'BrandedRecord')

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(branded?.extends).toHaveLength(1)
    expect(branded?.properties).toContainEqual(expect.objectContaining({ name: 'brand' }))
  })

  it('keeps platform-global identity stable across ambient declaration merging', async () => {
    const current = await declarationFixture(
      `import type { RuntimeGlobals } from './runtime-globals.js'\nexport interface Lease { readonly signal: AbortSignal; readonly globals?: RuntimeGlobals }\n`,
      {
        'runtime-globals.d.ts': `
declare global {
  interface AbortSignal { readonly runtimeAugmentation: true }
}
export type RuntimeGlobals = true
export {}
`,
      },
    )
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const lease = result.api?.surface.declarations.find(({ name }) => name === 'Lease')

    expect(result.diagnostics).toEqual([])
    expect(result.ok).toBe(true)
    expect(lease?.properties).toContainEqual(
      expect.objectContaining({
        name: 'signal',
        type: {
          kind: 'reference',
          identity: 'platform:typescript#AbortSignal',
          name: 'AbortSignal',
          arguments: [],
        },
      }),
    )
  })

  it('keeps semantic fingerprints stable across declaration and member reordering', async () => {
    const current = await declarationFixture(`
export interface Alpha {
  readonly first: string
  readonly second: number
}
export type Beta = Alpha | null
`)
    const before = await compileApi({ mainFile: current.api, projectRoot: current.root })
    await writeFile(
      current.api,
      `
export type Beta = Alpha | null
export interface Alpha {
  readonly second: number
  readonly first: string
}
`,
      'utf8',
    )
    const after = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(before.ok).toBe(true)
    expect(after.ok).toBe(true)
    expect(after.api?.fingerprint).toBe(before.api?.fingerprint)
    expect(after.api?.sourceRevision).not.toBe(before.api?.sourceRevision)
  })

  it('preserves authored export order across declaration kinds and merged facets', async () => {
    const current = await declarationFixture(`
export type ClassPath = string
export declare const ClassPath: (input: string) => ClassPath
export declare function isClassPath(input: unknown): input is ClassPath
export declare function compareClassPaths(left: ClassPath, right: ClassPath): number
export declare class ClassPathError extends Error {}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual([
      'ClassPath',
      'isClassPath',
      'compareClassPaths',
      'ClassPathError',
    ])
  })

  it('models a merged generic type and object-valued constructor namespace', async () => {
    const current = await declarationFixture(`
export type Domain<S extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> = { readonly schema: S }
export interface DomainConstructor {
  fromSchema<const S extends Readonly<Record<string, unknown>>>(schema: S): Domain<S>
}
export declare const Domain: DomainConstructor
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    const domain = result.api?.surface.declarations.find(({ name }) => name === 'Domain')
    expect(domain).toMatchObject({
      kind: 'factory',
      facets: {
        type: {
          kind: 'type-alias',
          valueType: { kind: 'reference', name: 'Domain' },
          authoredValueType: { kind: 'object' },
        },
        value: { kind: 'value' },
      },
    })
    const constructor = result.api?.surface.declarations.find(
      ({ name }) => name === 'DomainConstructor',
    )
    expect(constructor?.callables?.[0]?.callable?.typeParameters).toMatchObject([
      { index: 0, name: 'S' },
    ])
  })

  it('stores merged declaration conformance under collision-free facet keys', async () => {
    const current = await declarationFixture(`
/** @conformance identity */
export type Token = string
export declare function Token(input: string): Token
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const token = result.api?.surface.declarations.find(({ name }) => name === 'Token')

    expect(result.ok).toBe(true)
    expect(token?.kind).toBe('factory')
    expect(result.api?.metadata[`${token!.identity}#facet:type`]?.conformance).toBe('identity')
    expect(result.api?.metadata[`${token!.identity}#facet:value`]?.conformance).toBe('exact')
    expect(result.api?.metadata[`${token!.identity}#type`]).toBeUndefined()
  })

  it('models template-literal types as recursive type evidence', async () => {
    const current = await declarationFixture(`
export type Key<Origin extends string, Reference extends string> = \`${'${Origin}'}:${'${Reference}'}\`
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const key = result.api?.surface.declarations.find(({ name }) => name === 'Key')

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(key?.valueType).toEqual({
      kind: 'template',
      texts: ['', ':', ''],
      types: [
        { kind: 'parameter', scope: expect.any(String), index: 0 },
        { kind: 'parameter', scope: expect.any(String), index: 1 },
      ],
    })
  })

  it('models a class with a type-only namespace facet', async () => {
    const current = await declarationFixture(`
export class Path {
  readonly text: string
}
export namespace Path {
  export interface AST { readonly steps: readonly string[] }
  export type Step = string
}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual([
      'Path',
      'Path.AST',
      'Path.Step',
    ])
    expect(result.api?.surface.declarations.find(({ name }) => name === 'Path')).toMatchObject({
      kind: 'class',
    })
  })

  it('models a callable factory with an advanced namespace facet', async () => {
    const current = await declarationFixture(`
export type Ref = \`class.${'${string}'}\`
export function Ref(input: string): Ref
export namespace Ref {
  export type Class<Name extends string = string> = \`class.${'${Name}'}\`
  export function is(input: unknown): input is Ref
}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual([
      'Ref',
      'Ref.Class',
      'Ref.is',
    ])
    expect(result.api?.surface.declarations.find(({ name }) => name === 'Ref')).toMatchObject({
      kind: 'factory',
    })
  })

  it('treats only explicit exports as roots while retaining their private type closure', async () => {
    const current = await declarationFixture(`
type Reachable = string
interface Unused { readonly ignored: true }
export interface Public { readonly value: Reachable }
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual(['Public'])
    expect(result.api?.surface.declarations.map(({ name }) => name).sort()).toEqual([
      'Public',
      'Reachable',
    ])
  })

  it('rejects underscore-prefixed declarations that pretend to be private', async () => {
    const current = await declarationFixture(
      `
import type { Value as _ImportedValue } from './value.js'
type _ImportedAlias = string
export interface Public {
  readonly imported: _ImportedValue
  readonly local: _ImportedAlias
}
`,
      { 'value.d.ts': 'export type Value = string\n' },
    )

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'api',
          code: 'API_PSEUDO_PRIVATE_DECLARATION',
          severity: 'error',
          message: expect.stringContaining('_ImportedValue'),
          range: expect.objectContaining({ file: '.spec/api.d.ts' }),
        }),
        expect.objectContaining({
          source: 'api',
          code: 'API_PSEUDO_PRIVATE_DECLARATION',
          severity: 'error',
          message: expect.stringContaining('_ImportedAlias'),
          range: expect.objectContaining({ file: '.spec/api.d.ts' }),
        }),
      ]),
    )
  })

  it('infers shape-free identity declarations without authoring annotations', async () => {
    const current = await declarationFixture(`
export type Opaque = unknown
export interface Marker {}
export function placeholder(): unknown
/** @conformance exact */
export interface ExactEmpty {}
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const conformance = Object.fromEntries(
      result.api?.surface.declarations.map((declaration) => [
        declaration.name,
        result.api?.metadata[declaration.identity]?.conformance,
      ]) ?? [],
    )

    expect(result.ok).toBe(true)
    expect(conformance).toMatchObject({
      Opaque: 'identity',
      Marker: 'identity',
      placeholder: 'identity',
      ExactEmpty: 'exact',
    })
  })

  it('treats native package imports as external identities without annotation stubs', async () => {
    const current = await declarationFixture(`
import type { ExternalValue } from 'uninstalled-external'
export interface Public { readonly value: ExternalValue }
`)

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const external = result.api?.surface.declarations.find(({ name }) => name === 'ExternalValue')

    expect(result.ok).toBe(true)
    expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
    expect(external).toMatchObject({
      kind: 'value',
      packageCoordinate: 'package:uninstalled-external',
    })
    expect(external?.properties).toBeUndefined()
    expect(result.api?.metadata[external!.identity]).toMatchObject({
      conformance: 'identity',
    })
  })

  it('preserves authored generic arity for external identity imports', async () => {
    const current = await declarationFixture(`
import type { Generic as NamedGeneric } from 'uninstalled-external'
import type * as external from 'uninstalled-external'
export interface Public {
  readonly named: NamedGeneric<string>
  readonly qualified: external.Generic<string, number>
}
`)

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
  })

  it('preserves opaque external identities inside variadic tuples', async () => {
    const current = await declarationFixture(
      `
import type { ExternalValue } from 'uninstalled-external'
export function select(values: ExternalValue | readonly [ExternalValue, ...ExternalValue[]]): void
`,
      {
        'value-api.d.ts':
          "export declare const ExternalValue: typeof import('uninstalled-external').ExternalValue\n",
      },
    )

    const [result, valueResult] = await compileApis([
      { mainFile: current.api, projectRoot: current.root },
      { mainFile: join(dirname(current.api), 'value-api.d.ts'), projectRoot: current.root },
    ])

    expect(result?.diagnostics).toEqual([])
    expect(valueResult?.diagnostics).toEqual([])
    expect(result?.ok).toBe(true)
    expect(valueResult?.ok).toBe(true)
    expect(result?.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
    expect(
      result?.api?.surface.declarations
        .filter(({ packageCoordinate }) => packageCoordinate === 'package:uninstalled-external')
        .map(({ name }) => name),
    ).toEqual(['ExternalValue'])
  })

  it('preserves opaque external identities repeated inside a callable union', async () => {
    const current = await declarationFixture(`
import type { ExternalValue } from 'uninstalled-external'
export type Policy =
  | ExternalValue
  | null
  | ((value: ExternalValue) => ExternalValue | null)
`)

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
  })

  it('projects namespace-shaped library exports from named, namespace, and default imports', async () => {
    const fixtures = await Promise.all([
      declarationFixture(`
import type { z } from 'zod'
export interface NamedZodContract {
  readonly schema: z.ZodType<string>
  readonly inferred: z.infer<z.ZodString>
  readonly issue: z.core.$ZodIssue
}
`),
      declarationFixture(`
import type * as z from 'zod'
export interface NamespaceZodContract {
  readonly output: z.core.output<z.ZodType<string>>
  readonly factory: typeof z.string
}
`),
      declarationFixture(`
import type z from 'zod'
export interface DefaultZodContract {
  readonly schema: z.ZodType<string>
  readonly factory: typeof z.string
}
`),
      declarationFixture(`
import type { Hybrid, Schema } from 'typed-library'
export interface MergedLibraryContract {
  readonly direct: Hybrid<string>
  readonly nested: Hybrid.Member<number>
  readonly schema: Schema<string>
  readonly schemaConstructor: typeof Schema
}
`),
    ])

    const results = await Promise.all(
      fixtures.map((fixture) => compileApi({ mainFile: fixture.api, projectRoot: fixture.root })),
    )

    for (const result of results) {
      expect(result.ok).toBe(true)
      expect(result.diagnostics).toEqual([])
      expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
      expect(
        result.api?.surface.declarations
          .filter(({ packageCoordinate }) => packageCoordinate?.startsWith('package:'))
          .map(({ name }) => name),
      ).not.toHaveLength(0)
    }

    const isolated = await compileApiIsolated({
      mainFile: fixtures[0]!.api,
      projectRoot: fixtures[0]!.root,
    })
    expect(isolated.ok).toBe(true)
    expect(isolated.diagnostics).toEqual([])
  })

  it('never parses installed library declarations for external API identities', async () => {
    const current = await declarationFixture(`
export type Direct = import('explosive-library').Generic<string>
export type Factory = typeof import('explosive-library').factory
`)
    const dependency = join(current.root, 'node_modules/explosive-library')
    await mkdir(dependency, { recursive: true })
    await writeFile(
      join(dependency, 'package.json'),
      JSON.stringify({ name: 'explosive-library', types: 'index.d.ts' }),
      'utf8',
    )
    await writeFile(
      join(dependency, 'index.d.ts'),
      'export interface Generic<Value> { readonly broken: }\n',
      'utf8',
    )

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.sources.map(({ file }) => file)).toEqual(['.spec/api.d.ts'])
    expect(
      result.api?.surface.declarations
        .filter(({ packageCoordinate }) => packageCoordinate === 'package:explosive-library')
        .map(({ name }) => name)
        .sort(),
    ).toEqual(['Generic', 'factory'])
  })

  it('rejects ambient package references before third-party declarations can enter the program', async () => {
    const current = await declarationFixture(`
/// <reference types="explosive-library" />
export type Public = string
`)
    const dependency = join(current.root, 'node_modules/explosive-library')
    await mkdir(dependency, { recursive: true })
    await writeFile(
      join(dependency, 'package.json'),
      JSON.stringify({ name: 'explosive-library', types: 'index.d.ts' }),
      'utf8',
    )
    await writeFile(join(dependency, 'index.d.ts'), 'not valid TypeScript }}}', 'utf8')

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'API_COMPILE_FAILED',
        message: expect.stringContaining('type-reference directives are unsupported'),
      }),
    ])
  })

  it('binds interface type parameters nested through imported generic declarations', async () => {
    const current = await declarationFixture(
      `import type { Wrapper } from './wrapper.js'
export interface Backend<Preparation, Continuity> {
  prepare(): Promise<Wrapper<Preparation>>
  inspect(): Promise<Wrapper<Continuity>>
}
export type ConcreteBackend = Backend<string, number>
`,
      { 'wrapper.d.ts': 'export interface Wrapper<Value> { readonly value: Value }\n' },
    )

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('rejects runtime and star imports at the declaration boundary', async () => {
    const runtime = await declarationFixture(`
import { ExternalValue } from 'uninstalled-external'
export type Public = ExternalValue
`)
    const star = await declarationFixture(`export * from 'uninstalled-external'\n`)

    const runtimeResult = await compileApi({ mainFile: runtime.api, projectRoot: runtime.root })
    const starResult = await compileApi({ mainFile: star.api, projectRoot: star.root })

    expect(runtimeResult).toMatchObject({ ok: false })
    expect(runtimeResult.diagnostics[0]?.message).toContain('must be type-only')
    expect(starResult).toMatchObject({ ok: false })
    expect(starResult.diagnostics[0]?.message).toContain('star API exports are unsupported')
  })

  it('models named external runtime re-exports as opaque package identities', async () => {
    const current = await declarationFixture(
      "export { ExternalValue } from 'uninstalled-external'\n",
    )

    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })
    const external = result.api?.surface.declarations.find(({ name }) => name === 'ExternalValue')

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.surface.exports).toEqual([
      expect.objectContaining({
        path: ['ExternalValue'],
        typeOnly: false,
        sourceModule: 'package:uninstalled-external',
      }),
    ])
    expect(external).toMatchObject({
      name: 'ExternalValue',
      kind: 'class',
      packageCoordinate: 'package:uninstalled-external',
    })
    expect(result.api?.metadata[external!.identity]).toMatchObject({
      conformance: 'identity',
    })
  })

  it('requires a declaration entrypoint inside the declared project root', async () => {
    const current = await declarationFixture('export type Value = string\n')
    const wrongExtension = join(current.root, '.spec/api.ts')
    await writeFile(wrongExtension, 'export type Value = string\n', 'utf8')
    const extension = await compileApi({ mainFile: wrongExtension, projectRoot: current.root })
    expect(extension).toMatchObject({ ok: false })
    expect(extension.diagnostics[0]?.code).toBe('API_ENTRYPOINT_EXTENSION')

    const outside = await mkdtemp(join(tmpdir(), 'astrale-api-outside-'))
    temporary.push(outside)
    const outsideApi = join(outside, 'api.d.ts')
    await writeFile(outsideApi, 'export type Secret = string\n', 'utf8')
    const link = join(current.root, '.spec/outside.d.ts')
    await symlink(outsideApi, link)
    const escaped = await compileApi({ mainFile: link, projectRoot: current.root })
    expect(escaped).toMatchObject({ ok: false })
    expect(escaped.diagnostics[0]?.code).toBe('API_ENTRYPOINT_OUTSIDE_ROOT')
  })

  it('reports native TypeScript diagnostics and models generic call signatures', async () => {
    const syntax = await declarationFixture('export interface Broken { value: }\n')
    const syntaxResult = await compileApi({ mainFile: syntax.api, projectRoot: syntax.root })
    expect(syntaxResult.ok).toBe(false)
    expect(syntaxResult.diagnostics.some(({ code }) => /^TS\d+$/.test(code))).toBe(true)

    const genericCall = await declarationFixture(
      'export declare function identity<T>(value: T): T\n',
    )
    const genericCallResult = await compileApi({
      mainFile: genericCall.api,
      projectRoot: genericCall.root,
    })
    expect(genericCallResult.ok).toBe(true)
    expect(genericCallResult.diagnostics).toEqual([])
    expect(genericCallResult.api?.surface.declarations[0]?.typeParameters).toMatchObject([
      { index: 0, name: 'T' },
    ])

    const callableInterface = await declarationFixture(
      'export interface InvocationIdSource { (): string }\n',
    )
    const callableInterfaceResult = await compileApi({
      mainFile: callableInterface.api,
      projectRoot: callableInterface.root,
    })
    expect(callableInterfaceResult.ok).toBe(true)
    expect(callableInterfaceResult.diagnostics).toEqual([])
    expect(callableInterfaceResult.api?.surface.declarations[0]).toMatchObject({
      kind: 'interface',
      callable: {
        parameters: [],
        returns: { kind: 'primitive', name: 'string' },
        mode: 'sync',
      },
    })
  })

  it('models complete overload sets and utility-derived literal evidence', async () => {
    const current = await declarationFixture(`
export type Delivery = 'not-sent' | 'unknown'
export type ProvenDelivery = Extract<Delivery, 'not-sent'>

export interface Binding {
  bind(value: string): string
  bind(value: number): number
}

export declare function resolve(value: string): string
export declare function resolve(value: number): number
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    const binding = result.api?.surface.declarations.find(({ name }) => name === 'Binding')
    const resolve = result.api?.surface.declarations.find(({ name }) => name === 'resolve')
    expect(binding?.callables?.[0]?.overloads).toHaveLength(2)
    expect(resolve?.overloads).toHaveLength(2)
  })

  it('models generic syscall descriptors and recursive namespace exports exactly', async () => {
    const current = await declarationFixture(`export * as syscalls from './syscalls/index.js'\n`, {
      'graph.d.ts': `
export interface QueryAST { readonly kind: 'query' }
export interface QueryResult { readonly nodes: readonly string[] }
`,
      'syscalls/descriptor.d.ts': `
declare const syscallInput: unique symbol
declare const syscallOutput: unique symbol

export interface Syscall<Method extends string, Input, Output> {
  readonly method: Method
  readonly [syscallInput]?: (input: Input) => void
  readonly [syscallOutput]?: () => Output
}
`,
      'syscalls/graph.d.ts': `
import type { QueryAST, QueryResult } from '../graph.js'
import type { Syscall } from './descriptor.js'

export declare const query: Syscall<'graph.query', QueryAST, QueryResult>
`,
      'syscalls/index.d.ts': `
export type { Syscall } from './descriptor.js'
export * as graph from './graph.js'
`,
    })
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.api?.surface.exports.map(({ path }) => path.join('.'))).toEqual([
      'syscalls.Syscall',
      'syscalls.graph.query',
    ])
    expect(apiOutline(result.api!)).toMatchObject([
      {
        type: 'group',
        name: 'syscalls',
        count: 2,
        children: [
          { type: 'export', name: 'Syscall', path: 'syscalls.Syscall' },
          {
            type: 'group',
            name: 'graph',
            count: 1,
            children: [{ type: 'export', name: 'query', path: 'syscalls.graph.query' }],
          },
        ],
      },
    ])

    const syscall = result.api?.surface.declarations.find(({ name }) => name === 'Syscall')
    expect(syscall?.typeParameters).toMatchObject([
      { index: 0, name: 'Method', constraint: { kind: 'primitive', name: 'string' } },
      { index: 1, name: 'Input' },
      { index: 2, name: 'Output' },
    ])
    expect(syscall?.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'method',
          key: 'named',
          type: expect.objectContaining({ kind: 'parameter', index: 0 }),
        }),
        expect.objectContaining({
          key: 'unique-symbol',
          type: expect.objectContaining({ kind: 'function' }),
        }),
      ]),
    )

    const query = result.api?.surface.declarations.find(({ name }) => name === 'query')
    expect(query?.valueType).toMatchObject({
      kind: 'reference',
      name: 'Syscall',
      arguments: [
        { kind: 'literal', value: 'graph.query' },
        { kind: 'reference', name: 'QueryAST', arguments: [] },
        { kind: 'reference', name: 'QueryResult', arguments: [] },
      ],
    })
  })

  it('models directly recursive public type aliases through their named identity', async () => {
    const current = await declarationFixture(`
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [name: string]: JsonValue }

export type Predicate =
  | { readonly op: 'true' }
  | { readonly op: 'not'; readonly predicate: Predicate }
  | { readonly op: 'all'; readonly predicates: readonly Predicate[] }
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    for (const name of ['JsonValue', 'Predicate']) {
      const declaration = result.api?.surface.declarations.find((entry) => entry.name === name)
      expect(declaration?.issues).toEqual([])
      expect(JSON.stringify(declaration?.valueType)).toContain(`"name":"${name}"`)
    }
  })

  it('models authored conditional type aliases without erasing their branches', async () => {
    const current = await declarationFixture(`
export interface NodeResult { readonly kind: 'node' }
export interface EdgeResult { readonly kind: 'edge' }
export interface Box<out Value> { readonly value: Value }
export type ResultOf<Output extends 'node' | 'edge'> =
  Output extends 'node' ? NodeResult : EdgeResult
export declare function preserve<const Value>(value: Value): Value
`)
    const result = await compileApi({ mainFile: current.api, projectRoot: current.root })

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    const resultOf = result.api?.surface.declarations.find(({ name }) => name === 'ResultOf')
    expect(resultOf?.valueType).toMatchObject({
      kind: 'conditional',
      check: { kind: 'parameter', index: 0 },
      extends: { kind: 'literal', value: 'node' },
      trueType: { kind: 'reference', name: 'NodeResult' },
      falseType: { kind: 'reference', name: 'EdgeResult' },
    })
    expect(
      result.api?.surface.declarations.find(({ name }) => name === 'Box')?.typeParameters,
    ).toMatchObject([{ variance: 'out' }])
    expect(
      result.api?.surface.declarations.find(({ name }) => name === 'preserve')?.callable
        ?.typeParameters,
    ).toMatchObject([{ const: true }])
  })

  it('compiles in a disposable process and enforces its deadline', async () => {
    const current = await declarationFixture('export type Value = string\n')
    const compiled = await compileApiIsolated({ mainFile: current.api, projectRoot: current.root })
    expect(compiled).toMatchObject({ ok: true, api: { format: 'astrale.api' } })

    const timedOut = await compileApiIsolated({
      mainFile: current.api,
      projectRoot: current.root,
      timeoutMs: 1,
    })
    expect(timedOut).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'isolation/timeout',
          message: 'API declaration compilation exceeded 1 ms.',
        }),
      ],
    })

    const batchTimedOut = await compileApisIsolated(
      Array.from({ length: API_COMPILER_BATCH_CAPACITY + 1 }, () => ({
        mainFile: current.api,
        projectRoot: current.root,
      })),
      { timeoutMs: 1 },
    )
    expect(API_COMPILER_BATCH_CAPACITY).toBeGreaterThan(1)
    expect(batchTimedOut).toHaveLength(API_COMPILER_BATCH_CAPACITY + 1)
    for (const result of batchTimedOut.slice(0, API_COMPILER_BATCH_CAPACITY)) {
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: 'isolation/timeout',
            message: `API declaration batch of ${API_COMPILER_BATCH_CAPACITY} entrypoints exceeded 1 ms.`,
          }),
        ],
      })
    }
    expect(batchTimedOut.at(-1)).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'isolation/timeout',
          message: 'API declaration compilation exceeded 1 ms.',
        }),
      ],
    })
  })

  it('preserves exact per-entrypoint results when declarations share one compilation session', async () => {
    const current = await declarationFixture(
      `
import type { Shared } from './shared.d.ts'
export interface First { readonly shared: Shared }
`,
      {
        'shared.d.ts': 'export interface Shared { readonly id: string }\n',
        'second.d.ts': `
import type { Shared } from './shared.d.ts'
export interface Second { readonly shared: Shared }
`,
      },
    )
    const requests = [current.api, join(dirname(current.api), 'second.d.ts')].map((mainFile) => ({
      mainFile,
      projectRoot: current.root,
    }))

    const batch = await compileApis(requests)
    const singles = await Promise.all(requests.map((request) => compileApi(request)))
    const resultBytes = batch.map((result) => Buffer.byteLength(JSON.stringify(result)))
    const isolated = await compileApisIsolated(requests, {
      maxBatchEntries: requests.length,
      maxResultBytes: Math.max(...resultBytes),
    })

    expect(batch).toEqual(singles)
    expect(resultBytes.reduce((total, bytes) => total + bytes, 0)).toBeGreaterThan(
      Math.max(...resultBytes),
    )
    expect(isolated).toEqual(batch)

    const splitLimit = Math.max(...resultBytes) + 1
    const splitBatch = await compileApisIsolated(requests, {
      maxBatchEntries: requests.length,
      maxResultBytes: splitLimit,
      maxBatchResultBytes: splitLimit,
    })
    expect(splitBatch).toEqual(batch)

    const boundedBatch = await compileApisIsolated(requests, {
      maxBatchEntries: requests.length,
      maxBatchResultBytes: 1,
    })
    expect(boundedBatch).toHaveLength(requests.length)
    for (const result of boundedBatch) {
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: 'isolation/output-limit',
            message: 'API compiler batch exceeded its 1-byte output limit.',
          }),
        ],
      })
    }
  })

  it('isolates ambient declaration entrypoints from neighboring module APIs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-ambient-'))
    temporary.push(root)
    const ambient = join(root, 'ambient/api.d.ts')
    const safe = join(root, 'safe/api.d.ts')
    await mkdir(dirname(ambient), { recursive: true })
    await mkdir(dirname(safe), { recursive: true })
    await writeFile(ambient, 'interface Leaked { readonly value: string }\n', 'utf8')
    await writeFile(safe, 'export interface Safe { readonly value: Leaked }\n', 'utf8')
    const requests = [ambient, safe].map((mainFile) => ({ mainFile, projectRoot: root }))

    const batch = await compileApis(requests)
    const isolated = await Promise.all(requests.map((request) => compileApi(request)))

    expect(batch).toEqual(isolated)
    expect(batch[1]).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'TS2304' })],
    })
    const diagnosticsOnly = requests.map((request) => ({
      ...request,
      declarationModel: false,
      declarationNavigation: false,
    }))
    const diagnosticsIsolated = await Promise.all(
      diagnosticsOnly.map((request) => compileApi(request)),
    )
    expect(await compileApis(diagnosticsOnly)).toEqual(diagnosticsIsolated)
    expect(await compileApisIsolated(diagnosticsOnly)).toEqual(diagnosticsIsolated)
  })

  it('isolates inline relative import types from neighboring roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-relative-root-'))
    temporary.push(root)
    const installation = join(root, 'runtime/schema/installation/.spec/api.d.ts')
    const authorization = join(root, 'runtime/authorization/.spec/api.d.ts')
    await mkdir(dirname(installation), { recursive: true })
    await mkdir(dirname(authorization), { recursive: true })
    await writeFile(
      installation,
      "export type Decision = import('../../../authorization/.spec/api.js').PolicyDecision\n",
      'utf8',
    )
    await writeFile(authorization, 'export interface PolicyDecision { readonly pass: boolean }\n')
    const requests = [installation, authorization].map((mainFile) => ({
      mainFile,
      projectRoot: root,
      declarationModel: false,
      declarationNavigation: false,
    }))
    const isolated = await Promise.all(requests.map((request) => compileApi(request)))

    expect(planDeclarationCompilerUniverses(requests)).toEqual([[0], [1]])
    expect(await compileApis(requests)).toEqual(isolated)
    expect(await compileApisIsolated(requests)).toEqual(isolated)
    expect(isolated[0]).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'TS2307' })],
    })
  })

  it('isolates syntax-derived external package projections per entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-external-'))
    temporary.push(root)
    const first = join(root, 'first/api.d.ts')
    const second = join(root, 'second/api.d.ts')
    await mkdir(dirname(first), { recursive: true })
    await mkdir(dirname(second), { recursive: true })
    await writeFile(
      first,
      "import type Foo from 'external-package'\nexport interface First extends Foo {}\n",
      'utf8',
    )
    await writeFile(
      second,
      "import type Foo from 'external-package'\nexport type Second = Foo.Bar\n",
      'utf8',
    )
    const requests = [first, second].map((mainFile) => ({ mainFile, projectRoot: root }))

    expect(planDeclarationCompilerUniverses(requests)).toEqual([[0], [1]])
    expect(await compileApis(requests)).toEqual(
      await Promise.all(requests.map((request) => compileApi(request))),
    )
    const diagnosticsOnly = requests.map((request) => ({
      ...request,
      declarationModel: false,
      declarationNavigation: false,
    }))
    const diagnosticsIsolated = await Promise.all(
      diagnosticsOnly.map((request) => compileApi(request)),
    )
    expect(await compileApis(diagnosticsOnly)).toEqual(diagnosticsIsolated)
    expect(await compileApisIsolated(diagnosticsOnly)).toEqual(diagnosticsIsolated)
  })

  it('shares disjoint external package projections without arbitrary owner batches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-compatible-external-'))
    temporary.push(root)
    const first = join(root, 'first/api.d.ts')
    const second = join(root, 'second/api.d.ts')
    await mkdir(dirname(first), { recursive: true })
    await mkdir(dirname(second), { recursive: true })
    await writeFile(first, "import type { A } from 'package-a'\nexport type First = A\n", 'utf8')
    await writeFile(second, "import type { B } from 'package-b'\nexport type Second = B\n", 'utf8')
    const requests = [first, second].map((mainFile) => ({ mainFile, projectRoot: root }))

    expect(planDeclarationCompilerUniverses(requests)).toEqual([[0, 1]])
    expect(await compileApis(requests)).toEqual(
      await Promise.all(requests.map((request) => compileApi(request))),
    )
  })

  it('isolates per-entrypoint TypeScript library references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-library-'))
    temporary.push(root)
    const referenced = join(root, 'referenced/api.d.ts')
    const neighbor = join(root, 'neighbor/api.d.ts')
    await mkdir(dirname(referenced), { recursive: true })
    await mkdir(dirname(neighbor), { recursive: true })
    await writeFile(
      referenced,
      '/// <reference lib="esnext.disposable" />\nexport interface Referenced { value: Disposable }\n',
      'utf8',
    )
    await writeFile(neighbor, 'export interface Neighbor { value: Disposable }\n', 'utf8')
    const requests = [referenced, neighbor].map((mainFile) => ({ mainFile, projectRoot: root }))

    const batch = await compileApis(requests)
    const singles = await Promise.all(requests.map((request) => compileApi(request)))
    expect(batch).toEqual(singles)
    expect(batch[1]).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'TS2304' })],
    })
  })

  it('isolates UMD global namespace exports per entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-spec-api-umd-'))
    temporary.push(root)
    const exporter = join(root, 'exporter/api.d.ts')
    const neighbor = join(root, 'neighbor/api.d.ts')
    await mkdir(dirname(exporter), { recursive: true })
    await mkdir(dirname(neighbor), { recursive: true })
    await writeFile(exporter, 'export as namespace Leak\nexport interface A {}\n', 'utf8')
    await writeFile(neighbor, 'export interface B { readonly leak?: Leak.A }\n', 'utf8')
    const requests = [exporter, neighbor].map((mainFile) => ({ mainFile, projectRoot: root }))

    const batch = await compileApis(requests)
    const singles = await Promise.all(requests.map((request) => compileApi(request)))
    expect(batch).toEqual(singles)
    expect(batch[1]).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'TS2503' })],
    })
  })

  it('emits a sealed recursive JSON Schema bundle from explicit roots', async () => {
    const current = await declarationFixture(`
export interface Leaf {
  readonly op: 'leaf'
  /** @minLength 1 */
  readonly value: string
}
export interface Group {
  readonly op: 'group'
  /** @minItems 1 */
  readonly children: readonly Expression[]
}
export type Expression = Leaf | Group
export interface Document { readonly root: Expression }
`)
    const result = await emitJsonSchema({
      mainFile: current.api,
      projectRoot: current.root,
      roots: ['Document'],
      bundleId: 'https://schemas.astrale.ai/fixture/document.json',
    })

    expect(result).toMatchObject({
      ok: true,
      diagnostics: [],
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://schemas.astrale.ai/fixture/document.json',
        $defs: {
          Document: { type: 'object', additionalProperties: false, required: ['root'] },
          Leaf: { type: 'object', additionalProperties: false },
          Group: { type: 'object', additionalProperties: false },
        },
      },
    })
    const serialized = JSON.stringify(result.schema)
    expect(serialized).not.toContain('#/definitions/')
    expect(serialized).toContain('#/$defs/')
  })

  it('rejects missing, duplicated, and function-valued JSON Schema roots', async () => {
    const current = await declarationFixture(`
export interface Safe { readonly value: string }
export type Unsafe = (value: string) => string
`)
    const base = {
      mainFile: current.api,
      projectRoot: current.root,
      bundleId: 'https://schemas.astrale.ai/fixture/root.json',
    }
    expect((await emitJsonSchema({ ...base, roots: [] })).diagnostics[0]?.code).toBe(
      'JSON_SCHEMA_ROOTS',
    )
    expect((await emitJsonSchema({ ...base, roots: ['Safe', 'Safe'] })).diagnostics[0]?.code).toBe(
      'JSON_SCHEMA_ROOTS',
    )
    expect((await emitJsonSchema({ ...base, roots: ['Missing'] })).ok).toBe(false)
    const unsafe = await emitJsonSchema({ ...base, roots: ['Unsafe'] })
    expect(unsafe.ok).toBe(false)
    expect(unsafe.diagnostics[0]?.code).toBe('JSON_SCHEMA_GENERATION_FAILED')
  })
})

async function declarationFixture(
  source: string,
  dependencies: Readonly<Record<string, string>> = {},
): Promise<{ root: string; api: string }> {
  const root = await mkdtemp(join(tmpdir(), 'astrale-api-native-'))
  temporary.push(root)
  const directory = join(root, '.spec')
  await mkdir(directory)
  const api = join(directory, 'api.d.ts')
  await writeFile(api, source, 'utf8')
  await Promise.all(
    Object.entries(dependencies).map(async ([name, text]) => {
      const target = join(directory, name)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, text, 'utf8')
    }),
  )
  return { root, api }
}
