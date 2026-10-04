package observabledecision

import (
	js "astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
)

// originalObjectLiteral retains the pre-removal builder and AST-key map only
// as a test oracle. Spread evaluation and downstream interpretation use the
// unchanged demand engine; this is a constructor boundary oracle, not a second
// interpreter or a whole native authority implementation.
func originalObjectLiteral(r *demandRun, path string, node *ast.Node, env map[string]demandValue) (demandValue, []string) {
	oldAST := map[string]*ast.Node{}
	value := demandValue{kind: "object", properties: map[string]demandValue{}, module: path, node: node, env: env}
	clear := func() {
		oldAST = map[string]*ast.Node{}
		value.properties = map[string]demandValue{}
		value.incomplete = true
	}
	for _, property := range node.AsObjectLiteralExpression().Properties.Nodes {
		if property.Kind == ast.KindSpreadAssignment {
			spread := r.eval(path, property.AsSpreadAssignment().Expression, env)
			if spread.kind != "object" {
				clear()
				continue
			}
			if spread.incomplete {
				clear()
			}
			for key, reference := range spread.properties {
				value.properties[key] = reference
				oldAST[key] = reference.node
			}
			continue
		}
		name := property.Name()
		key := ""
		if name != nil {
			switch name.Kind {
			case ast.KindIdentifier:
				key = name.Text()
			case ast.KindStringLiteral, ast.KindNumericLiteral:
				if name.Kind == ast.KindStringLiteral {
					if text, err := js.FromLiteral(r.observer.modules[path].file.Source, name); err == nil {
						key = text.WTF8()
					}
				} else {
					key = name.Text()
				}

			}
		}
		if key == "" {
			clear()
			continue
		}
		var initializer *ast.Node
		switch property.Kind {
		case ast.KindPropertyAssignment:
			initializer = property.AsPropertyAssignment().Initializer
		case ast.KindShorthandPropertyAssignment:
			initializer = name
		case ast.KindMethodDeclaration:
			initializer = property
		}
		if initializer != nil {
			admitted, known := r.expressionAdmission(path, initializer)
			if !known {
				return demandUnknown("Captured bounded expression admission authority is unavailable."), nil
			}
			if !admitted {
				initializer = nil
			}
		}
		if initializer == nil {
			delete(oldAST, key)
			delete(value.properties, key)
			value.incomplete = true
			continue
		}
		oldAST[key] = initializer
		value.properties[key] = demandValue{kind: "reference", node: initializer, module: path, env: env}
	}
	keys := []string{}
	for key := range oldAST {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return value, keys
}
