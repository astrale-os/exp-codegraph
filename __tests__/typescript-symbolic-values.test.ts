import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type SymbolicCallModel, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { OccurrenceId, SymbolId } from '../analysis/identity/index.ts'

const effectFanout = Array.from({ length: 128 }, (_, index) =>
  `function effect${index}(value: any) { ${index === 127 ? "value.build = () => 'changed'" : `effect${index + 1}(value); effect${Math.min(index + 2, 127)}(value)`} }`).join('\n')

const source = `
${effectFanout}
import { helper, shared } from './helper'
import * as supplied from './helper'
import * as Library from '@fixture/reexport'
import type * as Types from '@fixture/reexport'
import { facade } from '@fixture/fabricated'
declare function marker(value: string): unknown
declare const opaque: object
declare const flag: boolean
declare function unknownFactory(): unknown
declare function externalMutate(value: unknown): void
function capture(value: unknown) { return () => value }
function rest(...values: unknown[]) { return values }
function first(value: unknown) { return value }
function mutate(value: any) { value.build = () => 'changed' }
function forwardMutation(value: any) { mutate(value) }
const base = { build: capture(marker('closed')), project: () => 'view' }
export const definition = () => ({ ...base })
const libraryAlias = Library
const castNamespace = supplied as unknown as typeof Library
const fabricatedNamespace = { marker: () => 'local' } as typeof Library
const nestedFabricated = { Alias: { build: () => 'fabricated' } } as typeof Library
export const namespaceMember = Library.marker
export const namespaceCastMember = castNamespace.marker
export const namespaceCastCall = castNamespace.marker('fake-module')
export const fabricatedNestedMember = nestedFabricated.Alias.build
export const typeOnlyNamespaceMember = Types.marker
export const aliasedNamespaceMember = libraryAlias.marker
export const fabricatedNamespaceMember = fabricatedNamespace.marker
export const fabricatedExternalMember = facade.marker
export const namespaceMemberCall = Library.marker('namespace')
export const fabricatedNamespaceCall = fabricatedNamespace.marker('fake')
export const fabricatedExternalCall = facade.marker('fake-external')
export const laterExplicit = () => ({ ...opaque, build: () => marker('explicit') })
export const laterOpaque = () => ({ build: () => marker('hidden'), ...opaque })
export const asyncDefinition = async () => ({ build: () => marker('async') })
async function asyncLiteral() { return 'promise-result' }
function* generatorLiteral() { return 'iterator-result' }
function* generatorRequest() { return marker('iterator-request') }
export const asyncCall = asyncLiteral()
export const generatorCall = generatorLiteral()
export const generatorDefinition = () => ({ build: generatorRequest })
export const restDefinition = () => ({ build: () => rest(marker('rest')) })
export const spreadDefinition = () => ({ build: () => first(...[marker('spread')]) })
export const branch = () => flag ? marker('left') : marker('right')
export const uncertainBranch = () => flag ? marker('possible') : unknownFactory()
export const dependent = () => ({ build: helper })
export const crossMutation = () => shared
export const direct = marker('direct')
export const nestedIdentity = first(first('nested'))
export const compound = () => { let value: any = ''; value += marker('compound'); return value }
export const reassigned = () => { let value: any = 'old'; value = 'new'; return value }
export const reassignedCall = reassigned()
export const mutatedObject = () => {
  const object = { build: () => marker('obsolete') }
  object.build = () => 'changed'
  return object
}
export const mutatedAlias = () => {
  const object = { build: () => marker('obsolete-alias') }
  const alias = object
  alias.build = () => 'changed'
  return object
}
export const localEffect = () => {
  const options = { build: () => marker('obsolete-local') }
  mutate(options)
  return options
}
export const forwardedEffect = () => {
  const options = { build: () => marker('obsolete-forwarded') }
  forwardMutation(options)
  return options
}
export const externalEffect = () => {
  const options = { build: () => marker('obsolete-external') }
  externalMutate(options)
  return options
}
export const capturedWrite = () => {
  let value: unknown = marker('obsolete-capture')
  const read = () => value
  value = 'changed'
  return { build: read }
}
export const interproceduralWrite = () => {
  let value: unknown = 'old'
  const mutate = () => { value = 'changed' }
  value = marker('obsolete-interprocedural')
  mutate()
  return value
}
let selected: unknown = marker('observed-factory')
function choose() { return selected }
selected = 'reassigned'
export const mutableFactory = choose()
export const boundedEffect = () => {
  const options = { build: () => marker('obsolete-budgeted') }
  effect0(options)
  return options
}
`

describe('symbolic values through the public project API', () => {
  let root: string
  let project: TypeScriptProject
  let snapshot: TypeScriptProjectSnapshot
  let model: SymbolicCallModel<string>
  const declarations = new Map<string, OccurrenceId>()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codegraph-symbolic-'))
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, noEmit: true }, files: ['index.ts', 'helper.ts', 'mutator.ts'] })),
      writeFile(join(root, 'index.ts'), source),
      writeFile(join(root, 'helper.ts'), "export function helper() { return 'old' }\nexport const shared = { build: () => 'stable' }\nexport function mutateShared(value: any) { value.build = () => 'changed' }\n"),
      writeFile(join(root, 'mutator.ts'), 'export {}\n'),
    ])
    for (const [name, declaration] of [
      ['canonical', 'export declare function marker(value: string): unknown\n'],
      ['reexport', "export * from '@fixture/canonical'\nexport { marker as Alias } from '@fixture/canonical'\n"],
      ['fabricated', "export declare const facade: typeof import('@fixture/canonical')\n"],
    ]) {
      const directory = join(root, 'node_modules/@fixture', name!)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, types: 'index.d.ts' }))
      await writeFile(join(directory, 'index.d.ts'), declaration!)
    }
    project = await openTypeScriptProject({ root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    await project.refresh()
    snapshot = await project.open()
    const localSources = (await snapshot.facts.facts('source')).facts.filter((fact) => fact.payload.logicalPath === 'index.ts')
    expect(localSources).toHaveLength(1)
    const localSource = localSources[0]!.payload.source
    const markerDeclaration = source.indexOf('declare function marker(')
    const markers: SymbolId[] = []
    for await (const fact of snapshot.facts.export('symbol')) {
      if (fact.payload.name === 'marker' && fact.payload.declarations.some((span) => span.source === localSource && span.start <= markerDeclaration && span.end > markerDeclaration)) markers.push(fact.payload.symbol)
    }
    expect(markers).toHaveLength(1)
    const marker = markers[0]!
    model = (context) => {
      if (context.call.target !== marker) return
      const value = context.argument(0)
      return value?.kind === 'known' && value.value.kind === 'literal' && typeof value.value.value === 'string'
        ? { kind: 'atom', value: value.value.value }
        : { kind: 'unknown', reason: 'Marker argument is not a known string.' }
    }
    for await (const fact of snapshot.facts.export('body')) {
      for (const occurrence of fact.payload.body.occurrences) {
        if (occurrence.syntax !== 'VariableDeclaration') continue
        const text = source.slice(occurrence.span.start, occurrence.span.end)
        const name = /^([A-Za-z]+)\s*=/.exec(text)?.[1]
        if (name) declarations.set(name, occurrence.id)
      }
    }
  })

  afterAll(async () => { await project?.dispose(); if (root) await rm(root, { recursive: true, force: true }) })

  it('retains closure arguments, lazy properties and helper-returned functions', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const definition = values.value(declaration('definition')).invoke()
    const request = await definition.property('build').invoke().resolve()
    expect(request).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'closed' } })
    expect(request.evidence.length).toBeGreaterThan(1)
    expect(await definition.property('project').resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', execution: 'sync', parameterCount: 0 } })
    expect(await definition.property('project').invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'view' } })
    expect(await definition.property('absent').resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: undefined } })
    expect(await values.evaluate(declaration('nestedIdentity'))).toMatchObject({ kind: 'known', value: 'nested' })
  })

  it('resolves real module namespace members through aliases without trusting a compatible object type', async () => {
    const values = await snapshot.values()
    for (const name of ['namespaceMember', 'aliasedNamespaceMember']) {
      expect(await values.value(declaration(name)).resolve()).toMatchObject({ kind: 'known', value: {
        kind: 'external', symbolOrigin: { package: '@fixture/canonical', file: 'index.d.ts', path: ['marker'] },
      } })
    }
    for (const name of ['fabricatedNamespaceMember', 'fabricatedExternalMember', 'typeOnlyNamespaceMember', 'namespaceCastMember']) {
      const result = await values.value(declaration(name)).resolve()
      expect(result.kind !== 'known' || result.value.kind !== 'external').toBe(true)
    }
    const modeled = await snapshot.values({ call: (context) => {
      const callee = context.callee()
      if (callee.kind === 'known' && callee.value.kind === 'external' && callee.value.symbolOrigin?.package === '@fixture/canonical') {
        return { kind: 'atom', value: 'actual-module-export' }
      }
    } })
    expect(await values.value(declaration('fabricatedNestedMember')).invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'fabricated' } })
    expect(await values.value(declaration('fabricatedNamespaceMember')).invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'local' } })
    expect(await modeled.value(declaration('namespaceMemberCall')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'actual-module-export' } })
    for (const name of ['fabricatedNamespaceCall', 'fabricatedExternalCall', 'namespaceCastCall']) {
      const result = await modeled.value(declaration(name)).resolve()
      expect(result.kind !== 'known' || result.value.kind !== 'atom').toBe(true)
    }
  })

  it('keeps object spread overwrite order conservative', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('laterExplicit')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'explicit' } })
    expect(await values.value(declaration('laterOpaque')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'unknown' })
  })

  it.each(['restDefinition', 'spreadDefinition', 'asyncDefinition', 'generatorDefinition'])('does not manufacture synchronous scalar transfers for %s', async (name) => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration(name)).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it('keeps execution metadata while refusing Promise and Iterator scalar results', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('asyncDefinition')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', execution: 'async' } })
    for (const name of ['asyncCall', 'generatorCall']) {
      expect(await values.evaluate(declaration(name))).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_EXECUTION_UNSUPPORTED' })] })
    }
  })

  it('keeps alternative, step and cancellation boundaries independent between proofs', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const plan = values.value(declaration('branch')).invoke()
    expect(await plan.resolve()).toMatchObject({ kind: 'ambiguous', values: expect.arrayContaining([{ kind: 'atom', value: 'left' }, { kind: 'atom', value: 'right' }]) })
    expect(await plan.resolve({ limits: { maximumAlternatives: 1 } })).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_ALTERNATIVE_LIMIT' })] })
    expect(await plan.resolve({ limits: { maximumSteps: 1 } })).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })] })
    await expect(plan.resolve({ signal: AbortSignal.abort(new Error('superseded')) })).rejects.toThrow('superseded')
    expect(await plan.resolve()).toMatchObject({ kind: 'ambiguous' })
  })

  it('preserves observed candidates without turning an incomplete branch into known evidence', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const result = await values.value(declaration('uncertainBranch')).invoke().resolve()
    expect(result).toMatchObject({ kind: 'unknown', candidates: [{ kind: 'atom', value: 'possible' }] })
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(values.canReuse(result)).toBe(true)
    expect(await values.value(declaration('mutableFactory')).resolve()).toMatchObject({ kind: 'unknown', candidates: [{ kind: 'atom', value: 'observed-factory' }] })
  })

  it('shares one immutable index across models without mixing hooks or budgets', async () => {
    const reader = await project.open()
    const reads = vi.spyOn(reader.query, 'export')
    const first = await reader.values({ call: model })
    const otherModel: SymbolicCallModel<string> = () => ({ kind: 'atom', value: 'different' })
    const second = await reader.values({ call: otherModel })
    expect(await reader.values({ call: model })).toBe(first)
    expect(second).not.toBe(first)
    const proof = await first.value(declaration('direct')).resolve()
    expect(await second.value(declaration('direct')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'different' } })
    expect(first.canReuse(proof)).toBe(true)
    expect(second.canReuse(proof)).toBe(false)
    expect((await reader.values({ call: model, limits: { maximumSteps: 1 } })).canReuse(proof)).toBe(false)
    expect(reads.mock.calls).toHaveLength(2)
    reads.mockRestore()
    await reader.dispose()
  })

  it('automatically reuses equivalent plans across disposed readers without mixing budgets or models', async () => {
    const counted = vi.fn(model)
    const reader = await project.open()
    const values = await reader.values({ call: counted })
    const first = await values.value(declaration('direct')).resolve()
    const evaluated = counted.mock.calls.length
    expect(await values.value(declaration('direct')).resolve()).toBe(first)
    expect(counted).toHaveBeenCalledTimes(evaluated)
    await reader.dispose()
    const nextReader = await project.open()
    const next = await nextReader.values({ call: counted })
    expect(await next.value(declaration('direct')).resolve()).toBe(first)
    expect(counted).toHaveBeenCalledTimes(evaluated)
    const bounded = await next.value(declaration('direct')).resolve({ limits: { maximumSteps: 1 } })
    expect(bounded.kind).toBe('unknown')
    expect(await next.value(declaration('direct')).resolve({ limits: { maximumSteps: 1 } })).toBe(bounded)
    expect(await next.value(declaration('direct')).resolve()).toBe(first)
    const other = await nextReader.values({ call: () => ({ kind: 'atom', value: 'other-model' }) })
    expect(await other.value(declaration('direct')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'other-model' } })
    const scalar = await next.evaluate(declaration('direct'))
    expect(scalar.kind).toBe('unknown')
    expect(scalar).not.toBe(first)
    await expect(next.value(declaration('direct')).resolve({ signal: AbortSignal.abort(new Error('cancel cached request')) })).rejects.toThrow('cancel cached request')
    await nextReader.dispose()
  })

  it('freezes owned receipt containers and preserves immutable opaque atom identity', async () => {
    const atom = Object.freeze({ identity: Object.freeze({ name: 'opaque' }) })
    const hook = vi.fn(() => ({ kind: 'atom' as const, value: atom }))
    const values = await snapshot.values({ call: hook })
    const result = await values.value(declaration('direct')).resolve()
    expect(result).toMatchObject({ kind: 'known', value: { kind: 'atom', value: atom } })
    if (result.kind !== 'known' || result.value.kind !== 'atom') throw new Error('Expected modeled atom.')
    expect(result.value.value).toBe(atom)
    expect(Reflect.set(result.value, 'kind', 'literal')).toBe(false)
    expect(() => (result.evidence as unknown[]).push('poison')).toThrow()
    expect(await values.value(declaration('direct')).resolve()).toBe(result)
    expect(hook).toHaveBeenCalledTimes(1)
    const object = await (await snapshot.values()).value(declaration('definition')).invoke().resolve()
    if (object.kind !== 'known' || object.value.kind !== 'object') throw new Error('Expected object shape.')
    expect(() => (object.value.properties as string[]).push('poison')).toThrow()
  })

  it('bypasses mutable opaque atoms without freezing or cloning caller state', async () => {
    const atom = { label: 'original' }
    const hook = vi.fn(() => ({ kind: 'atom' as const, value: atom }))
    const values = await snapshot.values({ call: hook })
    const first = await values.value(declaration('direct')).resolve()
    const second = await values.value(declaration('direct')).resolve()
    expect(hook).toHaveBeenCalledTimes(2)
    expect(first).not.toBe(second)
    expect(Object.isFrozen(atom)).toBe(false)
    if (first.kind !== 'known' || first.value.kind !== 'atom') throw new Error('Expected modeled atom.')
    expect(first.value.value).toBe(atom)
  })

  it('distinguishes opaque instances with equal fields and collapses only shared atom identities', async () => {
    const left = Object.freeze({ identity: 'same-fields' })
    const right = Object.freeze({ identity: 'same-fields' })
    const values = await snapshot.values({ call: (context) => {
      const label = context.argument(0)
      return { kind: 'atom', value: label?.kind === 'known' && label.value.kind === 'literal' && label.value.value === 'left' ? left : right }
    } })
    const distinct = await values.value(declaration('branch')).invoke().resolve()
    expect(distinct.kind).toBe('ambiguous')
    if (distinct.kind !== 'ambiguous') throw new Error('Distinct model instances must remain ambiguous.')
    expect(distinct.values).toHaveLength(2)
    expect(distinct.values[0]).toMatchObject({ kind: 'atom', value: left })
    expect(distinct.values[1]).toMatchObject({ kind: 'atom', value: right })
    if (distinct.values[0]?.kind !== 'atom' || distinct.values[1]?.kind !== 'atom') throw new Error('Expected atom alternatives.')
    expect(distinct.values[0].value).toBe(left)
    expect(distinct.values[1].value).toBe(right)
    const shared = await snapshot.values({ call: () => ({ kind: 'atom', value: left }) })
    expect(await shared.value(declaration('branch')).invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'atom', value: left } })
  })

  it('does not publish thrown or cancelled resolutions into the project cache', async () => {
    let attempts = 0
    const cancellation = new AbortController()
    const hook = () => {
      if (++attempts === 1) throw new Error('transient model failure')
      if (attempts === 2) cancellation.abort(new Error('cancel during model'))
      return { kind: 'atom' as const, value: 'recovered' }
    }
    const values = await snapshot.values({ call: hook })
    await expect(values.value(declaration('direct')).resolve()).rejects.toThrow('transient model failure')
    await expect(values.value(declaration('direct')).resolve({ signal: cancellation.signal })).rejects.toThrow('cancel during model')
    const recovered = await values.value(declaration('direct')).resolve()
    expect(recovered.kind).toBe('known')
    expect(attempts).toBe(3)
    expect(await values.value(declaration('direct')).resolve()).toBe(recovered)
    expect(attempts).toBe(3)
  })

  it('does not let a custom model overwrite exhausted operand budgets', async () => {
    const values = await snapshot.values({ limits: { maximumSteps: 2 }, call: (context) => {
      context.argument(0)
      return { kind: 'atom', value: 'cannot erase a hard limit' }
    } })
    expect(await values.value(declaration('direct')).resolve()).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })] })
  })

  it('charges transitive effects to the demanded proof budget on a shared branching call graph', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const plan = values.value(declaration('boundedEffect')).invoke().property('build').invoke()
    expect(await plan.resolve({ limits: { maximumSteps: 16 } })).toMatchObject({
      kind: 'unknown', reasons: expect.arrayContaining([expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })]),
    })
    expect(await plan.resolve()).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_MUTATION_UNSUPPORTED' })] })
    expect(await values.value(declaration('direct')).resolve({ limits: { maximumSteps: 8 } })).toMatchObject({ kind: 'known', value: { kind: 'atom', value: 'direct' } })
  })

  it('does not mistake a compound assignment operand for the assigned value', async () => {
    const values = await snapshot.values({ call: model })
    expect(await values.value(declaration('compound')).invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it('preserves an exact dominating simple assignment without trusting interprocedural writes', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration('reassigned')).invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'new' } })
    expect(await values.evaluate(declaration('reassignedCall'))).toMatchObject({ kind: 'known', value: 'new' })
    expect(await values.value(declaration('interproceduralWrite')).invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it.each(['mutatedObject', 'mutatedAlias'])('does not claim the initializer is still effective for %s', async (name) => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration(name)).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it.each(['localEffect', 'forwardedEffect', 'externalEffect', 'capturedWrite'])('does not preserve stale object or closure state through %s', async (name) => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    expect(await values.value(declaration(name)).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'unknown' })
  })

  it('invalidates a previously absent write in an independent module and recovers after removal', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const before = await values.value(declaration('crossMutation')).invoke().property('build').invoke().resolve()
    expect(before).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'stable' } })
    await writeFile(join(root, 'mutator.ts'), "import { shared, mutateShared } from './helper'; mutateShared(shared)\n")
    await project.refresh({ changed: ['mutator.ts'] })
    const mutated = await project.open()
    const next = await mutated.values({ call: model, limits: { maximumDepth: 64 } })
    expect(next.canReuse(before)).toBe(false)
    const proof = await next.value(declaration('crossMutation')).invoke().property('build').invoke().resolve()
    expect(proof).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_MUTATION_UNSUPPORTED' })] })
    let mutationSource: string | undefined
    for await (const fact of mutated.facts.export('source')) if (fact.payload.logicalPath === 'mutator.ts') mutationSource = fact.payload.source
    const linkingFacts: string[] = []
    for await (const fact of mutated.facts.export('body')) if (fact.provenance.evidence.some((span) => span.source === mutationSource)) linkingFacts.push(fact.id)
    expect(proof.evidence.some((id) => linkingFacts.includes(id)), 'The proof must include the call that forwards the object to the mutating helper.').toBe(true)
    await writeFile(join(root, 'mutator.ts'), 'export {}\n')
    await project.refresh({ changed: ['mutator.ts'] })
    const repaired = await project.open()
    const recovered = await repaired.values({ call: model, limits: { maximumDepth: 64 } })
    expect(recovered.canReuse(proof)).toBe(false)
    expect(recovered.canReuse(before)).toBe(true)
    expect(await recovered.value(declaration('crossMutation')).invoke().property('build').invoke().resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'stable' } })
    await mutated.dispose()
    await repaired.dispose()
  })

  it('invalidates semantic payload changes and newly available bodies while reusing unrelated evidence', async () => {
    const values = await snapshot.values({ call: model, limits: { maximumDepth: 64 } })
    const plan = values.value(declaration('dependent')).invoke().property('build').invoke()
    const before = await plan.resolve()
    const unrelated = await values.value(declaration('direct')).resolve()
    expect(before).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'old' } })
    await writeFile(join(root, 'helper.ts'), "export declare function helper(): string\n")
    await project.refresh({ changed: ['helper.ts'] })
    const missing = await project.open()
    const next = await missing.values({ call: model, limits: { maximumDepth: 64 } })
    expect(next.canReuse(before)).toBe(false)
    expect(next.canReuse(unrelated)).toBe(true)
    expect(await next.value(declaration('direct')).resolve()).toBe(unrelated)
    const absent = await next.value(declaration('dependent')).invoke().property('build').invoke().resolve()
    expect(absent.kind).not.toBe('known')
    await writeFile(join(root, 'helper.ts'), "export function helper() { return 'new' }\n")
    await project.refresh({ changed: ['helper.ts'] })
    const restored = await project.open()
    const final = await restored.values({ call: model, limits: { maximumDepth: 64 } })
    expect(final.canReuse(absent)).toBe(false)
    expect(await final.value(declaration('dependent')).invoke().property('build').invoke().resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'new' } })
    expect(await plan.resolve()).toEqual(before)
    await missing.dispose()
    await restored.dispose()
  })

  function declaration(name: string): OccurrenceId {
    const id = declarations.get(name)
    if (!id) throw new Error(`Missing variable ${name}.`)
    return id
  }
})
