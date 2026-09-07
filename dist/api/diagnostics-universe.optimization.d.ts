import ts from 'typescript';
import type { DeclarationTypeScriptProject } from '../typescript/surface/project.ts';
import type { ExternalReference } from './external.ts';
/** Build one file-sensitive declaration checker when callers request diagnostics only. */
export declare function createDeclarationDiagnosticsUniverse(projectRoot: string, mainFiles: readonly string[], declarationFiles: ReadonlySet<string>, externalReferences: (file: string) => readonly ExternalReference[], options: ts.CompilerOptions): DeclarationTypeScriptProject;
/** Check only admitted declaration sources, then restore TypeScript's canonical diagnostic order. */
export declare function declarationDiagnosticsForFiles(program: ts.Program, declarationFiles: ReadonlySet<string>): readonly ts.Diagnostic[];
