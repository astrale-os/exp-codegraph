import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
/** Observe static module references without assigning architecture-specific ownership semantics. */
export function typeScriptDependencyReferences(source, checker) {
    const references = [];
    const unresolved = [];
    const add = (specifier, node, kind, typeOnly) => {
        references.push({ specifier, node, kind, typeOnly });
    };
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
            for (const edge of importEdges(node)) {
                add(node.moduleSpecifier.text, node.moduleSpecifier, edge.kind, edge.typeOnly);
            }
        }
        else if (ts.isExportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)) {
            add(node.moduleSpecifier.text, node.moduleSpecifier, 'export', exportIsTypeOnly(node));
        }
        else if (ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            node.moduleReference.expression &&
            ts.isStringLiteralLike(node.moduleReference.expression)) {
            add(node.moduleReference.expression.text, node.moduleReference.expression, 'runtime', false);
        }
        else if (ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteralLike(node.argument.literal)) {
            add(node.argument.literal.text, node.argument.literal, 'type', true);
        }
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const argument = node.arguments[0];
            if (argument && ts.isStringLiteralLike(argument)) {
                add(argument.text, argument, 'dynamic', false);
            }
            else {
                unresolved.push({ kind: 'dynamic', node: argument ?? node });
            }
        }
        else if (ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require' &&
            isModuleRequire(checker, node.expression)) {
            const argument = node.arguments[0];
            if (argument && ts.isStringLiteralLike(argument)) {
                add(argument.text, argument, 'runtime', false);
            }
            else {
                unresolved.push({ kind: 'require', node: argument ?? node });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { references, unresolved };
}
export function resolveTypeScriptModuleFile(project, source, specifier) {
    const result = ts.resolveModuleName(specifier, source.fileName, project.program.getCompilerOptions(), ts.sys).resolvedModule;
    if (!result?.resolvedFileName)
        return;
    const file = resolve(result.resolvedFileName);
    try {
        return realpathSync(file);
    }
    catch {
        return file;
    }
}
function importEdges(node) {
    const clause = node.importClause;
    if (!clause)
        return [{ kind: 'side-effect', typeOnly: false }];
    if (clause.isTypeOnly)
        return [{ kind: 'type', typeOnly: true }];
    let runtime = Boolean(clause.name);
    let typeOnly = false;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
        runtime = true;
    if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
            if (element.isTypeOnly)
                typeOnly = true;
            else
                runtime = true;
        }
    }
    return [
        ...(runtime ? [{ kind: 'runtime', typeOnly: false }] : []),
        ...(typeOnly ? [{ kind: 'type', typeOnly: true }] : []),
    ];
}
function exportIsTypeOnly(node) {
    if (node.isTypeOnly)
        return true;
    return Boolean(node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly));
}
function isModuleRequire(checker, identifier) {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (!symbol)
        return true;
    return (symbol.declarations ?? []).every((declaration) => declaration.getSourceFile().isDeclarationFile);
}
//# sourceMappingURL=dependencies.js.map