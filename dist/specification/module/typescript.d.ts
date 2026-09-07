import ts from 'typescript';
import type { ModuleFileInventory } from './inventory.ts';
import type { ModuleTypeScriptAnalysis, ModuleTypeScriptIsolationGroupResult } from './typescript-model.ts';
export type { ModuleTypeScriptAnalysis, ModuleTypeScriptIsolationEntry, ModuleTypeScriptIsolationGroupResult, } from './typescript-model.ts';
export interface ModuleTypeScriptCompilerUniverse {
    readonly options: ts.CompilerOptions;
    readonly resolutionEdges: ReadonlyMap<string, ReadonlySet<string>>;
    readonly program: ts.Program;
    readonly defaults: ReadonlySet<string>;
    readonly observedResolutions: ReadonlyMap<string, string | null>;
    readonly compilerDiagnostics?: readonly ts.Diagnostic[];
    readonly onProjectionPhase?: (phase: ModuleTypeScriptProjectionPhase) => void;
}
export interface ModuleTypeScriptProjectionPhase {
    readonly phase: 'admission' | 'program' | 'diagnostics' | 'evidence-index' | 'owner-boundaries' | 'owner-closures' | 'owner-diagnostics' | 'owner-evidence' | 'owner-references';
    readonly durationMs: number;
    readonly items: number;
    readonly fallbacks?: number;
    readonly workerPeakResidentBytes?: number;
    readonly workerResidentUpperBoundBytes?: number;
}
/** Project exact owner analyses from one already-admitted ambient-safe compiler universe. */
export declare function projectModuleTypeScriptCompilerUniverse(catalogRoot: string, inventories: readonly ModuleFileInventory[], universe: ModuleTypeScriptCompilerUniverse): Promise<readonly ModuleTypeScriptAnalysis[]>;
/** Prime one coherent catalog wave with shared TypeScript Programs where semantics permit it. */
export declare function prepareModuleTypeScriptAnalyses(catalogRoot: string, inventories: readonly ModuleFileInventory[], onProjectionPhase?: ModuleTypeScriptCompilerUniverse['onProjectionPhase'], onScheduled?: () => void): Promise<void>;
/** Worker entry: project one already-planned exact semantic group. */
export declare function analyzeModuleTypeScriptIsolationGroup(catalogRoot: string, inventories: readonly ModuleFileInventory[]): Promise<ModuleTypeScriptIsolationGroupResult>;
/** Typecheck all specification TypeScript and enforce local dependency-direction boundaries. */
export declare function analyzeModuleTypeScript(catalogRoot: string, inventory: ModuleFileInventory): Promise<ModuleTypeScriptAnalysis>;
