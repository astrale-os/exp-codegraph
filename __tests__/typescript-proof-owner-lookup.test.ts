import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { deriveAnalysisId, type OccurrenceId, type SymbolId } from '../analysis/identity/index.ts'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { BodyOccurrence } from '../analysis/typescript/body/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { projectPackedTypeScriptBody } from '../analysis/typescript/physical/index.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { IndexedValues, type IndexedFact, type ValueDependency, type ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'

type Body = TypeScriptFact<'body'>
let root: string
let project: TypeScriptProject
let snapshot: TypeScriptProjectSnapshot
let facts: IndexedFact[]
let packedBody: Body
let semanticBody: Body
let object: BodyOccurrence
let otherOwner: SymbolId

// Native resolution can include a cold compiler build; assertions keep their default budget.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'codegraph-proof-owner-'))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
  await writeFile(join(root, 'main.ts'), [
    "export const object = { foo: 'present' }",
    'export function helper(value: unknown) { return value }',
    ...Array.from({ length: 32 }, (_, index) => `export const unrelated${index} = ${index}`),
  ].join('\n'))
  project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
  })
  await project.refresh()
  snapshot = await project.open()
  facts = []
  for await (const fact of snapshot.facts.export('body')) facts.push(fact)
  for await (const fact of snapshot.facts.export('symbol')) facts.push(fact)
  for await (const fact of snapshot.facts.export('source')) facts.push(fact)
  const bodies = facts.filter((fact): fact is Body => fact.namespace === 'typescript.body')
  packedBody = bodies.find((fact) => fact.payload.body.scope === 'module')!
  semanticBody = { ...packedBody, payload: packedBody.payload }
  expect(projectPackedTypeScriptBody(packedBody)).toBeDefined()
  expect(projectPackedTypeScriptBody(semanticBody)).toBeUndefined()
  object = semanticBody.payload.body.occurrences.find((node) => node.syntax === 'ObjectLiteralExpression')!
  otherOwner = bodies.find((fact) => fact !== packedBody)!.payload.body.function
}, 120_000)

afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await snapshot?.dispose()
  await project?.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

// The pre-optimization rule depends on the projected node's owner and exact
// fingerprints, including combined fingerprints for overlapping contributors.
function previousDependency(index: ValueIndex, key: string): ValueDependency {
  let canonical = key
  if (key.startsWith('occurrence:')) {
    const occurrence = index.occurrences.get(key.slice(11) as OccurrenceId)
    const candidate = occurrence && `function:${occurrence.owner}`
    if (candidate && index.fingerprints.get(candidate) === index.fingerprints.get(key)) canonical = candidate
  }
  return { key: canonical, fingerprint: index.fingerprints.get(canonical) }
}

function previousIndex(index: ValueIndex): ValueIndex {
  return { ...index, dependency: (key) => previousDependency(index, key) }
}

async function evaluator(index: ValueIndex) {
  return createValueEvaluatorFactory(snapshot.query, undefined, async () => index)()
}

function withBodies(...bodies: Body[]): IndexedValues {
  return IndexedValues.empty().update([...facts.filter((fact) => fact.id !== packedBody.id), ...bodies], [], true)
}

function withoutProperties(fact: Body): Body {
  return { ...fact, payload: { ...fact.payload, body: { ...fact.payload.body,
    relations: fact.payload.body.relations.filter((relation) => relation.parent !== object.id),
  } } }
}

async function propertyProof(index: ValueIndex) {
  return (await evaluator(index)).value(object.id).property('foo').resolve()
}

describe('proof witnesses from exact column owners', () => {
  it('canonicalizes native packed occurrences without decoding rows or comparing column fingerprints', async () => {
    const index = IndexedValues.empty().update(facts, [], true)
    const projection = projectPackedTypeScriptBody(packedBody)!
    const decoded = vi.spyOn(Object.getPrototypeOf(projection) as typeof projection, 'occurrence')
    const fingerprints = vi.spyOn(Object.getPrototypeOf(index.bodies), 'fingerprint')
    const witness = index.dependency(`function:${projection.owner}`)
    expect(projection.occurrences.length).toBeGreaterThan(100)
    for (const id of projection.occurrences) {
      expect(index.dependency(`occurrence:${id}`)).toBe(witness)
    }
    expect(decoded).not.toHaveBeenCalled()
    expect(fingerprints).not.toHaveBeenCalled()

    const actual = await propertyProof(index)
    expect(actual).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(actual.evidence).toContain(packedBody.id)
    expect(decoded).toHaveBeenCalled()
    expect(actual).toEqual(await propertyProof(previousIndex(index)))
    for (const id of projection.occurrences) {
      expect(index.dependency(`occurrence:${id}`)).toEqual(previousDependency(index, `occurrence:${id}`))
    }
  })

  it.each(['different', 'absent', 'undefined'] as const)('preserves custom owner behavior (%s) and reads its getter once', async (kind) => {
    // Exercise the existing internal-update fallback, without changing which
    // semantic bodies the public fact reader admits.
    const owner = kind === 'undefined' ? undefined : kind === 'different' ? otherOwner : deriveAnalysisId('symbol', 'missing-proof-owner', {})
    let reads = 0
    class CustomOccurrence {
      get owner() { reads++; return owner }
    }
    const { owner: _originalOwner, ...fields } = object
    const custom = Object.assign(new CustomOccurrence(), fields) as BodyOccurrence
    const body: Body = { ...semanticBody, payload: { ...semanticBody.payload, body: { ...semanticBody.payload.body,
      occurrences: semanticBody.payload.body.occurrences.map((node) => node.id === object.id ? custom : node),
    } } }
    const index = withBodies(body)
    const key = `occurrence:${object.id}`
    reads = 0
    const expected = previousDependency(index, key)
    expect(reads).toBe(1)
    reads = 0
    expect(index.dependency(key)).toEqual(expected)
    expect(reads).toBe(1)
    expect(expected.key).toBe(key)
    expect(expected.fingerprint).toBeDefined()

    const before = await evaluator(index)
    const proof = await before.value(object.id).property('foo').resolve()
    expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(proof).toEqual(await propertyProof(previousIndex(index)))
    const changed = index.update([withoutProperties(body)], [])
    const after = await evaluator(changed)
    expect(after.canReuse(proof)).toBe(false)
    expect(await after.value(object.id).property('foo').resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: undefined } })
    expect(await before.value(object.id).property('foo').resolve()).toEqual(proof)
  })

  it.each(['partial', 'complete'] as const)('keeps all and only contributors when owner overlap is %s', async (overlap) => {
    const ids = [deriveAnalysisId('fact', 'proof-owner-overlap', 'first'),
      deriveAnalysisId('fact', 'proof-owner-overlap', 'second')].sort()
    const empty = withoutProperties(semanticBody)
    const first = { ...empty, id: ids[0]! }
    const second = { ...empty, id: ids[1]!, payload: overlap === 'complete' ? empty.payload : {
      ...empty.payload, body: { ...empty.payload.body,
        occurrences: empty.payload.body.occurrences.filter((node) => node.id !== object.id),
        relations: empty.payload.body.relations.filter((relation) => relation.child !== object.id),
        blocks: empty.payload.body.blocks.map((block) => ({ ...block,
          occurrences: block.occurrences.filter((id) => id !== object.id),
        })),
      },
    } }
    const index = withBodies(first, second)
    const key = `occurrence:${object.id}`
    expect(index.dependency(key)).toEqual(previousDependency(index, key))
    expect(index.dependency(key).key).toBe(overlap === 'complete' ? `function:${empty.payload.body.function}` : key)
    const before = await evaluator(index)
    const proof = await before.value(object.id).property('foo').resolve()
    expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: undefined } })
    expect(proof).toEqual(await propertyProof(previousIndex(index)))
    expect(proof.evidence).toContain(first.id)
    if (overlap === 'complete') expect(proof.evidence).toContain(second.id)
    else expect(proof.evidence).not.toContain(second.id)

    const changedSecond = { ...second, payload: { ...second.payload, values: {} } }
    const unselectedChanged = index.update([changedSecond], [])
    expect((await evaluator(unselectedChanged)).canReuse(proof)).toBe(overlap === 'partial')
    expect(unselectedChanged.dependency(key)).toEqual(previousDependency(unselectedChanged, key))
    const restoredProperties = { ...first, payload: semanticBody.payload }
    const changed = unselectedChanged.update([restoredProperties], [])
    const after = await evaluator(changed)
    expect(after.canReuse(proof)).toBe(false)
    expect(await after.value(object.id).property('foo').resolve())
      .toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(await propertyProof(changed)).toEqual(await propertyProof(previousIndex(changed)))
    expect(await before.value(object.id).property('foo').resolve()).toEqual(proof)
  })

  it('invalidates a proof when the same semantic payload is supplied by a new fact identity', async () => {
    const index = withBodies(semanticBody)
    const before = await evaluator(index)
    const proof = await before.value(object.id).property('foo').resolve()
    const replacement = { ...semanticBody, id: deriveAnalysisId('fact', 'proof-owner-replacement', semanticBody.id) }
    expect(replacement.payload).toBe(semanticBody.payload)
    const changed = index.update([replacement], [semanticBody.id])
    const after = await evaluator(changed)
    const key = `occurrence:${object.id}`
    expect(changed.dependency(key)).toEqual(previousDependency(changed, key))
    expect(changed.dependency(key).fingerprint).not.toBe(index.dependency(key).fingerprint)
    expect(after.canReuse(proof)).toBe(false)
    const updated = await after.value(object.id).property('foo').resolve()
    expect(updated).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(updated.evidence).toContain(replacement.id)
    expect(updated.evidence).not.toContain(semanticBody.id)
    expect(updated).toEqual(await propertyProof(previousIndex(changed)))
    expect(await before.value(object.id).property('foo').resolve()).toEqual(proof)
  })

  it('preserves absent witnesses, deletion/reinsertion and proofs on pinned revisions', async () => {
    const index = withBodies(semanticBody)
    const before = await evaluator(index)
    const proof = await before.value(object.id).property('foo').resolve()
    const key = `occurrence:${object.id}`
    const originalWitness = index.dependency(key)
    const removed = index.update([], [semanticBody.id])
    expect(removed.dependency(key)).toEqual({ key, fingerprint: undefined })
    expect(removed.dependency(key)).toEqual(previousDependency(removed, key))
    const absent = await evaluator(removed)
    expect(absent.canReuse(proof)).toBe(false)
    const negative = await absent.value(object.id).resolve()
    expect(negative.kind).toBe('unknown')

    const restored = removed.update([semanticBody], [])
    const after = await evaluator(restored)
    expect(restored.dependency(key)).toEqual(originalWitness)
    expect(after.canReuse(negative)).toBe(false)
    expect(after.canReuse(proof)).toBe(true)
    expect(await after.value(object.id).property('foo').resolve()).toEqual(proof)
    expect(await propertyProof(restored)).toEqual(await propertyProof(previousIndex(restored)))
    expect(removed.dependency(key)).toEqual({ key, fingerprint: undefined })
    expect(await absent.value(object.id).resolve()).toEqual(negative)
    expect(index.dependency(key)).toBe(originalWitness)
    expect(before.canReuse(proof)).toBe(true)
    expect(await before.value(object.id).property('foo').resolve()).toEqual(proof)
  })
})
