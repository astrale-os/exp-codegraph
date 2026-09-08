import ts from 'typescript';
import type { DeclarationTypeScriptProject } from '../typescript/surface/project.ts';
import type { DeclarationSurfaceSemantics } from '../typescript/surface/semantics.ts';
import type { ApiCompilation } from './model.ts';
export interface CompileApiOptions {
    readonly mainFile: string;
    readonly projectRoot?: string;
    /** The only supported semantics are the authored V2 contract. */
    readonly semantics?: DeclarationSurfaceSemantics;
    /** Include source-navigation tokens for presentation consumers; semantic models do not require them. */
    readonly declarationNavigation?: boolean;
    /** Build the complete normalized declaration model after exact diagnostics pass. */
    readonly declarationModel?: boolean;
}
export interface DeclarationCompilerUniverseProjection {
    readonly mainFile: string;
    readonly projectRoot: string;
    readonly files: ReadonlySet<string>;
    readonly semantics?: DeclarationSurfaceSemantics;
    readonly declarationNavigation?: boolean;
    readonly declarationModel?: boolean;
}
/** Plan minimum semantics-compatible declaration components without performing owner projection. */
export declare function planDeclarationCompilerUniverses(options: readonly CompileApiOptions[]): readonly (readonly number[])[];
export declare function compileDeclarationApi(options: CompileApiOptions): ApiCompilation;
/** Project exact API models from one already-admitted compatible compiler universe. */
export declare function projectDeclarationCompilerUniverse(project: DeclarationTypeScriptProject, requests: readonly DeclarationCompilerUniverseProjection[], programDiagnostics?: readonly ts.Diagnostic[]): readonly ApiCompilation[];
/** Compile declaration entrypoints sharing a project root against one immutable TypeScript program. */
export declare function compileDeclarationApis(options: readonly CompileApiOptions[]): readonly ApiCompilation[];
