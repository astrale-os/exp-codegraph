import type { PackagedNativeAnalysisOptions, ResolvedPackagedNativeAnalysis } from './model.ts';
/** Resolve and validate one explicit or package-delivered native analyzer without building it. */
export declare function resolvePackagedNativeAnalysis(options?: PackagedNativeAnalysisOptions): Promise<ResolvedPackagedNativeAnalysis>;
