import type { MarkdownDocument } from './model.ts';
export interface MarkdownInlineCodeSpan {
    readonly from: number;
    readonly to: number;
    readonly value: string;
    readonly linked: boolean;
}
export declare function renderMarkdown(text: string): string;
/** Build one catalog document while retaining analysis outside its JSON shape. */
export declare function renderMarkdownDocument(source: string, text: string, fragment?: string): MarkdownDocument;
/** Reuse the Markdown render pass to expose unlinked inline-code source spans. */
export declare function markdownInlineCodeSpans(value: string | MarkdownDocument): readonly MarkdownInlineCodeSpan[];
