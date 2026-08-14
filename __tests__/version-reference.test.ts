import { describe, expect, it } from 'vitest'

import {
  declarationLiteralVersion,
  isSpecificationSourcePath,
  staleVersionReferences,
} from '../qualification/version-reference.ts'

describe('version reference qualification', () => {
  it('derives current coordinates from authoritative declaration literals', () => {
    expect(
      declarationLiteralVersion(
        'query.d.ts',
        "export type QueryAST = { readonly version: 'v5' }\n",
        'QueryAST.version',
      ),
    ).toBe(5)
    expect(
      declarationLiteralVersion(
        'plan.d.ts',
        'export declare const QUERY_PLAN_VERSION: 6\n',
        'QUERY_PLAN_VERSION',
      ),
    ).toBe(6)
  })

  it('rejects computed and conflicting duplicate version authorities', () => {
    expect(() =>
      declarationLiteralVersion(
        'query.d.ts',
        "type Current = 'v5'\nexport type QueryAST = { version: Current }\n",
        'QueryAST.version',
      ),
    ).toThrow('Version authority QueryAST.version is not one numeric literal in query.d.ts.')
    expect(() =>
      declarationLiteralVersion(
        'plan.d.ts',
        'export declare const QUERY_PLAN_VERSION: 5\nexport declare const QUERY_PLAN_VERSION: 6\n',
        'QUERY_PLAN_VERSION',
      ),
    ).toThrow('Version authority QUERY_PLAN_VERSION is not one numeric literal in plan.d.ts.')
    expect(() =>
      declarationLiteralVersion(
        'plan.d.ts',
        'export declare const QUERY_PLAN_VERSION: 0\n',
        'QUERY_PLAN_VERSION',
      ),
    ).toThrow('Version authority QUERY_PLAN_VERSION is not one numeric literal in plan.d.ts.')
  })

  it('reports stale active prose and accepts reason-bearing history', () => {
    const diagnostics = staleVersionReferences(
      [
        { file: 'runtime/query/.spec/architecture.md', text: 'Uses Query V3 and Plan V4.\n' },
        {
          file: 'core/graph/query/.spec/laws/history.ts',
          text: "// @version-history: rejected legacy inputs\nexport const note = 'Query V1 rejects'\n",
        },
      ],
      [
        { name: 'Query', current: 5, patterns: [/\bQuery V(?<version>\d+)\b/gu] },
        {
          name: 'Query Plan',
          current: 6,
          patterns: [/\bPlan V(?<version>\d+)\b/gu],
          roots: ['runtime/query/'],
        },
      ],
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'VERSION_REFERENCE_STALE', line: 1, column: 6 }),
      expect.objectContaining({ code: 'VERSION_REFERENCE_STALE', line: 1, column: 19 }),
    ])
  })

  it('does not accept an empty history annotation', () => {
    expect(
      staleVersionReferences(
        [{ file: 'query/.spec/laws/history.ts', text: '// @version-history:\n// Query V1\n' }],
        [{ name: 'Query', current: 5, patterns: [/\bQuery V(?<version>\d+)\b/gu] }],
      ),
    ).toEqual([expect.objectContaining({ code: 'VERSION_REFERENCE_STALE', line: 2 })])
  })

  it('does not let one history reason suppress a later active reference', () => {
    const diagnostics = staleVersionReferences(
      [
        {
          file: 'query/.spec/laws/history.ts',
          text:
            '// @version-history: retained compatibility case\n' +
            "export const legacy = 'Query V1'\n" +
            "export const active = 'Query V2'\n",
        },
      ],
      [{ name: 'Query', current: 5, patterns: [/\bQuery V(?<version>\d+)\b/gu] }],
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'VERSION_REFERENCE_STALE', line: 3, column: 24 }),
    ])
  })

  it('recognizes nested and repository-root specification sources only', () => {
    expect(isSpecificationSourcePath('.spec/architecture.md')).toBe(true)
    expect(isSpecificationSourcePath('runtime/query/.spec/laws/query.ts')).toBe(true)
    expect(isSpecificationSourcePath('runtime/query/.history/history.md')).toBe(false)
    expect(isSpecificationSourcePath('runtime/query/.spec/icon.svg')).toBe(false)
  })
})
