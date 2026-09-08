import type { FactTransaction } from '../../../generation/index.ts';
import type { AnalysisQuery } from '../../../query/index.ts';
import { IndexedValues } from './facts.ts';
/** Project-local ownership: one current revision plus explicit snapshot leases, with no history chain. */
export declare class ValueIndexOwner {
    #private;
    committed(transaction: FactTransaction): void;
    acquire(query: AnalysisQuery): {
        load(): Promise<IndexedValues>;
        release(): void;
    };
    close(): void;
    private load;
}
