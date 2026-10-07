import type { Diagnostic } from '../../source/diagnostic.ts';
import type { BenchmarkSpecification, CapabilitySpecification, LawSpecification, StateSpecification } from '../resource/index.ts';
export type DescriptorKind = 'capability' | 'law' | 'state' | 'benchmark';
export interface DescriptorDefinitions {
    readonly capability: readonly CapabilitySpecification[];
    readonly law: readonly LawSpecification[];
    readonly state: readonly StateSpecification[];
    readonly benchmark: readonly BenchmarkSpecification[];
}
export interface DescriptorCompilation<Kind extends DescriptorKind> {
    readonly definitions: DescriptorDefinitions[Kind];
    readonly diagnostics: readonly Diagnostic[];
}
/** Extract a deliberately small literal descriptor language without importing or executing it. */
export declare function compileDescriptor<Kind extends DescriptorKind>(kind: Kind, source: string, text: string): DescriptorCompilation<Kind>;
/** One authored array element: a string literal, or an object of exactly these string fields. */
export type DescriptorElement = string | Readonly<Record<string, string | undefined>>;
/**
 * Locate one authored descriptor value for a diagnostic derived after extraction.
 *
 * A string step names a literal field; an element step selects the first array element spelling
 * exactly that literal. An unknown step falls back to the nearest located ancestor.
 */
export declare function locateDescriptorValue(source: string, text: string, exportName: string, path?: readonly (string | {
    readonly element: DescriptorElement;
})[]): {
    readonly line: number;
    readonly column: number;
};
