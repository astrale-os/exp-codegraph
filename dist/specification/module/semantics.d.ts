import type { Diagnostic } from '../../source/diagnostic.ts';
import type { BenchmarkResource, CapabilityResource, LawResource, PackagePatternResource, PackageSpecificationResource, SchemaResource } from '../resource/index.ts';
export interface ModuleSemanticResources {
    readonly capabilities: readonly CapabilityResource[];
    readonly laws: readonly LawResource[];
    readonly benchmarks: readonly BenchmarkResource[];
    readonly schemas: readonly SchemaResource[];
    readonly packages: readonly PackageSpecificationResource[];
    readonly packagePatterns: readonly PackagePatternResource[];
}
/** Validate relationships that only become visible after all module artifacts are loaded. */
export declare function validateModuleSemantics(resources: ModuleSemanticResources): Diagnostic[];
export declare function schemaId(schema: unknown): string | undefined;
