package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"math"
	"strconv"
	"strings"
)

type qmComposeValue struct {
	kind string
	node *ast.Node
}

func qmValue(node *ast.Node) qmComposeValue { return qmComposeValue{kind: "value", node: node} }
func qmBindingNodes(declarations []*ast.Node, reference *ast.Node) qmComposeValue {
	if len(declarations) == 0 {
		return qmComposeValue{kind: "none"}
	}
	values := []*ast.Node{}
	opaque := false
	for _, d := range declarations {
		if d.Kind == ast.KindFunctionDeclaration {
			values = append(values, d)
		} else if d.Kind == ast.KindVariableDeclaration {
			if d.Name().Kind != ast.KindIdentifier {
				return qmComposeValue{kind: "ambiguous"}
			}
			initializer := d.AsVariableDeclaration().Initializer
			if initializer == nil {
				opaque = true
			} else if d.Pos() > reference.Pos() {
				return qmComposeValue{kind: "ambiguous"}
			} else {
				values = append(values, initializer)
			}
		} else {
			opaque = true
		}
	}
	if len(values) > 1 {
		return qmComposeValue{kind: "ambiguous"}
	}
	if len(values) == 1 {
		return qmValue(values[0])
	}
	if opaque {
		return qmComposeValue{kind: "opaque"}
	}
	return qmComposeValue{kind: "none"}
}
func qmScopeDeclarations(statements []*ast.Node, includeVar bool, name string) []*ast.Node {
	out := []*ast.Node{}
	for _, s := range statements {
		if s.Kind == ast.KindVariableStatement {
			list := s.AsVariableStatement().DeclarationList
			if list.Flags&ast.NodeFlagsBlockScoped != 0 {
				for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
					if authored.BindingContains(d.Name(), name) {
						out = append(out, d)
					}
				}
			}
		} else if ((!includeVar && s.Kind == ast.KindFunctionDeclaration) || s.Kind == ast.KindClassDeclaration || s.Kind == ast.KindEnumDeclaration || s.Kind == ast.KindModuleDeclaration) && s.Name() != nil && s.Name().Text() == name {
			out = append(out, s)
		}
	}
	return out
}
func qmComposeBinding(reference, compose *ast.Node) qmComposeValue {
	for scope := reference.Parent; scope != nil && scope != compose; scope = scope.Parent {
		if (scope.Kind == ast.KindClassExpression || scope.Kind == ast.KindClassDeclaration) && scope.Name() != nil && scope.Name().Text() == reference.Text() {
			return qmComposeValue{kind: "opaque"}
		}
		if ast.IsFunctionLike(scope) {
			for _, p := range scope.Parameters() {
				if authored.BindingContains(p.Name(), reference.Text()) {
					return qmComposeValue{kind: "opaque"}
				}
			}
			if scope.Name() != nil && scope.Name().Kind == ast.KindIdentifier && scope.Name().Text() == reference.Text() {
				return qmComposeValue{kind: "opaque"}
			}
		}
		if scope.Kind == ast.KindCatchClause {
			d := scope.AsCatchClause().VariableDeclaration
			if d != nil && authored.BindingContains(d.Name(), reference.Text()) {
				return qmComposeValue{kind: "opaque"}
			}
		}
		var initializer *ast.Node
		switch scope.Kind {
		case ast.KindForStatement:
			initializer = scope.AsForStatement().Initializer
		case ast.KindForInStatement, ast.KindForOfStatement:
			initializer = scope.AsForInOrOfStatement().Initializer
		}
		if initializer != nil && initializer.Kind == ast.KindVariableDeclarationList && initializer.Flags&ast.NodeFlagsBlockScoped != 0 {
			declarations := []*ast.Node{}
			for _, d := range initializer.AsVariableDeclarationList().Declarations.Nodes {
				if authored.BindingContains(d.Name(), reference.Text()) {
					declarations = append(declarations, d)
				}
			}
			r := qmBindingNodes(declarations, reference)
			if r.kind != "none" {
				return r
			}
		}
		statements := []*ast.Node{}
		if scope.Kind == ast.KindBlock || scope.Kind == ast.KindModuleBlock {
			statements = scope.StatementList().Nodes
		} else if scope.Kind == ast.KindCaseBlock {
			for _, clause := range scope.AsCaseBlock().Clauses.Nodes {
				statements = append(statements, clause.StatementList().Nodes...)
			}
		}
		if scope.Kind == ast.KindBlock || scope.Kind == ast.KindModuleBlock || scope.Kind == ast.KindCaseBlock {
			r := qmBindingNodes(qmScopeDeclarations(statements, scope == compose.Body(), reference.Text()), reference)
			if r.kind != "none" {
				return r
			}
		}
	}
	owners := []*ast.Node{}
	qmOwn(compose, func(n *ast.Node) {
		if n.Kind == ast.KindVariableDeclaration && n.Parent.Kind == ast.KindVariableDeclarationList && n.Parent.Flags&ast.NodeFlagsBlockScoped == 0 && authored.BindingContains(n.Name(), reference.Text()) {
			owners = append(owners, n)
		}
	})
	if compose.Body() != nil && compose.Body().Kind == ast.KindBlock {
		for _, s := range compose.Body().StatementList().Nodes {
			if s.Kind == ast.KindFunctionDeclaration && s.Name() != nil && s.Name().Text() == reference.Text() {
				owners = append(owners, s)
			}
		}
	}
	r := qmBindingNodes(owners, reference)
	if r.kind != "none" {
		return r
	}
	for _, p := range compose.Parameters() {
		if authored.BindingContains(p.Name(), reference.Text()) {
			return qmComposeValue{kind: "opaque"}
		}
	}
	return qmComposeValue{kind: "none"}
}
func qmMemberKey(expression *ast.Node) (string, bool) {
	if expression == nil {
		return "", false
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindStringLiteral || value.Kind == ast.KindNoSubstitutionTemplateLiteral || value.Kind == ast.KindNumericLiteral {
		return value.Text(), true
	}
	return "", false
}
func qmMember(node *ast.Node) (*ast.Node, string, bool) {
	if node.Kind == ast.KindPropertyAccessExpression {
		p := node.AsPropertyAccessExpression()
		return p.Expression, p.Name().Text(), true
	}
	if node.Kind == ast.KindElementAccessExpression {
		e := node.AsElementAccessExpression()
		key, known := qmMemberKey(e.ArgumentExpression)
		return e.Expression, key, known
	}
	return nil, "", false
}
func qmStaticPropertyKey(name *ast.Node) (string, bool) {
	if name == nil {
		return "", false
	}
	if name.Kind == ast.KindIdentifier || name.Kind == ast.KindStringLiteral || name.Kind == ast.KindNumericLiteral {
		return name.Text(), true
	}
	if name.Kind == ast.KindComputedPropertyName {
		return qmMemberKey(name.AsComputedPropertyName().Expression)
	}
	return "", false
}
func qmResolveComposeNode(node, compose *ast.Node, builder *qmComposeBuilder, seen map[*ast.Node]bool) qmComposeValue {
	if seen[node] || len(seen) >= 64 {
		return qmComposeValue{kind: "ambiguous"}
	}
	seen[node] = true
	value := authored.Unwrap(node)
	if value != node {
		return qmResolveComposeNode(value, compose, builder, seen)
	}
	if node.Kind == ast.KindIdentifier {
		r := qmComposeBinding(node, compose)
		if r.kind == "value" {
			return qmResolveComposeNode(r.node, compose, builder, seen)
		}
		return r
	}
	if node.Kind == ast.KindPropertyAccessExpression || node.Kind == ast.KindElementAccessExpression {
		base, key, known := qmMember(node)
		r := qmResolveComposeNode(base, compose, builder, seen)
		if r.kind != "value" {
			return r
		}
		if !known {
			return qmComposeValue{kind: "ambiguous"}
		}
		projected := qmProjectComposeMember(r.node, key, compose, builder, seen)
		if projected.kind == "value" {
			return qmResolveComposeNode(projected.node, compose, builder, seen)
		}
		return projected
	}
	return qmValue(node)
}
func qmProjectComposeMember(node *ast.Node, key string, compose *ast.Node, builder *qmComposeBuilder, seen map[*ast.Node]bool) qmComposeValue {
	value := authored.Unwrap(node)
	if value.Kind == ast.KindObjectLiteralExpression {
		var candidate *ast.Node
		uncertain := false
		for _, p := range value.AsObjectLiteralExpression().Properties.Nodes {
			if p.Kind == ast.KindSpreadAssignment {
				spread := qmResolveComposeNode(p.AsSpreadAssignment().Expression, compose, builder, seen)
				if spread.kind == "value" {
					projected := qmProjectComposeMember(spread.node, key, compose, builder, seen)
					if projected.kind == "value" {
						candidate = projected.node
						uncertain = false
					} else if projected.kind == "ambiguous" || projected.kind == "opaque" {
						uncertain = true
					}
				} else {
					uncertain = true
				}
				continue
			}
			propertyKey, known := qmStaticPropertyKey(p.Name())
			if !known {
				if p.Name() != nil && p.Name().Kind == ast.KindComputedPropertyName {
					uncertain = true
				}
				continue
			}
			if propertyKey != key {
				continue
			}
			switch p.Kind {
			case ast.KindPropertyAssignment:
				candidate = p.AsPropertyAssignment().Initializer
			case ast.KindShorthandPropertyAssignment:
				candidate = p.Name()
			case ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor:
				candidate = p
			}
			uncertain = false
		}
		if uncertain {
			return qmComposeValue{kind: "ambiguous"}
		}
		if candidate != nil {
			return qmValue(candidate)
		}
		return qmComposeValue{kind: "none"}
	}
	if value.Kind == ast.KindArrayLiteralExpression {
		trimmed := strings.TrimSpace(key)
		index := 0.0
		var err error
		if trimmed != "" {
			index, err = strconv.ParseFloat(trimmed, 64)
			if err != nil {
				if integer, e := strconv.ParseInt(trimmed, 0, 64); e == nil {
					index = float64(integer)
					err = nil
				}
			}
		}
		if err != nil || math.IsNaN(index) || math.IsInf(index, 0) || index < 0 || math.Trunc(index) != index {
			return qmComposeValue{kind: "opaque"}
		}
		for offset, element := range value.AsArrayLiteralExpression().Elements.Nodes {
			if element.Kind == ast.KindSpreadElement {
				return qmComposeValue{kind: "ambiguous"}
			}
			if float64(offset) == index {
				if element.Kind == ast.KindOmittedExpression {
					return qmComposeValue{kind: "none"}
				}
				return qmValue(element)
			}
		}
		return qmComposeValue{kind: "none"}
	}
	return qmComposeValue{kind: "ambiguous"}
}
func qmStaticProjection(member, compose *ast.Node, builder *qmComposeBuilder) qmComposeValue {
	base, key, known := qmMember(member)
	r := qmResolveComposeNode(base, compose, builder, map[*ast.Node]bool{})
	if r.kind != "value" {
		return r
	}
	if !known {
		return qmComposeValue{kind: "ambiguous"}
	}
	return qmProjectComposeMember(r.node, key, compose, builder, map[*ast.Node]bool{})
}
func qmSymbolicMember(member, compose *ast.Node, builder *qmComposeBuilder) bool {
	for current := member; current.Kind == ast.KindPropertyAccessExpression || current.Kind == ast.KindElementAccessExpression; {
		base, key, known := qmMember(current)
		if known && key == "value" {
			r := qmResolveComposeNode(base, compose, builder, map[*ast.Node]bool{})
			if r.kind == "value" && r.node.Kind == ast.KindCallExpression && builder.method(r.node.AsCallExpression().Expression) != "" {
				return true
			}
		}
		current = authored.Unwrap(base)
	}
	return false
}
func qmResultCallback(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindFunctionDeclaration, ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor:
		return true
	}
	return false
}
func qmComposeChildren(node *ast.Node, visit func(*ast.Node), methods bool) {
	switch node.Kind {
	case ast.KindObjectLiteralExpression:
		for _, p := range node.AsObjectLiteralExpression().Properties.Nodes {
			switch p.Kind {
			case ast.KindPropertyAssignment:
				visit(p.AsPropertyAssignment().Initializer)
			case ast.KindShorthandPropertyAssignment:
				visit(p.Name())
			case ast.KindSpreadAssignment:
				visit(p.AsSpreadAssignment().Expression)
			case ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor:
				if methods {
					visit(p)
				}
			}
		}
	case ast.KindArrayLiteralExpression:
		for _, e := range node.AsArrayLiteralExpression().Elements.Nodes {
			if e.Kind == ast.KindSpreadElement {
				visit(e.AsSpreadElement().Expression)
			} else {
				visit(e)
			}
		}
	case ast.KindConditionalExpression:
		c := node.AsConditionalExpression()
		visit(c.WhenTrue)
		visit(c.WhenFalse)
	case ast.KindBinaryExpression:
		b := node.AsBinaryExpression()
		switch b.OperatorToken.Kind {
		case ast.KindAmpersandAmpersandToken, ast.KindBarBarToken, ast.KindQuestionQuestionToken:
			visit(b.Left)
			visit(b.Right)
		case ast.KindCommaToken:
			visit(b.Right)
		}
	default:
		value := authored.Unwrap(node)
		if value != node {
			visit(value)
		}
	}
}
