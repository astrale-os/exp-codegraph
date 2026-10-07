import type { CapabilityCitation, CapabilityCoordinate } from '../specification/index.ts';
import type { CliOutput } from './report.ts';
export interface ImpactedLaw extends CapabilityCoordinate {
    readonly source: string;
    /** Changed files this law is attached to, each with the kind of attachment. */
    readonly reasons: readonly {
        readonly kind: 'test' | 'code';
        readonly file: string;
    }[];
}
export interface LawlessModule {
    readonly module: string;
    /** Changed non-test source files owned by a module that declares no law. */
    readonly files: readonly string[];
}
/** What a change set asks a reader to re-read; computed on demand and never stored. */
export interface ChangedLawImpact {
    readonly laws: readonly ImpactedLaw[];
    readonly capabilities: readonly CapabilityCitation[];
    readonly lawless: readonly LawlessModule[];
}
/**
 * Relate changed files to the laws attached to them, at file granularity.
 *
 * Only capability and law descriptors are parsed: no contract is compiled and nothing is executed,
 * so the result is available before, and independently of, the check itself.
 */
export declare function changedLawImpact(root: string, files: readonly string[], exclude?: readonly string[]): Promise<ChangedLawImpact>;
/** Print the impact section. It is informational and never contributes to the exit status. */
export declare function printLawImpact(output: CliOutput, impact: ChangedLawImpact): void;
export declare function impactIsEmpty(impact: ChangedLawImpact): boolean;
