import { type Completeness } from '../../facts/index.ts';
import type { FactTransaction } from '../../generation/index.ts';
import type { FactId, SymbolId } from '../../identity/index.ts';
import type { AnalysisQuery, CapabilityStatus } from '../../query/index.ts';
import { type TypeScriptFact } from '../facts/index.ts';
import { ValueIndexTable } from '../value/symbolic/table.ts';
import type { TypeScriptStructureFact } from './model.ts';
type File = TypeScriptFact<'structure'>;
export interface ReferenceEntry {
    readonly file: File;
    readonly reference: TypeScriptStructureFact['references'][number];
}
export interface DependencyEntry {
    readonly file: File;
    readonly dependency: TypeScriptStructureFact['dependencies'][number];
}
export interface StructuralRevision {
    readonly token: object;
    readonly parent?: object;
    readonly selection: 'typescript.structure/v1';
    readonly changed: ReadonlySet<string>;
}
export declare const structuralKey: {
    paths: string;
    capability: string;
    file: (path: string) => string;
    path: (path: string) => string;
    references: (symbol: SymbolId, path?: string) => string;
    incoming: (path: string) => string;
    coverage: (kind: 'exports' | 'references' | 'dependencies', path?: string) => string;
    origin: string;
};
/** One shared structural graph: immutable postings reuse unchanged source contributions. */
export declare class StructuralIndex {
    readonly revision: StructuralRevision;
    readonly facts: ValueIndexTable<FactId, File>;
    readonly files: ValueIndexTable<string, File>;
    readonly references: ValueIndexTable<SymbolId, ValueIndexTable<string, readonly ReferenceEntry[]>>;
    readonly incoming: ValueIndexTable<string, ValueIndexTable<string, readonly DependencyEntry[]>>;
    readonly capability: Completeness;
    readonly accounted: ValueIndexTable<string, number>;
    constructor(facts?: ValueIndexTable<FactId, File>, files?: ValueIndexTable<string, File>, references?: ValueIndexTable<SymbolId, ValueIndexTable<string, readonly ReferenceEntry[]>>, incoming?: ValueIndexTable<string, ValueIndexTable<string, readonly DependencyEntry[]>>, capability?: Completeness, revision?: StructuralRevision, accounted?: ValueIndexTable<string, number>);
    update(upserts: readonly File[], deletes: readonly FactId[], capabilities: readonly CapabilityStatus[]): StructuralIndex;
}
/** Retains the current graph and explicitly pinned readers, never an unbounded revision chain. */
export declare class StructuralIndexOwner {
    #private;
    committed(transaction: FactTransaction): void;
    acquire(query: AnalysisQuery): {
        load(): Promise<StructuralIndex>;
        release(): void;
    };
    close(): void;
    private load;
}
export {};
