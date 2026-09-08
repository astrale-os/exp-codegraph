import type { CatalogSemanticReference } from '../viewer-host/catalog.ts';
interface CatalogMarkdownDocument {
    readonly text: string;
    readonly html: string;
}
/** Consume internal render markers and project resolved links into ready-to-paint safe HTML. */
export declare function projectMarkdownHtml(document: CatalogMarkdownDocument, references: readonly CatalogSemanticReference[]): string;
export {};
