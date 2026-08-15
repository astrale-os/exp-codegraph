import { describe, expect, it } from 'vitest'

import { compileDescriptor } from '../specification/index.ts'

describe('module specification descriptor extraction', () => {
  it('extracts semantic descriptors through aliased authoring imports', () => {
    const law = compileDescriptor(
      'law',
      'module/.spec/laws/mutation.ts',
      `import { defineLaw as law } from '@astrale-os/codegraph/authoring'
export const MUT_FAIL_UNCHANGED = law({
  id: 'MUT-FAIL-UNCHANGED',
  statement: 'A failed mutation leaves persistent state unchanged.',
  formal: String.raw\`fail(m) \\Rightarrow state' = state\`,
  tests: [{ file: '../__tests__/mutation.test.ts', id: 'MUT-PRESERVES-FAILURE' }],
})
`,
    )

    expect(law.diagnostics).toEqual([])
    expect(law.definitions).toEqual([
      {
        exportName: 'MUT_FAIL_UNCHANGED',
        id: 'MUT-FAIL-UNCHANGED',
        statement: 'A failed mutation leaves persistent state unchanged.',
        formal: "fail(m) \\Rightarrow state' = state",
        tests: [{ file: '../__tests__/mutation.test.ts', id: 'MUT-PRESERVES-FAILURE' }],
        testEvidence: [],
      },
    ])

    const capability = compileDescriptor(
      'capability',
      'module/.spec/capabilities/query.ts',
      `import { defineCapability } from '@astrale-os/codegraph/authoring'
export const QRY_FILTER = defineCapability({
  id: 'QRY-FILTER',
  statement: 'Queries can restrict values using predicates.',
})
`,
    )
    expect(capability.diagnostics).toEqual([])
    expect(capability.definitions[0]).toMatchObject({ id: 'QRY-FILTER' })

    const benchmark = compileDescriptor(
      'benchmark',
      'module/.spec/benchmarks/filter.ts',
      `import { defineBenchmark } from '@astrale-os/codegraph/authoring'
export const QRY_FILTER_SCALE = defineBenchmark({
  id: 'QRY-FILTER-SCALE',
  statement: 'Characterizes filtering as input size grows.',
  capability: 'QRY-FILTER',
  workload: 'Filter deterministic collections at representative scales.',
  metrics: ['duration', 'allocations'],
  assumptions: ['The dataset is generated from a fixed seed.'],
})
`,
    )
    expect(benchmark.diagnostics).toEqual([])
    expect(benchmark.definitions[0]).toMatchObject({
      id: 'QRY-FILTER-SCALE',
      capability: 'QRY-FILTER',
      metrics: ['duration', 'allocations'],
    })
  })

  it('extracts state topology with an optional initial state and terminal states', () => {
    const result = compileDescriptor(
      'state',
      'module/.spec/states/job.ts',
      `import { defineState } from '@astrale-os/codegraph/authoring'
export const jobState = defineState({
  initial: 'pending',
  transitions: {
    pending: { start: 'running' },
    running: { finish: 'done' },
    done: {},
  },
  tests: [{ file: '../__tests__/job.test.ts', id: 'JOB-FOLLOWS-LIFECYCLE' }],
})
`,
    )

    expect(result.diagnostics).toEqual([])
    expect(result.definitions).toEqual([
      {
        exportName: 'jobState',
        initial: 'pending',
        transitions: {
          pending: { start: 'running' },
          running: { finish: 'done' },
          done: {},
        },
        tests: [{ file: '../__tests__/job.test.ts', id: 'JOB-FOLLOWS-LIFECYCLE' }],
        testEvidence: [],
      },
    ])
  })

  it('rejects pseudo-descriptors, executable statements, drifted IDs, and dynamic fields', () => {
    const result = compileDescriptor(
      'law',
      'module/.spec/laws/invalid.ts',
      `import { defineLaw } from './pretend.js'
const statement = 'Dynamic statement.'
export const LAW_ONE = defineLaw({ id: 'LAW-002', statement })
throw new Error('must never execute')
`,
    )

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'MODULE_DESCRIPTOR_IMPORT_INVALID',
      'MODULE_DESCRIPTOR_STATEMENT_INVALID',
      'MODULE_DESCRIPTOR_EXPORT_INVALID',
      'MODULE_DESCRIPTOR_STATEMENT_INVALID',
    ])
  })

  it('reports state targets and initial states outside the declared relation', () => {
    const result = compileDescriptor(
      'state',
      'module/.spec/states/invalid.ts',
      `import { defineState } from '@astrale-os/codegraph/authoring'
export const invalid = defineState({
  initial: 'missing',
  transitions: {
    pending: { start: 'unknown' },
    running: {},
  },
})
`,
    )

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'STATE_TARGET_UNKNOWN',
      'STATE_INITIAL_UNKNOWN',
    ])
  })

  it('requires the TypeScript export name to remain mechanically aligned with its ID', () => {
    const result = compileDescriptor(
      'capability',
      'module/.spec/capabilities/query.ts',
      `import { defineCapability } from '@astrale-os/codegraph/authoring'
export const QUERY = defineCapability({
  id: 'QRY-FILTER',
  statement: 'Queries can filter values.',
})
`,
    )

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'MODULE_DESCRIPTOR_EXPORT_MISMATCH' }),
    ])
  })

  it('rejects mutable descriptor bindings', () => {
    const result = compileDescriptor(
      'capability',
      'module/.spec/capabilities/query.ts',
      `import { defineCapability } from '@astrale-os/codegraph/authoring'
export let QRY_FILTER = defineCapability({
  id: 'QRY-FILTER',
  statement: 'Queries can filter values.',
})
`,
    )

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'MODULE_DESCRIPTOR_MUTABLE' }),
    )
  })
})
