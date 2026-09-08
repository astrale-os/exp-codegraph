import type { NativeModuleBoundary, NativeSourceChange } from '../../analysis/index.ts';
import type { TypeScriptModuleRouting } from '../../analysis/typescript/index.ts';
type CompilerProject = readonly [string, readonly NativeModuleBoundary[]];
/** Canonical project grouping used by both routing and bounded compiler scheduling. */
export declare function groupApplicationCompilerProjects(boundaries: readonly NativeModuleBoundary[]): ReadonlyMap<string, readonly NativeModuleBoundary[]>;
/** Refresh independent compiler universes concurrently while retaining canonical project order. */
export declare function mapApplicationCompilerProjects<Input, Output>(inputs: readonly Input[], operation: (input: Input) => Promise<Output>): Promise<readonly Output[]>;
/** Compact exact routing index; compiler processes themselves remain bounded separately. */
export declare class ApplicationCompilerRoutingIndex {
    #private;
    reset(): void;
    update(project: string, routing: TypeScriptModuleRouting | undefined): void;
    affected(projects: readonly CompilerProject[], changes: readonly NativeSourceChange[] | undefined, conservative: boolean): readonly CompilerProject[];
    retained(projects: readonly CompilerProject[], residentModules: readonly string[] | undefined): ReadonlySet<string>;
}
export {};
