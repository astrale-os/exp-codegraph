import type { NativeModuleBoundary } from '../../analysis/index.ts';
import type { Diagnostic } from '../../source/diagnostic.ts';
import type { SpecificationSnapshot } from '../../specification/index.ts';
export interface ApplicationModuleBoundaries {
    readonly boundaries: readonly NativeModuleBoundary[];
    readonly diagnostics: readonly Diagnostic[];
}
/** Resolve implementation observations without adding them to normative specification identity. */
export declare function resolveApplicationModuleBoundaries(inputRoot: string, specifications: readonly SpecificationSnapshot[]): Promise<ApplicationModuleBoundaries>;
/** Reject ambiguous logical identities, canonical roots, and every entrypoint class generically. */
export declare function validateApplicationModuleBoundaries(values: readonly NativeModuleBoundary[]): ApplicationModuleBoundaries;
