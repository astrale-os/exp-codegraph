import ts from 'typescript';
/** Visit authored static and dynamic module references in source order. */
export function visitModuleReferences(file, visit) {
    const walk = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)) {
            visit(node.moduleSpecifier.text, node.moduleSpecifier, false);
        }
        else if (ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)) {
            visit(node.argument.literal.text, node.argument.literal, false);
        }
        else if (ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])) {
            visit(node.arguments[0].text, node.arguments[0], true);
        }
        ts.forEachChild(node, walk);
    };
    walk(file);
}
//# sourceMappingURL=typescript-reference.js.map