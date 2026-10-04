package observabledecision

import (
	js "astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func (r *demandRun) objectLiteral(path string, node *ast.Node, env map[string]demandValue) demandValue {
	value := demandValue{kind: "object", properties: map[string]demandValue{}, module: path, node: node, env: env}
	clear := func() {
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
				return demandUnknown("Captured bounded expression admission authority is unavailable.")
			}
			if !admitted {
				initializer = nil
			}
		}
		if initializer == nil {
			delete(value.properties, key)
			value.incomplete = true
			continue
		}
		value.properties[key] = demandValue{kind: "reference", node: initializer, module: path, env: env}
	}
	return value
}
