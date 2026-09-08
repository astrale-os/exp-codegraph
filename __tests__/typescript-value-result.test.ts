import { describe, expect, it, vi } from 'vitest'

import { mapValueResult, type EvaluatedValueResult, type ValueResult } from '../analysis/typescript/index.ts'
import type { AnalysisFailure, AnalysisLimit } from '../analysis/facts/index.ts'
import type { FactId } from '../analysis/identity/index.ts'

const evidence = ['fact:reference'] as readonly FactId[]
const alternatives: readonly AnalysisLimit[] = [{ code: 'BRANCHES', message: 'Both branches are reachable.', effective: { branches: 2 } }]
const failures: readonly AnalysisFailure[] = [{ code: 'VALUE_STEP_LIMIT', message: 'The proof exhausted its budget.', retryable: false }]
const ambiguous = <Value>(values: readonly Value[]): ValueResult<Value> => ({ kind: 'ambiguous', values, reasons: alternatives, evidence })

describe('mapping value knowledge', () => {
  it('projects known numbers to strings and retains the original evidence', () => {
    const result = mapValueResult({ kind: 'known', value: 42, evidence }, String)
    expect(result).toEqual({ kind: 'known', value: '42', evidence })
    expect(result.evidence).toBe(evidence)
  })

  it('proves one normalized value when exhaustive alternatives agree', () => {
    expect(mapValueResult(ambiguous([' READY ', 'ready']), (value) => value.trim().toLowerCase()))
      .toEqual({ kind: 'known', value: 'ready', evidence })
  })

  it('preserves distinct alternatives and their reasons', () => {
    const result = mapValueResult(ambiguous([4, 10]), String)
    expect(result).toEqual({ kind: 'ambiguous', values: ['4', '10'], reasons: alternatives, evidence })
    if (result.kind === 'ambiguous') expect(result.reasons).toBe(alternatives)
  })

  it('uses identity equality for objects unless the consumer supplies semantic equality', () => {
    const project = (value: string) => ({ normalized: value.toLowerCase() })
    expect(mapValueResult(ambiguous(['A', 'a']), project).kind).toBe('ambiguous')
    expect(mapValueResult(ambiguous(['A', 'a']), project, {
      equals: (left, right) => left.normalized === right.normalized,
    })).toEqual({ kind: 'known', value: { normalized: 'a' }, evidence })
  })

  it('uses Object.is for NaN and signed zero', () => {
    expect(mapValueResult(ambiguous([1, 2]), () => Number.NaN).kind).toBe('known')
    expect(mapValueResult(ambiguous([0, -0]), (value) => value).kind).toBe('ambiguous')
  })

  it('keeps incomplete candidates unknown even when every mapped candidate agrees', () => {
    const result = mapValueResult({
      kind: 'unknown', candidates: ['left', 'right'], reasons: failures, evidence,
    }, () => 1)
    expect(result).toEqual({ kind: 'unknown', candidates: [1, 1], reasons: failures, evidence })
    if (result.kind === 'unknown') expect(result.reasons).toBe(failures)
  })

  it('does not invent candidates or invoke a projection when there are no observed values', () => {
    const project = vi.fn((value: number) => String(value))
    expect(mapValueResult({ kind: 'unknown', reasons: failures, evidence }, project))
      .toEqual({ kind: 'unknown', reasons: failures, evidence })
    expect(project).not.toHaveBeenCalled()
  })

  it('preserves unsupported constructs without running the projection', () => {
    const project = vi.fn((value: number) => String(value))
    expect(mapValueResult({ kind: 'unsupported', construct: 'RestBinding', evidence }, project))
      .toEqual({ kind: 'unsupported', construct: 'RestBinding', evidence })
    expect(project).not.toHaveBeenCalled()
  })

  it('does not turn an empty alternative inventory into a known undefined value', () => {
    expect(mapValueResult(ambiguous<string>([]), (value) => value.length))
      .toEqual({ kind: 'ambiguous', values: [], reasons: alternatives, evidence })
  })

  it('keeps budget metadata on the original evaluation rather than manufacturing a reusable receipt', () => {
    const original: EvaluatedValueResult<number> = {
      kind: 'unknown', candidates: [1, 2], reasons: failures, evidence,
      limits: { maximumSteps: 1, maximumDepth: 3, maximumAlternatives: 4 },
    }
    const result = mapValueResult(original, () => 'observed')
    expect(result).toEqual({ kind: 'unknown', candidates: ['observed', 'observed'], reasons: failures, evidence })
    expect(result).not.toHaveProperty('limits')
    expect(original.limits.maximumSteps).toBe(1)
    // @ts-expect-error A derived value result is not an evaluation receipt.
    const receipt: EvaluatedValueResult<string> = result
    expect(receipt).toBe(result)
  })
})
