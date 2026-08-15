import { describe, expect, test } from 'vitest'

import { incompleteCapabilityCandidates } from '../qualification/v2/self-host/analyze.ts'

describe('V2 self-host governance', () => {
  test('fingerprints every incomplete capability reason independently and exactly', () => {
    const candidates = incompleteCapabilityCandidates('codegraph', 'tsconfig.json', {
      capability: 'typescript.body',
      completeness: {
        kind: 'partial',
        reasons: [
          {
            code: 'CFG_EXPRESSION_BRANCH_PARTIAL',
            message: 'Conditional expressions retain explicit partial completeness.',
            effective: { branches: 627 },
          },
          {
            code: 'CFG_SWITCH_PARTIAL',
            message: 'Switch statements retain explicit partial completeness.',
            effective: { branches: 5 },
          },
        ],
      },
    })

    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map((candidate) => candidate.fingerprint)).size).toBe(2)
    expect(candidates.map((candidate) => candidate.summary)).toEqual([
      'typescript.body is partial: CFG_EXPRESSION_BRANCH_PARTIAL',
      'typescript.body is partial: CFG_SWITCH_PARTIAL',
    ])

    const changedEvidence = incompleteCapabilityCandidates('codegraph', 'tsconfig.json', {
      capability: 'typescript.body',
      completeness: {
        kind: 'partial',
        reasons: [{
          code: 'CFG_SWITCH_PARTIAL',
          message: 'Switch statements retain explicit partial completeness.',
          effective: { branches: 6 },
        }],
      },
    })
    expect(changedEvidence[0]!.fingerprint).not.toBe(candidates[1]!.fingerprint)
  })
})
