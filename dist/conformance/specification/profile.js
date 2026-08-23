export const SPECIFICATION_VALIDITY_PROFILE_ID = 'contract.specification.validity';
/** Fail closed when authored normative input did not compile into a valid contract. */
export function createSpecificationValidityConformanceProfile() {
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
                severity: 'error',
                message: entry.message,
                profile: SPECIFICATION_VALIDITY_PROFILE_ID,
                rule: 'SPECIFICATION-VALID',
                subject: context.specification.module.id,
                ...(entry.pointer ? { specificationPointer: entry.pointer } : {}),
                evidence: [],
                inputs: [],
                actual: entry,
            }));
            return [
                {
                    rule: 'SPECIFICATION-VALID',
                    status: diagnostics.length ? 'error' : 'pass',
                    diagnostics,
                    coverage: {
                        forward: { matched: diagnostics.length ? 0 : 1, total: 1 },
                        inverse: { matched: diagnostics.length ? 0 : 1, total: 1 },
                    },
                },
            ];
        },
    };
}
//# sourceMappingURL=profile.js.map