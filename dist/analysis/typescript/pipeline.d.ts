import type { TypeScriptAnalysisPipelineOptions, TypeScriptAnalysisService } from './model.ts';
/**
 * Compose one private resident compiler lineage with portable passes and publish
 * exactly one complete generation to the caller-owned store.
 */
export declare function createTypeScriptAnalysisPipeline(options: TypeScriptAnalysisPipelineOptions): Promise<TypeScriptAnalysisService>;
