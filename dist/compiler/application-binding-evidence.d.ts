import ts from 'typescript';
import type { ApplicationModuleBindingDependency, ApplicationModuleBindingRequest } from '../analysis/binding/index.ts';
type IndexedBindingBoundary = ApplicationModuleBindingRequest['target'] & {
    readonly absoluteRoot: string;
    readonly entrypoints: ReadonlySet<string>;
};
export interface ProjectBindingIndex {
    readonly boundaries: readonly IndexedBindingBoundary[];
    readonly sourcesByOwner: ReadonlyMap<string, readonly ts.SourceFile[]>;
}
export declare function observeDependencies(root: string, program: ts.Program, request: ApplicationModuleBindingRequest, index: ProjectBindingIndex, exports: readonly {
    readonly sourceModule?: string;
    readonly path: readonly string[];
}[]): ApplicationModuleBindingDependency[];
export declare function readPackageIntent(moduleRoot: string): {
    readonly declared: readonly string[];
    readonly development: readonly string[];
};
export declare function observeExpectedErrorCodes(program: ts.Program, file: string): string[];
export declare function observeErrorCodes(request: ApplicationModuleBindingRequest, index: ProjectBindingIndex): string[];
export declare function indexProjectBindings(root: string, program: ts.Program, requests: readonly ApplicationModuleBindingRequest[]): ProjectBindingIndex;
export declare function resolvedModule(program: ts.Program, specifier: ts.Node, source: ts.SourceFile): ts.ResolvedModuleFull | undefined;
export {};
