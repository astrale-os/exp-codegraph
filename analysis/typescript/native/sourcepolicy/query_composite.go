package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"regexp"
)

type qmComposeBuilder struct {
	owner, root *ast.Node
	bindings    map[string]*ast.Node
}

func qmCompose(fn *ast.Node) *qmComposeBuilder {
	parameters := fn.Parameters()
	if len(parameters) == 0 {
		return nil
	}
	name := parameters[0].Name()
	b := &qmComposeBuilder{owner: fn, bindings: map[string]*ast.Node{}}
	if name.Kind == ast.KindIdentifier {
		b.root = name
		return b
	}
	if name.Kind != ast.KindObjectBindingPattern {
		return nil
	}
	for _, element := range name.AsBindingPattern().Elements.Nodes {
		if element.Kind != ast.KindBindingElement {
			return nil
		}
		e := element.AsBindingElement()
		if e.DotDotDotToken != nil || e.Name().Kind != ast.KindIdentifier {
			return nil
		}
		source := e.Name().Text()
		if e.PropertyName != nil {
			if e.PropertyName.Kind != ast.KindIdentifier && e.PropertyName.Kind != ast.KindStringLiteral {
				return nil
			}
			source = e.PropertyName.Text()
		}
		if source != "query" && source != "union" && source != "combine" {
			continue
		}
		if b.bindings[source] != nil {
			return nil
		}
		b.bindings[source] = e.Name()
	}
	if len(b.bindings) == 0 {
		return nil
	}
	return b
}
func qmEnclosingFunction(node *ast.Node) *ast.Node {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return n
		}
	}
	return nil
}
func qmComposeListShadows(list *ast.Node, name string, scope, owner *ast.Node) bool {
	found := false
	for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
		if authored.BindingContains(d.Name(), name) {
			found = true
		}
	}
	return found && (list.Flags&ast.NodeFlagsBlockScoped != 0 || qmEnclosingFunction(scope) != owner)
}
func qmComposeStatementShadows(statement *ast.Node, name string, scope, owner *ast.Node) bool {
	if statement.Kind == ast.KindVariableStatement {
		return qmComposeListShadows(statement.AsVariableStatement().DeclarationList, name, scope, owner)
	}
	if statement.Kind == ast.KindFunctionDeclaration {
		return scope != owner.Body() && statement.Name() != nil && statement.Name().Text() == name
	}
	switch statement.Kind {
	case ast.KindClassDeclaration, ast.KindEnumDeclaration, ast.KindModuleDeclaration:
		return statement.Name() != nil && statement.Name().Text() == name
	}
	return false
}
func qmComposeReference(reference, binding, owner *ast.Node) bool {
	if reference == nil || binding == nil || reference.Kind != ast.KindIdentifier || reference.Text() != binding.Text() {
		return false
	}
	name := reference.Text()
	for n := reference.Parent; n != nil; n = n.Parent {
		if n == owner {
			return true
		}
		if (n.Kind == ast.KindClassExpression || n.Kind == ast.KindClassDeclaration) && n.Name() != nil && n.Name().Text() == name {
			return false
		}
		if ast.IsFunctionLike(n) {
			for _, p := range n.Parameters() {
				if authored.BindingContains(p.Name(), name) {
					return false
				}
			}
		}
		if n.Kind == ast.KindCatchClause {
			v := n.AsCatchClause().VariableDeclaration
			if v != nil && authored.BindingContains(v.Name(), name) {
				return false
			}
		}
		if n.Kind == ast.KindBlock || n.Kind == ast.KindModuleBlock {
			if list := n.StatementList(); list != nil {
				for _, s := range list.Nodes {
					if qmComposeStatementShadows(s, name, n, owner) {
						return false
					}
				}
			}
		}
		if n.Kind == ast.KindCaseBlock {
			for _, clause := range n.AsCaseBlock().Clauses.Nodes {
				for _, s := range clause.StatementList().Nodes {
					if qmComposeStatementShadows(s, name, n, owner) {
						return false
					}
				}
			}
		}
		var initializer *ast.Node
		switch n.Kind {
		case ast.KindForStatement:
			initializer = n.AsForStatement().Initializer
		case ast.KindForInStatement, ast.KindForOfStatement:
			initializer = n.AsForInOrOfStatement().Initializer
		}
		if initializer != nil && initializer.Kind == ast.KindVariableDeclarationList && qmComposeListShadows(initializer, name, n, owner) {
			return false
		}
	}
	return false
}
func (b *qmComposeBuilder) method(expression *ast.Node) string {
	target := authored.Unwrap(expression)
	if b.root != nil && target.Kind == ast.KindPropertyAccessExpression {
		p := target.AsPropertyAccessExpression()
		name := p.Name().Text()
		if (name == "query" || name == "union" || name == "combine") && qmComposeReference(authored.Unwrap(p.Expression), b.root, b.owner) {
			return name
		}
	}
	if target.Kind == ast.KindIdentifier {
		for _, name := range []string{"query", "union", "combine"} {
			if qmComposeReference(target, b.bindings[name], b.owner) {
				return name
			}
		}
	}
	return ""
}

var qmStableID = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)
