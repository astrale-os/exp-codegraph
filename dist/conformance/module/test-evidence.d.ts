import type { ConformanceProfile } from '../model.ts';
export declare const MODULE_TEST_EVIDENCE_PROFILE_ID = "contract.module.test-evidence";
/** Resolve authored test references as evidence without claiming that the tests passed. */
export declare function createModuleTestEvidenceConformanceProfile(): ConformanceProfile;
