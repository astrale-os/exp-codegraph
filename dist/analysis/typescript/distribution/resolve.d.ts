import type { PackagedNativeAnalysisOptions, ResolvedPackagedNativeAnalysis, ResolvedPackagedNativeOxlint } from './model.ts';
/** Resolve and validate one explicit or package-delivered native analyzer without building it. */
export declare function resolvePackagedNativeAnalysis(options?: PackagedNativeAnalysisOptions): Promise<ResolvedPackagedNativeAnalysis>;
/** Resolve the generic worker independently so the original analyzer can recover without it. */
export declare function resolvePackagedNativeOxlint(): Promise<ResolvedPackagedNativeOxlint>;
