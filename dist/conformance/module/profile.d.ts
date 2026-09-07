import type { ConformanceProfile } from '../model.ts';
import { type ModuleLayoutConformanceOptions } from './layout.ts';
export declare const MODULE_STRUCTURE_PROFILE_ID = "contract.module.structure";
export declare const MODULE_SURFACE_PROFILE_ID = "contract.module.surface";
export declare const MODULE_DEPENDENCIES_PROFILE_ID = "contract.module.dependencies";
/** Establish one unambiguous explicit implementation binding. */
export declare function createModuleStructureConformanceProfile(): ConformanceProfile;
/** Prove exact exports and compiler assignability through the explicit binding. */
export declare function createModuleSurfaceConformanceProfile(): ConformanceProfile;
/** Prove package intent and every direct compiler-resolved dependency occurrence. */
export declare function createModuleDependenciesConformanceProfile(): ConformanceProfile;
export declare function createModuleConformanceProfiles(): readonly ConformanceProfile[];
/** Install the complete TypeSpec application profile DAG, including repository observations. */
export declare function createTypeSpecConformanceProfiles(options?: ModuleLayoutConformanceOptions): readonly ConformanceProfile[];
