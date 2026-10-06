package main

import shimast "github.com/microsoft/typescript-go/shim/ast"

// One owned-body grammar serves the complete public materializer and thin
// admission. Consumer effects run synchronously before child enumeration;
// nested function roots are values, while their bodies own separate traversals.
func walkOwnedBody(node *shimast.Node, observe func(*shimast.Node, string, bool)) {
	if node == nil || shimast.IsPartOfTypeNode(node) {
		return
	}
	switch node.Kind {
	case shimast.KindInterfaceDeclaration, shimast.KindTypeAliasDeclaration,
		shimast.KindImportDeclaration, shimast.KindExportDeclaration,
		shimast.KindClassDeclaration, shimast.KindClassExpression, shimast.KindModuleDeclaration:
		return
	}
	if shimast.IsFunctionLike(node) {
		if node.Body() != nil {
			observe(node, "expression", true)
		}
		return
	}
	observe(node, bodyKind(node), false)
	node.ForEachChild(func(child *shimast.Node) bool {
		walkOwnedBody(child, observe)
		return false
	})
}
