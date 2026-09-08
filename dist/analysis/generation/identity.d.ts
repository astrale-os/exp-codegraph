import type { FactShardReference } from '../facts/index.ts';
import { type AnalysisGenerationId } from '../identity/index.ts';
import type { AnalysisGeneration } from './types.ts';
export declare function hashGenerationIdentity(generation: Omit<AnalysisGeneration, 'id' | 'sequence'>, manifest: readonly FactShardReference[]): AnalysisGenerationId;
