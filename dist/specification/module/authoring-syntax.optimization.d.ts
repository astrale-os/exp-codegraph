import ts from 'typescript';
export interface AuthoringSyntaxAnalysis {
    readonly file: ts.SourceFile;
    readonly diagnostics: readonly ts.Diagnostic[];
}
/** Retain immutable source ASTs already parsed by the shared module compiler universe. */
export declare function markAuthoringSyntaxSources(sources: readonly {
    readonly source: string;
    readonly file: ts.SourceFile;
}[]): void;
/** Reuse or create one exact standalone syntax analysis inside the coherent operation. */
export declare function operationAuthoringSyntaxAnalysis(source: string, text: string, create: () => AuthoringSyntaxAnalysis): AuthoringSyntaxAnalysis | undefined;
