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
