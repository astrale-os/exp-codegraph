import type { MarkdownDocument } from './model.ts';
export declare const MAX_MARKDOWN_BYTES: number;
export declare function loadMarkdown(root: string, containingFile: string, reference: string): Promise<MarkdownDocument>;
