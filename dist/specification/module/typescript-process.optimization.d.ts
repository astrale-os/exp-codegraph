import type { ModuleFileInventory } from './inventory.ts';
import type { ModuleTypeScriptIsolationEntry } from './typescript-model.ts';
export interface ModuleTypeScriptIsolationResult {
    readonly entries: readonly ModuleTypeScriptIsolationEntry[];
    readonly programs: number;
    readonly workerPeakResidentBytes: number;
    readonly workerResidentUpperBoundBytes: number;
}
/** Execute exact preplanned whole-corpus groups serially behind bounded compiler heaps. */
export declare function analyzeModuleTypeScriptGroupsIsolated(root: string, groups: readonly (readonly ModuleFileInventory[])[]): Promise<ModuleTypeScriptIsolationResult>;
