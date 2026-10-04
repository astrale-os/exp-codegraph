package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	js "astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func qmText(node *ast.Node) (string, bool) {
	if node == nil {
		return "", false
	}
	value := authored.Unwrap(node)
	if value.Kind == ast.KindStringLiteral || value.Kind == ast.KindNoSubstitutionTemplateLiteral {
		literal, err := js.FromNode(value)
		if err != nil {
			return "", false
		}
		return literal.WTF8(), true
	}
	return authored.StaticText(node)
}
