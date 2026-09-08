import ts from 'typescript';
interface TypeScriptDependencyEvidence {
    readonly file: string;
    readonly revision: string;
}
export interface TypeScriptResolutionEvidence {
    readonly kind: 'module' | 'path' | 'type';
    readonly containingFile: string;
    readonly specifier: string;
    readonly mode: ts.ResolutionMode;
    readonly resolvedFile?: string;
}
export interface ModuleTypeScriptEvidence {
    readonly sources: readonly {
        readonly dependency: TypeScriptDependencyEvidence;
        readonly resolutions: readonly TypeScriptResolutionEvidence[];
    }[];
}
export declare function captureModuleTypeScriptEvidence(program: ts.Program, options: ts.CompilerOptions, selectedSources?: readonly ts.SourceFile[], observed?: ReadonlyMap<string, string | null>): ModuleTypeScriptEvidence;
export declare function moduleTypeScriptEvidenceCurrent(evidence: ModuleTypeScriptEvidence, options: ts.CompilerOptions): Promise<boolean>;
export declare function moduleTypeScriptResolutionKey(kind: TypeScriptResolutionEvidence['kind'], containingFile: string, specifier: string, mode: ts.ResolutionMode): string;
export {};
