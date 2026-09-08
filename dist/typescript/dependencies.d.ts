import ts from 'typescript';
import type { DeclarationTypeScriptProject } from './surface/project.ts';
export type TypeScriptDependencyKind = 'dynamic' | 'export' | 'runtime' | 'side-effect' | 'type';
export interface TypeScriptDependencyReference {
    readonly specifier: string;
    readonly node: ts.Node;
    readonly kind: TypeScriptDependencyKind;
    readonly typeOnly: boolean;
}
export interface UnresolvedTypeScriptDependency {
    readonly kind: 'dynamic' | 'require';
    readonly node: ts.Node;
}
export interface TypeScriptDependencyReferences {
    readonly references: readonly TypeScriptDependencyReference[];
    readonly unresolved: readonly UnresolvedTypeScriptDependency[];
}
/** Observe static module references without assigning architecture-specific ownership semantics. */
export declare function typeScriptDependencyReferences(source: ts.SourceFile, checker: ts.TypeChecker): TypeScriptDependencyReferences;
export declare function resolveTypeScriptModuleFile(project: DeclarationTypeScriptProject, source: ts.SourceFile, specifier: string): string | undefined;
