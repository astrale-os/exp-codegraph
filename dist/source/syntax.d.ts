export interface SourceSyntaxToken {
    readonly text: string;
    readonly classes?: string;
}
export interface HighlightedSourceCode {
    readonly language: string;
    readonly tokens: readonly SourceSyntaxToken[];
}
/** Highlight an explicitly supported language or conservatively infer an unlabeled block. */
export declare function highlightSourceCode(code: string, declaredLanguage?: string | null): HighlightedSourceCode | undefined;
/** Map a file-backed source resource to the same language aliases accepted by code fences. */
export declare function sourceLanguage(source: string): string | undefined;
/** Serialize trusted parser tokens while escaping every source character. */
export declare function highlightedSourceHtml(source: HighlightedSourceCode): string;
