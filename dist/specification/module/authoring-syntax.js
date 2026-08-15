import ts from 'typescript';
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
export function syntaxDiagnostics(source, text) {
    const result = ts.transpileModule(text, {
        fileName: source,
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 },
    });
    return (result.diagnostics ?? [])
        .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
        .map((entry) => {
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
    });
}
export function nodeDiagnostic(code, message, source, file, node) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { code, message, file: source, line: position.line + 1, column: position.character + 1 };
}
//# sourceMappingURL=authoring-syntax.js.map