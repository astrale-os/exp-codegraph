import type { AnalysisGenerationId } from '../../identity/index.ts';
import type { FactFilter } from '../../query/index.ts';
export declare function encodeSQLiteCursor(generation: AnalysisGenerationId, filter: FactFilter, lastFact: string): string;
export declare function decodeSQLiteCursor(cursor: string, generation: AnalysisGenerationId, filter: FactFilter): string;
