package sourcepolicy

import ast "github.com/microsoft/typescript-go/shim/ast"

func qmAnchor(node, fallback *ast.Node) *ast.Node {
	if node != nil {
		return node
	}
	return fallback
}
