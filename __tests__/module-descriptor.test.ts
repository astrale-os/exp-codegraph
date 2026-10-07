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

  it('extracts local and descendant capability citations', () => {
    const result = compileDescriptor(
      'capability',
      'runtime/.spec/capabilities/runtime.ts',
      `import { defineCapability } from '@astrale-os/codegraph/authoring'
export const RUNTIME_STARTS = defineCapability({
  id: 'RUNTIME-STARTS',
  statement: 'The runtime starts.',
  laws: ['RUNTIME-ORDERED', { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' }],
  capabilities: [{ module: 'boot/journal', id: 'JOURNAL-REPLAYS' }],
})
`,
    )

    expect(result.diagnostics).toEqual([])
    expect(result.definitions).toEqual([
      {
        exportName: 'RUNTIME_STARTS',
        id: 'RUNTIME-STARTS',
        statement: 'The runtime starts.',
        laws: ['RUNTIME-ORDERED', { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' }],
        capabilities: [{ module: 'boot/journal', id: 'JOURNAL-REPLAYS' }],
      },
    ])
  })

  it('rejects citations outside strict descendants, duplicates, and non-literal entries', () => {
    const result = compileDescriptor(
      'capability',
      'runtime/.spec/capabilities/runtime.ts',
      `import { defineCapability } from '@astrale-os/codegraph/authoring'
const dynamic = 'RUNTIME-DYNAMIC'
export const RUNTIME_STARTS = defineCapability({
  id: 'RUNTIME-STARTS',
  statement: 'The runtime starts.',
  laws: [
    { module: '../server', id: 'SERVER-LISTENS' },
    { module: './boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
    { module: '/boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
    { module: 'boot/../../server', id: 'SERVER-LISTENS' },
    { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
    { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
    'RUNTIME-ORDERED',
    'RUNTIME-ORDERED',
    dynamic,
  ],
  capabilities: 'RUNTIME-READY',
})
`,
    )

    expect(
      result.diagnostics.map(({ code, line, column }) => ({ code, line, column })),
    ).toEqual([
      { code: 'MODULE_DESCRIPTOR_STATEMENT_INVALID', line: 2, column: 1 },
      { code: 'CAPABILITY_MODULE_INVALID', line: 7, column: 7 },
      { code: 'CAPABILITY_MODULE_INVALID', line: 8, column: 7 },
      { code: 'CAPABILITY_MODULE_INVALID', line: 9, column: 7 },
      { code: 'CAPABILITY_MODULE_INVALID', line: 10, column: 7 },
      { code: 'CAPABILITY_REFERENCE_DUPLICATE', line: 12, column: 5 },
      { code: 'CAPABILITY_REFERENCE_DUPLICATE', line: 14, column: 5 },
      { code: 'MODULE_DESCRIPTOR_FIELD_INVALID', line: 15, column: 5 },
      { code: 'MODULE_DESCRIPTOR_FIELD_INVALID', line: 17, column: 3 },
    ])
    expect(result.diagnostics[5]?.message).toBe(
      'Capability RUNTIME-STARTS cites BOOT-INPUT-BEFORE-DURABLE in module boot more than once in laws.',
    )
    expect(result.definitions).toEqual([
      {
        exportName: 'RUNTIME_STARTS',
        id: 'RUNTIME-STARTS',
        statement: 'The runtime starts.',
        laws: [{ module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' }, 'RUNTIME-ORDERED'],
      },
    ])
  })

  it('extracts whole-file and symbol code anchors on a law', () => {
    const result = compileDescriptor(
      'law',
      'module/.spec/laws/resolver.ts',
      `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const RESOLVER_VALIDATES = defineLaw({
  id: 'RESOLVER-VALIDATES',
  statement: 'A local artifact is validated before it is installed.',
  code: [
    { file: 'src/resolver.ts', symbol: 'Resolver.resolve' },
    { file: 'src/resolver.ts', symbol: 'validateRequirements' },
    { file: 'proofs/Resolver.lean' },
  ],
})
`,
    )

    expect(result.diagnostics).toEqual([])
    expect(result.definitions).toEqual([
      {
        exportName: 'RESOLVER_VALIDATES',
        id: 'RESOLVER-VALIDATES',
        statement: 'A local artifact is validated before it is installed.',
        code: [
          { file: 'src/resolver.ts', symbol: 'Resolver.resolve' },
          { file: 'src/resolver.ts', symbol: 'validateRequirements' },
          { file: 'proofs/Resolver.lean' },
        ],
        testEvidence: [],
      },
    ])
  })

  it('rejects malformed code anchors where they are authored', () => {
    const malformed = compileDescriptor(
      'law',
      'module/.spec/laws/resolver.ts',
      `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const RESOLVER_VALIDATES = defineLaw({
  id: 'RESOLVER-VALIDATES',
  statement: 'A local artifact is validated before it is installed.',
  code: [
    { file: 'src/resolver.ts', symbol: 'Resolver.resolve.inner' },
    { file: 'src/resolver.ts', symbol: 'resolve()' },
    { file: 'src/resolver.ts', line: 12 },
    'src/resolver.ts',
    { symbol: 'Resolver' },
  ],
})
`,
    )
    expect(
      malformed.diagnostics.map(({ code, line, column }) => ({ code, line, column })),
    ).toEqual([
      { code: 'CODE_ANCHOR_SYMBOL_INVALID', line: 6, column: 32 },
      { code: 'CODE_ANCHOR_SYMBOL_INVALID', line: 7, column: 32 },
      { code: 'MODULE_DESCRIPTOR_FIELD_UNKNOWN', line: 8, column: 32 },
      { code: 'MODULE_DESCRIPTOR_FIELD_INVALID', line: 9, column: 5 },
      { code: 'MODULE_DESCRIPTOR_FIELD_MISSING', line: 10, column: 5 },
    ])
    expect(malformed.definitions[0]).toMatchObject({ code: [{ file: 'src/resolver.ts' }] })

    const duplicated = compileDescriptor(
      'law',
      'module/.spec/laws/resolver.ts',
      `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const RESOLVER_VALIDATES = defineLaw({
  id: 'RESOLVER-VALIDATES',
  statement: 'A local artifact is validated before it is installed.',
  code: [{ file: 'src/resolver.ts' }, { file: 'src/resolver.ts' }],
})
`,
    )
    expect(duplicated.diagnostics).toEqual([
      expect.objectContaining({ code: 'MODULE_DESCRIPTOR_FIELD_DUPLICATE', line: 5, column: 3 }),
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
