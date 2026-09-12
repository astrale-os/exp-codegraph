import type { OccurrenceId } from '../../identity/index.ts';
import type { BodyOccurrence, FunctionBodyIR } from './types.ts';
/** Private semantic view. Structural decoding must complete before this validator runs. */
export interface BodyValidationView extends Omit<FunctionBodyIR, 'occurrences' | 'blocks' | 'relations' | 'edges' | 'definitions' | 'calls'> {
    readonly occurrences: Iterable<BodyOccurrence> & {
        readonly length: number;
    };
    readonly blocks: Iterable<{
        readonly id: string;
        readonly occurrences: Iterable<OccurrenceId>;
    }> & {
        readonly length: number;
    };
    readonly relations: Iterable<FunctionBodyIR['relations'][number]>;
    readonly edges: Iterable<FunctionBodyIR['edges'][number]>;
    readonly definitions: Iterable<FunctionBodyIR['definitions'][number]>;
    readonly calls: Iterable<Omit<FunctionBodyIR['calls'][number], 'callbacks' | 'signature' | 'arguments' | 'bindings'> & {
        readonly arguments: Iterable<OccurrenceId>;
        readonly bindings: Iterable<FunctionBodyIR['calls'][number]['bindings'][number]>;
    }>;
}
/** Already-normalized IDs avoid materializing rows solely to construct identity sets. */
export interface BodyValidationIdentities {
    readonly occurrences: readonly OccurrenceId[];
    readonly blocks: readonly string[];
}
export declare function validateBodyView(body: BodyValidationView, identities?: BodyValidationIdentities): readonly string[];
