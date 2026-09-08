import type { Diagnostic } from '../../source/diagnostic.ts';
import type { BenchmarkResource, CapabilityResource, CodeDeclarationResource, ExampleResource, LawResource, ModuleCodeResource, PackagePatternResource, PackageSpecificationResource, SchemaResource, StateResource } from '../resource/index.ts';
import { type DescriptorKind } from '../module/descriptor.ts';
import type { ModuleFile } from '../module/inventory.ts';
import type { AuthoredLayoutResource, SpecificationDeclarationResource, SpecificationPortResource } from './model.ts';
export interface Resources<Resource> {
    readonly resources: readonly Resource[];
    readonly diagnostics: readonly Diagnostic[];
}
export declare function loadCodeDeclaration(file: ModuleFile): Promise<{
    resource?: CodeDeclarationResource;
    diagnostics: Diagnostic[];
}>;
export declare function normativeResourceRevision(resource: {
    readonly revision: string;
} | SpecificationDeclarationResource): string;
export declare function loadSchemas(root: string, files: readonly ModuleFile[]): Promise<Resources<SchemaResource>>;
export declare function loadPorts(root: string, apiFile: string, specSource: string, files: readonly ModuleFile[]): Promise<Resources<SpecificationPortResource>>;
export type DescriptorResource<Kind extends DescriptorKind> = Kind extends 'capability' ? CapabilityResource : Kind extends 'law' ? LawResource : Kind extends 'state' ? StateResource : BenchmarkResource;
export declare function loadDescriptors<Kind extends DescriptorKind>(kind: Kind, files: readonly ModuleFile[]): Promise<Resources<DescriptorResource<Kind>>>;
export declare function loadCodeResources(kind: 'flow', files: readonly ModuleFile[]): Promise<Resources<ModuleCodeResource>>;
export declare function loadCodeResource(kind: 'flow' | 'limits', file: ModuleFile): Promise<{
    resource?: ModuleCodeResource;
    diagnostics: Diagnostic[];
}>;
export declare function loadAuthoredLayout(file: ModuleFile): Promise<{
    readonly resource?: AuthoredLayoutResource;
    readonly diagnostics: readonly Diagnostic[];
}>;
export declare function loadExamples(files: readonly ModuleFile[]): Promise<Resources<ExampleResource>>;
export declare function loadPackages(files: readonly ModuleFile[]): Promise<Resources<PackageSpecificationResource>>;
export declare function loadPackagePatterns(file: ModuleFile): Promise<Resources<PackagePatternResource>>;
export declare function revisionOf(resources: readonly (readonly [string, string])[]): string;
export declare function deduplicateDiagnostics(values: readonly Diagnostic[]): Diagnostic[];
export declare function fileDiagnostic(code: string, error: unknown, file: ModuleFile): Diagnostic;
export declare function moduleTitle(source: string, fallback: string): string;
export declare function portable(path: string): string;
