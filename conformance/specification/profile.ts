import type { ConformanceProfile } from '../model.ts'

export const SPECIFICATION_VALIDITY_PROFILE_ID = 'contract.specification.validity'

/** Fail closed when authored normative input did not compile into a valid contract. */
export function createSpecificationValidityConformanceProfile(): ConformanceProfile {
  return {
    manifest: {
      id: SPECIFICATION_VALIDITY_PROFILE_ID,
      version: '1.0.0',
      dependsOn: [],
      requiresCapabilities: [],
      rules: ['SPECIFICATION-VALID'],
      evaluationScope: 'specification',
    },
    async evaluate(context) {
      const diagnostics = context.specification.diagnostics.map((entry) => ({
        code: entry.code,
        severity: 'error' as const,
        message: entry.message,
        profile: SPECIFICATION_VALIDITY_PROFILE_ID,
        rule: 'SPECIFICATION-VALID',
        subject: context.specification.module.id,
        specificationPointer: entry.pointer,
        evidence: [],
        inputs: [],
        actual: entry,
      }))
      return [
        {
          rule: 'SPECIFICATION-VALID',
          status: diagnostics.length ? ('error' as const) : ('pass' as const),
          diagnostics,
          coverage: {
            forward: { matched: diagnostics.length ? 0 : 1, total: 1 },
            inverse: { matched: diagnostics.length ? 0 : 1, total: 1 },
          },
        },
      ]
    },
  }
}
