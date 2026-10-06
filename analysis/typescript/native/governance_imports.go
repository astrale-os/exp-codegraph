package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func governanceLiteral(node *ast.Node) bool {
	return node != nil && (node.Kind == ast.KindStringLiteral || node.Kind == ast.KindNoSubstitutionTemplateLiteral)
}

// Preserve the original SDK's decoded UTF16 module specifier, including lone
// surrogates. Literal.Text normalizes those to replacement characters. The
// shared existing decoder owns quoted/template literal semantics; retain the
// old Text result only when that decoder reports unsupported/invalid syntax.
func governanceImportSpecifierText(file *ast.SourceFile, literal *ast.Node) string {
	if value, err := jsstring.FromLiteral(file, literal); err == nil {
		return value.WTF8()
	}
	return literal.Text()
}

func governanceCollectImports(file *ast.SourceFile, verbatim bool) []governanceImport {
	result := []governanceImport{}
	for _, statement := range file.Statements.Nodes {
		switch statement.Kind {
		case ast.KindImportDeclaration:
			d := statement.AsImportDeclaration()
			if d.ModuleSpecifier.Kind != ast.KindStringLiteral {
				continue
			}
			typeOnly := false
			if d.ImportClause != nil {
				c := d.ImportClause.AsImportClause()
				typeOnly = c.IsTypeOnly()
				if !verbatim && c.Name() == nil && c.NamedBindings != nil && c.NamedBindings.Kind == ast.KindNamedImports {
					elements := c.NamedBindings.AsNamedImports().Elements.Nodes
					all := len(elements) > 0
					for _, e := range elements {
						all = all && e.AsImportSpecifier().IsTypeOnly
					}
					typeOnly = typeOnly || all
				}
			}
			bindings, namespace := authoredsource.CollectImportBindings(statement)
			result = append(result, governanceImport{Specifier: governanceImportSpecifierText(file, d.ModuleSpecifier), TypeOnly: typeOnly, Node: statement, Bindings: bindings, Namespace: namespace})
		case ast.KindExportDeclaration:
			d := statement.AsExportDeclaration()
			if d.ModuleSpecifier == nil || d.ModuleSpecifier.Kind != ast.KindStringLiteral {
				continue
			}
			typeOnly := d.IsTypeOnly
			if !verbatim && d.ExportClause != nil && d.ExportClause.Kind == ast.KindNamedExports {
				elements := d.ExportClause.AsNamedExports().Elements.Nodes
				all := len(elements) > 0
				for _, e := range elements {
					all = all && e.AsExportSpecifier().IsTypeOnly
				}
				typeOnly = typeOnly || all
			}
			result = append(result, governanceImport{Specifier: governanceImportSpecifierText(file, d.ModuleSpecifier), TypeOnly: typeOnly, Node: statement})
		}
	}
	var visit func(*ast.Node)
	visit = func(node *ast.Node) {
		if node.Kind == ast.KindImportType {
			arg := node.AsImportTypeNode().Argument
			if arg != nil && arg.Kind == ast.KindLiteralType && governanceLiteral(arg.AsLiteralTypeNode().Literal) {
				result = append(result, governanceImport{Specifier: governanceImportSpecifierText(file, arg.AsLiteralTypeNode().Literal), TypeOnly: true, Node: node})
			}
		}
		if node.Kind == ast.KindCallExpression {
			c := node.AsCallExpression()
			if c.Expression.Kind == ast.KindImportKeyword && c.Arguments != nil && len(c.Arguments.Nodes) == 1 && c.Arguments.Nodes[0].Kind == ast.KindStringLiteral {
				result = append(result, governanceImport{Specifier: governanceImportSpecifierText(file, c.Arguments.Nodes[0]), Dynamic: true, Node: node})
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	}
	file.AsNode().ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	return result
}
