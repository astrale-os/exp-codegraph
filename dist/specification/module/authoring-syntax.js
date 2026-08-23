import ts from 'typescript';
import { operationAuthoringSyntaxAnalysis, } from './authoring-syntax.optimization.js';
export const AUTHORING_SPECIFIER = '@astrale-os/codegraph/authoring';
/** Temporary source-compatible spelling retained while repositories migrate to Codegraph. */
export const AUTHORING_SPECIFIER_ALIASES = [
    AUTHORING_SPECIFIER,
    '@astrale-os/spec/authoring',
];
export function isAuthoringSpecifier(value) {
    return AUTHORING_SPECIFIER_ALIASES.includes(value);
}
export function authoringHelperBinding(file, imported) {
    for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !isAuthoringSpecifier(statement.moduleSpecifier.text))
            continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings))
            continue;
        for (const binding of bindings.elements) {
            if ((binding.propertyName?.text ?? binding.name.text) === imported)
                return binding.name.text;
        }
    }
    return;
}
/** Resolve one statically inspectable helper call without evaluating authoring code. */
export function calledObjectLiteral(expression, helper) {
    if (!helper ||
        !ts.isCallExpression(expression) ||
        !ts.isIdentifier(expression.expression) ||
        expression.expression.text !== helper ||
        expression.arguments.length !== 1)
        return;
    const argument = expression.arguments[0];
    return argument && ts.isObjectLiteralExpression(argument) ? argument : undefined;
}
export function literalProperty(object, name) {
    return object.properties.find((member) => ts.isPropertyAssignment(member) && literalPropertyName(member.name) === name);
}
export function literalPropertyName(name) {
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name))
        return;
    const value = name.text;
    return value.trim() === value && value && value !== '__proto__' ? value : undefined;
}
export function plainStringLiteral(expression) {
    return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
        ? expression.text
        : undefined;
}
/** Reuse an admitted compiler-universe AST or parse the standalone authored source exactly once. */
export function authoredSourceFile(source, text) {
    return operationAuthoringSyntaxAnalysis(source, text, () => standaloneAnalysis(source, text))
        ?.file ?? ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
export function syntaxDiagnostics(source, text) {
    const entries = operationAuthoringSyntaxAnalysis(source, text, () => standaloneAnalysis(source, text))?.diagnostics ?? transpileDiagnostics(source, text);
    return entries
        .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
        .map((entry) => compilerDiagnostic(source, entry));
}
function standaloneAnalysis(source, text) {
    return {
        file: ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
        diagnostics: transpileDiagnostics(source, text),
    };
}
function transpileDiagnostics(source, text) {
    return ts.transpileModule(text, {
        fileName: source,
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 },
    }).diagnostics ?? [];
}
function compilerDiagnostic(source, entry) {
    const position = entry.file && entry.start !== undefined
        ? entry.file.getLineAndCharacterOfPosition(entry.start)
        : undefined;
    return {
        code: `MODULE_TYPESCRIPT_${entry.code}`,
        message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
        file: source,
        line: (position?.line ?? 0) + 1,
        column: (position?.character ?? 0) + 1,
    };
}
export function nodeDiagnostic(code, message, source, file, node) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { code, message, file: source, line: position.line + 1, column: position.character + 1 };
}
//# sourceMappingURL=authoring-syntax.js.map