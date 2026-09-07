import type { MarkdownDocument } from '../../markdown/model.ts';
export interface MarkdownSemanticMention {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly label: string;
    readonly call: boolean;
}
/** Extract only code-shaped, unlinked Markdown mentions that may name a declaration. */
export declare function markdownSemanticMentions(document: MarkdownDocument): readonly MarkdownSemanticMention[];
