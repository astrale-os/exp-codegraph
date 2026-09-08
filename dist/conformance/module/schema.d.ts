import type { ConformanceProfile } from '../model.ts';
export declare const MODULE_SCHEMA_PROFILE_ID = "contract.module.schema-catalog";
/** Compile every schema identity and reference in one repository-local catalog. */
export declare function createModuleSchemaConformanceProfile(): ConformanceProfile;
