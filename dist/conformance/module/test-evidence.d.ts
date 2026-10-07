import type { ConformanceProfile } from '../model.ts';
export declare const MODULE_TEST_EVIDENCE_PROFILE_ID = "contract.module.test-evidence";
export interface ModuleTestEvidenceConformanceOptions {
    /** Require every law to carry a test reference or a code anchor. */
    readonly requireLawEvidence?: boolean;
}
/**
 * Resolve authored test references and code anchors as evidence without claiming that the tests
 * passed. The law-evidence rule exists only when required, so default qualifications keep their
 * exact shape.
 */
export declare function createModuleTestEvidenceConformanceProfile(options?: ModuleTestEvidenceConformanceOptions): ConformanceProfile;
