import ts from 'typescript';
/** Visit authored static and dynamic module references in source order. */
export declare function visitModuleReferences(file: ts.SourceFile, visit: (specifier: string, node: ts.StringLiteralLike, dynamic: boolean) => void): void;
