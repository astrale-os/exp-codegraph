import type { TypeSpecApplicationReader } from '../application/index.ts';
export interface EvidenceTestGroup {
    readonly packageName: string;
    readonly files: readonly string[];
    readonly evidenceCount: number;
}
export interface EvidenceTestPlan {
    readonly active: number;
    readonly skipped: number;
    readonly todo: number;
    readonly groups: readonly EvidenceTestGroup[];
}
export interface EvidenceTestResult {
    readonly passed: number;
    readonly failed: number;
    readonly failedPackages: readonly string[];
}
export interface EvidenceTestExecutor {
    run(root: string, files: readonly string[]): Promise<number>;
}
/** Plan only executable evidence attached to the requested module scope. */
export declare function planEvidenceTests(root: string, reader: TypeSpecApplicationReader, scope: 'all' | 'selected' | 'changed'): Promise<EvidenceTestPlan>;
/** Execute one package at a time through the repository's standard test:file adapter. */
export declare function executeEvidenceTests(root: string, plan: EvidenceTestPlan, onGroup?: (group: EvidenceTestGroup) => void, executor?: EvidenceTestExecutor): Promise<EvidenceTestResult>;
