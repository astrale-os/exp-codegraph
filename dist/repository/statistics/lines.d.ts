import ts from 'typescript';
import type { RepositorySourceLineAnalyzer, RepositorySourceLineInput, SourceLineMetrics } from './model.ts';
/** Exact scanner-backed line classification for the TypeScript/JavaScript language family. */
export declare function createTypeScriptSourceLineAnalyzer(): RepositorySourceLineAnalyzer;
/**
 * Conservative fallback for text formats without a registered language adapter.
 * Physical and blank lines remain exact; non-blank content remains explicitly unclassified.
 */
export declare function createTextSourceLineAnalyzer(): RepositorySourceLineAnalyzer;
export declare function defaultRepositorySourceLineAnalyzers(): readonly RepositorySourceLineAnalyzer[];
/** Classify physical source lines through the TypeScript scanner, never text heuristics. */
export declare function typeScriptSourceLines(source: ts.SourceFile): SourceLineMetrics;
export declare function textSourceLines(text: string): SourceLineMetrics;
export declare function physicalSourceLines(text: string): number;
export declare function emptySourceLines(): SourceLineMetrics;
export declare function analyzeSourceLines(input: RepositorySourceLineInput, analyzers?: readonly RepositorySourceLineAnalyzer[]): {
    readonly metrics: SourceLineMetrics;
    readonly analyzer: RepositorySourceLineAnalyzer;
};
