import { describe, expect, it } from 'vitest'
import { validateTypeScriptFactPayload } from '../analysis/typescript/facts/validate.ts'
import { captureBodyDemand } from '../analysis/protocol/body-demand.ts'

function certificate() {
  const span = { source: 'source', revision: 'revision', start: 0, end: 100 }
  return {
    paths: ['queries/request.ts'],
    owners: [
      { owner: 'selected', scope: 'module', span, path: 'queries/request.ts', materialized: true },
      { owner: 'sibling', scope: 'function', span, path: 'other.ts', materialized: false },
    ],
    witnesses: [{ id: 'write', owner: 'sibling', kind: 'assignment', syntax: 'BinaryExpression',
      span: { ...span, start: 10, end: 20 } }],
    initializers: [],
    mutations: [{ symbol: 'value', occurrence: 'write', owner: 'sibling' }],
    escapes: [],
    aliases: [],
    coverage: [{ path: 'queries/request.ts', completeness: { kind: 'complete' } }],
    completeness: { kind: 'complete' },
  }
}

describe('demand body authority admission', () => {
  it('owns, canonicalizes and freezes request paths before queued native work', () => {
    const paths = ['queries/z.ts', 'queries/a.ts', 'queries/z.ts']
    const captured = captureBodyDemand({ paths })
    paths[0] = 'queries/changed.ts'
    expect(captured.paths).toEqual(['queries/a.ts', 'queries/z.ts'])
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.paths)).toBe(true)
    expect(() => captureBodyDemand({ paths: ['../outside.ts'] })).toThrow('canonical owned logical')
  })
  it('admits complete global effects with omitted sibling bodies and scoped coverage', () => {
    expect(validateTypeScriptFactPayload('body-demand', certificate())).toEqual([])
  })

  it.each([
    ['absent witness', (value: ReturnType<typeof certificate>) => { value.witnesses = [] }, 'mutations:witness-absent'],
    ['different effect owner', (value: ReturnType<typeof certificate>) => { value.mutations[0]!.owner = 'selected' }, 'mutations:owner-mismatch'],
    ['absent witness owner', (value: ReturnType<typeof certificate>) => { value.witnesses[0]!.owner = 'missing' }, 'witnesses:owner-absent'],
    ['stale witness revision', (value: ReturnType<typeof certificate>) => { value.witnesses[0]!.span.revision = 'old' }, 'witnesses:owner-span-mismatch'],
    ['witness outside owner', (value: ReturnType<typeof certificate>) => { value.witnesses[0]!.span.end = 101 }, 'witnesses:owner-span-mismatch'],
    ['missing coverage', (value: ReturnType<typeof certificate>) => { value.coverage = [] }, 'coverage:path-absent'],
    ['unrequested coverage', (value: ReturnType<typeof certificate>) => { value.coverage[0]!.path = 'other.ts' }, 'coverage:path-unrequested'],
    ['duplicate owner', (value: ReturnType<typeof certificate>) => { value.owners.push(value.owners[0]!) }, 'owners:duplicate'],
    ['duplicate witness', (value: ReturnType<typeof certificate>) => { value.witnesses.push(value.witnesses[0]!) }, 'witnesses:duplicate'],
    ['duplicate path', (value: ReturnType<typeof certificate>) => { value.paths.push(value.paths[0]!) }, 'paths:duplicate'],
    ['duplicate coverage', (value: ReturnType<typeof certificate>) => { value.coverage.push(value.coverage[0]!) }, 'coverage:duplicate'],
    ['unmaterialized root', (value: ReturnType<typeof certificate>) => { value.owners[0]!.materialized = false }, 'coverage:unmaterialized-owner'],
  ])('rejects %s', (_name, edit, diagnostic) => {
    const value = certificate()
    edit(value)
    expect(validateTypeScriptFactPayload('body-demand', value)).toContain(diagnostic)
  })

  it.each(['../outside.ts', '/absolute.ts', 'queries/../request.ts', 'queries//request.ts', 'queries\\request.ts', '\0request.ts', '.'])
    ('rejects a noncanonical root %j', (path) => {
      const value = certificate()
      value.paths[0] = path
      expect(validateTypeScriptFactPayload('body-demand', value)).toContain('paths:invalid')
    })

  it('preserves attributable unavailable root and partial global authority', () => {
    const value = certificate()
    value.owners[0]!.materialized = false
    const unavailable = { kind: 'unavailable', reasons: [{ code: 'DEMAND_SOURCE_ABSENT', message: 'Source unavailable' }] }
    expect(validateTypeScriptFactPayload('body-demand', {
      ...value,
      coverage: [{ path: value.paths[0], completeness: unavailable }],
      completeness: { kind: 'partial', reasons: [{ code: 'BODY_LIMIT', message: 'Inventory incomplete' }] },
    })).toEqual([])
  })

  it('admits original body fact ordering authority only for materialized owners', () => {
    const value = certificate()
    expect(validateTypeScriptFactPayload('body-demand', {
      ...value, owners: [{ ...value.owners[0], fact: 'body-fact' }, value.owners[1]],
    })).toEqual([])
    expect(validateTypeScriptFactPayload('body-demand', {
      ...value, owners: [value.owners[0], { ...value.owners[1], fact: 'invented-body-fact' }],
    })).toContain('owners:unmaterialized-fact')
  })
})
