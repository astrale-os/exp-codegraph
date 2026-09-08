import type { ConformanceProfile, QualificationScope } from './model.ts';
export interface ConformancePlan {
    readonly ordered: readonly ConformanceProfile[];
    readonly scope: QualificationScope;
}
export declare function planConformance(profiles: readonly ConformanceProfile[], requestedProfiles?: readonly string[]): ConformancePlan;
