import type { ConformanceProfile } from '../model.ts';
export declare const SPECIFICATION_VALIDITY_PROFILE_ID = "contract.specification.validity";
/** Fail closed when authored normative input did not compile into a valid contract. */
export declare function createSpecificationValidityConformanceProfile(): ConformanceProfile;
