import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { BodyOccurrence, ResolvedCall, TypeScriptFact } from '../analysis/typescript/index.ts'
import type { OccurrenceId, SymbolId } from '../analysis/identity/index.ts'
import { createCallProjection } from '../analysis/typescript/value/symbolic/calls.ts'

describe('typed snapshot call inventory', () => {
  let root: string
  let project: TypeScriptProject
  let snapshot: TypeScriptProjectSnapshot

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'codegraph-calls-'))
    await Promise.all([
      writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, noEmit: true }, include: ['*.ts'] })),
      writeFile(join(root, 'flow.ts'), "declare const condition: boolean; declare function external(value: string): unknown; declare const dynamic: any; export const result = condition ? external('left') : external('right'); dynamic();\n"),
      writeFile(join(root, 'nested.ts'), "declare function external(): unknown; export class Example { field = external() }\n"),
      writeFile(join(root, 'empty.ts'), 'export {}\n'),
    ])
    project = await openTypeScriptProject({ root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    await project.refresh()
    snapshot = await project.open()
  })

  afterAll(async () => { await project?.dispose(); await rm(root, { recursive: true, force: true }) })

  it('shares the value index and retains unresolved calls with their source and callee', async () => {
    const reads = vi.spyOn(snapshot.query, 'export')
    const inventory = await snapshot.calls({ paths: ['flow.ts'] })
    expect(inventory.completeness).toEqual({ kind: 'complete' })
    expect(inventory.sites).toHaveLength(3)
    expect(inventory.sites.every((site) => site.path === 'flow.ts' && site.callee && site.occurrence.id === site.call.occurrence)).toBe(true)
    expect(inventory.sites.filter((site) => site.call.arguments.length === 0)).toHaveLength(1)
    const values = await snapshot.values()
    await values.value(inventory.sites[0]!.callee!).resolve()
    expect(reads.mock.calls).toHaveLength(3)
    expect(Object.isFrozen(inventory)).toBe(true)
    expect(Object.isFrozen(inventory.sites)).toBe(true)
    expect(Object.isFrozen(inventory.sites[0])).toBe(true)
    const again = await snapshot.calls({ paths: ['flow.ts'] })
    expect(again.sites[0]).toBe(inventory.sites[0])
    expect(reads.mock.calls).toHaveLength(3)
    reads.mockRestore()
  })

  it('intersects source and path filters and distinguishes omitted execution scopes from flow limits', async () => {
    const flow = (await snapshot.calls({ paths: ['flow.ts'] })).sites[0]!.occurrence.span.source
    expect((await snapshot.calls({ sources: [flow] })).sites).toHaveLength(3)
    expect(await snapshot.calls({ sources: [flow], paths: ['nested.ts'] })).toEqual({ sites: [], completeness: { kind: 'complete' } })
    expect(await snapshot.calls({ paths: ['empty.ts'] })).toEqual({ sites: [], completeness: { kind: 'complete' } })
    expect((await snapshot.calls({ paths: ['nested.ts'] })).completeness).toMatchObject({
      kind: 'partial', reasons: [expect.objectContaining({ code: 'CFG_NESTED_SCOPE_UNSUPPORTED' })],
    })
    expect((await snapshot.calls()).completeness.kind).toBe('partial')
  })

  it('keeps old inventories pinned through call additions and source deletion', async () => {
    const before = await snapshot.calls({ paths: ['flow.ts'] })
    await writeFile(join(root, 'added.ts'), 'declare const callback: any; callback();\n')
    await project.refresh({ changed: ['added.ts'] })
    const added = await project.open()
    expect((await added.calls({ paths: ['added.ts'] })).sites).toHaveLength(1)
    expect(await snapshot.calls({ paths: ['flow.ts'] })).toEqual(before)
    expect((await snapshot.calls({ paths: ['added.ts'] })).sites).toHaveLength(0)
    await rm(join(root, 'added.ts'))
    await project.refresh({ changes: [{ path: 'added.ts', kind: 'unlink' }] })
    const removed = await project.open()
    expect((await removed.calls({ paths: ['added.ts'] })).sites).toHaveLength(0)
    expect((await added.calls({ paths: ['added.ts'] })).sites).toHaveLength(1)
    await added.dispose()
    await removed.dispose()
  })

  it('does not turn missing body capability or cancellation into complete absence', async () => {
    const sourcesOnly = await openTypeScriptProject({ root, capabilities: ['typescript.source'], ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    try {
      await sourcesOnly.refresh()
      const reader = await sourcesOnly.open()
      expect(await reader.calls()).toMatchObject({ sites: [], completeness: { kind: 'unavailable' } })
      await expect(reader.calls({ signal: AbortSignal.abort(new Error('superseded')) })).rejects.toThrow('superseded')
      expect((await reader.calls()).completeness.kind).toBe('unavailable')
      await reader.dispose()
      await expect(reader.calls()).rejects.toThrow('disposed')
    } finally { await sourcesOnly.dispose() }
  })

  it('retains unattributed extraction limits even when no body facts were emitted', async () => {
    const query = Object.assign(Object.create(snapshot.query), {
      export: snapshot.query.export.bind(snapshot.query),
      capabilities: async () => [
        { capability: 'typescript.source', completeness: { kind: 'complete' } },
        { capability: 'typescript.body', completeness: { kind: 'partial', reasons: [{
          code: 'CFG_NESTED_SCOPE_UNSUPPORTED', message: 'An omitted scope has no body fact.', effective: {},
        }] } },
      ],
    })
    const calls = createCallProjection(query, async () => ({ bodies: new Map(), occurrences: new Map(), children: new Map(), calls: new Map() }))
    expect(await calls()).toMatchObject({ sites: [], completeness: { kind: 'partial' } })
  })

  it('attributes exact body reasons without dropping a different global warning with the same code', async () => {
    const bodies = (await snapshot.facts.facts('body')).facts
    const nested = bodies.find((fact) => fact.completeness.kind === 'partial' && fact.completeness.reasons.some(({ code }) => code === 'CFG_NESTED_SCOPE_UNSUPPORTED'))!
    expect(nested).toBeDefined()
    if (nested.completeness.kind !== 'partial') throw new Error('Expected the real nested-scope fixture.')
    const attributed = nested.completeness.reasons
    const extra = { code: 'CFG_NESTED_SCOPE_UNSUPPORTED', message: 'Another omitted scope has no body attribution.', effective: { omitted: 1 } }
    const query = Object.assign(Object.create(snapshot.query), {
      export: snapshot.query.export.bind(snapshot.query),
      capabilities: async () => [
        { capability: 'typescript.source', completeness: { kind: 'complete' } },
        { capability: 'typescript.body', completeness: { kind: 'partial', reasons: [...attributed, extra] } },
      ],
    })
    const calls = createCallProjection(query, async () => ({ bodies: new Map([[nested.payload.body.function, nested]]), occurrences: new Map(), children: new Map(), calls: new Map() }))
    expect(await calls({ paths: ['empty.ts'] })).toEqual({ sites: [], completeness: { kind: 'partial', reasons: [extra] } })
    const own = await calls({ paths: ['nested.ts'] })
    expect(own.completeness.kind).toBe('partial')
    if (own.completeness.kind === 'partial') expect(own.completeness.reasons).toHaveLength(2)
  })

  it('does not claim a path-filtered inventory is complete when source membership is unknown', async () => {
    const source = (await snapshot.calls({ paths: ['flow.ts'] })).sites[0]!.occurrence.span.source
    const index = {
      bodies: new Map<SymbolId, TypeScriptFact<'body'>>(),
      occurrences: new Map<OccurrenceId, BodyOccurrence>(),
      children: new Map<OccurrenceId, Map<string, OccurrenceId>>(),
      calls: new Map<OccurrenceId, ResolvedCall>(),
    }
    for await (const fact of snapshot.facts.export('body', { sources: [source] })) {
      const body = fact.payload.body
      index.bodies.set(body.function, fact)
      for (const occurrence of body.occurrences) index.occurrences.set(occurrence.id, occurrence)
      for (const call of body.calls) index.calls.set(call.occurrence, call)
      for (const relation of body.relations) {
        let children = index.children.get(relation.parent)
        if (!children) index.children.set(relation.parent, (children = new Map()))
        children.set(relation.role, relation.child)
      }
    }
    const query = Object.assign(Object.create(snapshot.query), {
      export: async function* () {},
      capabilities: async () => ['typescript.source', 'typescript.body'].map((capability) => ({ capability, completeness: { kind: 'complete' } })),
    })
    const calls = createCallProjection(query, async () => index)
    const unfiltered = await calls()
    expect(unfiltered.sites).toHaveLength(3)
    expect(unfiltered.completeness.kind).toBe('partial')
    expect(await calls({ paths: ['flow.ts'] })).toMatchObject({ sites: [], completeness: {
      kind: 'partial', reasons: [expect.objectContaining({ code: 'CALL_SOURCE_SELECTION_UNKNOWN' })],
    } })
    expect(await calls({ paths: ['flow.ts'], sources: [] })).toEqual({ sites: [], completeness: { kind: 'complete' } })
    expect(await calls({ paths: [] })).toEqual({ sites: [], completeness: { kind: 'complete' } })
  })
})
