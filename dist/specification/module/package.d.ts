import type { PackagePatternDefinition } from '../../authoring/index.ts';
import type { PackageDependencyDefinition } from '../../authoring/index.ts';
import type { Diagnostic } from '../../source/diagnostic.ts';
export interface PackageCompilation {
    readonly definition?: PackageDependencyDefinition;
    readonly diagnostics: readonly Diagnostic[];
}
export interface PackagePatternCompilation {
    readonly definitions: readonly PackagePatternDefinition[];
    readonly diagnostics: readonly Diagnostic[];
}
export declare function compilePackageDefinition(source: string, text: string): PackageCompilation;
export declare function compilePackagePatterns(source: string, text: string): PackagePatternCompilation;
export declare function packageNameFromPath(relativePath: string): string | undefined;
export declare function matchesPackagePattern(pattern: string, packageName: string): boolean;
