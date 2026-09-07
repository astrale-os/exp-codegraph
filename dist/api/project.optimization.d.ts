import ts from 'typescript';
import type { DeclarationTypeScriptProject } from '../typescript/surface/project.ts';
import type { ApiCompilationDependency, ApiDiagnostic, ApiSource, ApiToken } from './model.ts';
/** Reuse each exact declaration AST between corpus discovery and its compiler universe. */
export declare function createReusingDeclarationCompilerHost(options: ts.CompilerOptions): ts.CompilerHost;
/** Canonicalize each declaration Program path once across overlapping owner closures. */
export declare function declarationProgramRealpathOnce(program: ts.Program, file: string): string | undefined;
/** Hash one immutable declaration source once across overlapping owner dependency projections. */
export declare function declarationDependencyOnce(program: ts.Program, root: string, file: string): ApiCompilationDependency | undefined;
/** Reuse exact source-local diagnostics across overlapping owner closures. */
export declare function declarationSourceDiagnosticsOnce(source: ts.SourceFile, root: string, collect: () => readonly ApiDiagnostic[]): readonly ApiDiagnostic[];
/** Traverse each immutable Program source once and structurally share its semantic tokens. */
export declare function semanticTokensOnce(project: DeclarationTypeScriptProject, sources: readonly ApiSource[], root: string): readonly ApiToken[];
export declare function declarationDisplayPath(file: string, root: string): string;
export declare function declarationPortablePath(path: string): string;
export declare function compareDeclarationText(left: string, right: string): number;
