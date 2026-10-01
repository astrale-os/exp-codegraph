package main

import ast "github.com/microsoft/typescript-go/shim/ast"

// The qualified compiler constructs fresh anonymous objects from these exact
// own properties. A conditional checks both branches and unions their types.
// Its strict subtype reduction explicitly forbids a nonempty object from being
// removed in favour of a fresh empty object. The values and condition therefore
// cannot change this finite property-name observation. Spreads, computed names,
// accessors, methods, casts, and assignment patterns are outside this quotient.
func governanceEmptyConditionalNames(expression *ast.Node) ([]string, bool) {
	if expression == nil || expression.Kind != ast.KindConditionalExpression {
		return nil, false
	}
	source := ast.GetSourceFileOfNode(expression)
	if source == nil || !governanceOrdinaryTypeSource(source) {
		return nil, false
	}
	conditional := expression.AsConditionalExpression()
	left, right := conditional.WhenTrue, conditional.WhenFalse
	if left.Kind != ast.KindObjectLiteralExpression || right.Kind != ast.KindObjectLiteralExpression {
		return nil, false
	}
	leftProperties, rightProperties := left.AsObjectLiteralExpression().Properties.Nodes, right.AsObjectLiteralExpression().Properties.Nodes
	var properties []*ast.Node
	if len(leftProperties) == 0 {
		properties = rightProperties
	} else if len(rightProperties) == 0 {
		properties = leftProperties
	} else {
		return nil, false
	}
	names := []string{}
	seen := map[string]bool{}
	for _, property := range properties {
		if property.Kind != ast.KindPropertyAssignment || property.Name() == nil || property.Name().Kind != ast.KindIdentifier {
			return nil, false
		}
		name := property.Name().Text()
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names, true
}
