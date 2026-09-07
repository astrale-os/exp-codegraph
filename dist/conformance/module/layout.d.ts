import type { ConformanceProfile } from '../model.ts';
export declare const MODULE_LAYOUT_PROFILE_ID = "contract.module.layout";
export interface ModuleLayoutConformanceOptions {
    readonly requireComplete?: boolean;
    readonly requireExact?: boolean;
}
/** Compare physical layout observations without adding them to normative specifications. */
export declare function createModuleLayoutConformanceProfile(options?: ModuleLayoutConformanceOptions): ConformanceProfile;
