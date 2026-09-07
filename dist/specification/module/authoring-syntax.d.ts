import ts from 'typescript';
import type { Diagnostic } from '../../source/diagnostic.ts';
export declare const AUTHORING_SPECIFIER = "@astrale-os/codegraph/authoring";
/** Temporary source-compatible spelling retained while repositories migrate to Codegraph. */
export declare const AUTHORING_SPECIFIER_ALIASES: readonly ["@astrale-os/codegraph/authoring", '@astrale-os/spec/authoring'];
export declare function isAuthoringSpecifier(value: string): boolean;
export declare function authoringHelperBinding(file: ts.SourceFile, imported: string): string | undefined;
/** Resolve one statically inspectable helper call without evaluating authoring code. */
export declare function calledObjectLiteral(expression: ts.Expression, helper: string | undefined): ts.ObjectLiteralExpression | undefined;
export declare function literalProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined;
export declare function literalPropertyName(name: ts.PropertyName): string | undefined;
export declare function plainStringLiteral(expression: ts.Expression): string | undefined;
/** Reuse an admitted compiler-universe AST or parse the standalone authored source exactly once. */
export declare function authoredSourceFile(source: string, text: string): ts.SourceFile;
export declare function syntaxDiagnostics(source: string, text: string): Diagnostic[];
export declare function nodeDiagnostic(code: string, message: string, source: string, file: ts.SourceFile, node: ts.Node): Diagnostic;
