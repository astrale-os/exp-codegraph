package observabledecision

import (
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
)

// These demand-local records retain only selected lexical writes and returns.
// They do not materialize a control-flow graph or transport a generic body IR.
type demandFlow struct {
	returns                        []*ast.Node
	fallsThrough, linear, complete bool
}

func inspectDemandFlow(function *ast.Node) demandFlow {
	result := demandFlow{linear: true, complete: true}
	body := function.Body()
	if body == nil {
		result.complete = false
		return result
	}
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node != body && ast.IsFunctionLike(node) {
			return
		}
		if ast.IsPartOfTypeNode(node) {
			return
		}
		switch node.Kind {
		case ast.KindClassDeclaration, ast.KindClassExpression, ast.KindModuleDeclaration:
			result.complete = false
			result.linear = false
			return
		case ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration:
			return
		case ast.KindReturnStatement:
			result.returns = append(result.returns, node)
		case ast.KindIfStatement, ast.KindWhileStatement, ast.KindDoStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement, ast.KindConditionalExpression:
			result.linear = false
		case ast.KindSwitchStatement, ast.KindTryStatement, ast.KindWithStatement, ast.KindLabeledStatement:
			result.complete = false
			result.linear = false
		case ast.KindBinaryExpression:
			op := node.AsBinaryExpression().OperatorToken.Kind
			if op == ast.KindAmpersandAmpersandToken || op == ast.KindBarBarToken || op == ast.KindQuestionQuestionToken {
				result.linear = false
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(body)
	if body.Kind != ast.KindBlock {
		result.returns = []*ast.Node{body}
	} else {
		for _, kind := range statementExitKinds(body) {
			if kind == "fallthrough" {
				result.fallsThrough = true
			}
		}
	}
	return result
}
func statementExitKinds(node *ast.Node) []string {
	if node == nil {
		return []string{"empty"}
	}
	switch node.Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement:
		return nil
	case ast.KindBlock:
		exits := []string{"fallthrough"}
		for _, statement := range node.AsBlock().Statements.Nodes {
			if len(exits) > 0 {
				exits = statementExitKinds(statement)
			}
		}
		return exits
	case ast.KindIfStatement:
		s := node.AsIfStatement()
		left, right := statementExitKinds(s.ThenStatement), statementExitKinds(s.ElseStatement)
		for i, kind := range left {
			if kind == "empty" {
				left[i] = "true"
			}
		}
		for i, kind := range right {
			if kind == "empty" {
				right[i] = "false"
			}
		}
		return append(left, right...)
	case ast.KindWhileStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
		return []string{"false"}
	default:
		return []string{"fallthrough"}
	}
}
func ancestorContains(scope, node *ast.Node) bool {
	for current := node; current != nil; current = current.Parent {
		if current == scope {
			return true
		}
	}
	return false
}
func lexicalDeclarationScope(name *ast.Node, function *ast.Node) *ast.Node {
	if name.Parent != nil && name.Parent.Kind == ast.KindVariableDeclaration {
		list := name.Parent.Parent
		if list != nil && list.Kind == ast.KindVariableDeclarationList && list.Flags&ast.NodeFlagsBlockScoped == 0 {
			return function
		}
	}
	for node := name.Parent; node != nil && node != function; node = node.Parent {
		switch node.Kind {
		case ast.KindBlock, ast.KindCaseBlock, ast.KindCatchClause, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
			return node
		}
	}
	return function
}

type localDemandBinding struct {
	definitions, initializers []*ast.Node
	definite                  bool
	assignment                *ast.Node
	found                     bool
}

func selectedLocalBinding(function, identifier *ast.Node, flow demandFlow) localDemandBinding {
	result := localDemandBinding{}
	name := identifier.Text()
	declarations := []*ast.Node{}
	for _, parameter := range function.Parameters() {
		if parameter.Name() != nil && parameter.Name().Kind == ast.KindIdentifier && parameter.Name().Text() == name {
			declarations = append(declarations, parameter.Name())
		}
	}
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node != function.Body() && ast.IsFunctionLike(node) {
			return
		}
		if ast.IsPartOfTypeNode(node) {
			return
		}
		switch node.Kind {
		case ast.KindClassDeclaration, ast.KindClassExpression, ast.KindModuleDeclaration:
			return
		case ast.KindVariableDeclaration:
			if node.Name() != nil && node.Name().Kind == ast.KindIdentifier && node.Name().Text() == name {
				declarations = append(declarations, node.Name())
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(function.Body())
	var selectedScope *ast.Node
	for parent := identifier.Parent; parent != nil; parent = parent.Parent {
		for _, declaration := range declarations {
			if lexicalDeclarationScope(declaration, function) == parent {
				selectedScope = parent
				break
			}
		}
		if selectedScope != nil || parent == function {
			break
		}
	}
	if selectedScope == nil {
		return result
	}
	result.found = true
	for _, declaration := range declarations {
		if lexicalDeclarationScope(declaration, function) == selectedScope {
			result.definitions = append(result.definitions, declaration)
			if declaration.Parent.Kind == ast.KindVariableDeclaration {
				if initializer := declaration.Parent.AsVariableDeclaration().Initializer; initializer != nil {
					result.initializers = append(result.initializers, initializer)
				}
			}
		}
	}
	// Assignment roots are compared within the selected lexical binding scope;
	// inner declarations of the same spelling shadow the outer root.
	var assignments func(*ast.Node)
	assignments = func(node *ast.Node) {
		if node != function.Body() && ast.IsFunctionLike(node) {
			return
		}
		if node.Kind == ast.KindBinaryExpression {
			binary := node.AsBinaryExpression()
			left := binary.Left
			if binary.OperatorToken.Kind >= ast.KindFirstAssignment && binary.OperatorToken.Kind <= ast.KindLastAssignment && left.Kind == ast.KindIdentifier && left.Text() == name && ancestorContains(selectedScope, left) {
				shadowed := false
				for _, declaration := range declarations {
					scope := lexicalDeclarationScope(declaration, function)
					if scope != selectedScope && ancestorContains(scope, left) && ancestorContains(selectedScope, scope) {
						shadowed = true
					}
				}
				if !shadowed {
					result.definitions = append(result.definitions, left)
				}
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { assignments(child); return false })
	}
	assignments(function.Body())
	sort.Slice(result.definitions, func(i, j int) bool { return result.definitions[i].Pos() < result.definitions[j].Pos() })
	if flow.linear {
		var latest *ast.Node
		for _, definition := range result.definitions {
			end := definition.End()
			if definition.Parent != nil {
				end = definition.Parent.End()
			}
			if end <= identifier.Pos() {
				latest = definition
			}
		}
		result.definitions = nil
		if latest != nil {
			result.definitions = []*ast.Node{latest}
			result.definite = true
			if latest.Parent.Kind == ast.KindBinaryExpression && latest.Parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
				result.assignment = latest.Parent.AsBinaryExpression().Right
			}
		}
	}
	return result
}
func (r *demandRun) localIdentifier(path string, node *ast.Node, env map[string]demandValue) (demandValue, bool) {
	function := effectFunctionOwner(node)
	if function == nil {
		return demandValue{}, false
	}
	binding := r.observer.localStructure(path, function, node)
	if !binding.found {
		return demandValue{}, false
	}
	fingerprint := fmt.Sprintf("definite:%t", binding.definite)
	for _, definition := range binding.definitions {
		fingerprint += fmt.Sprintf(":%d:%d", definition.Pos(), definition.End())
	}
	r.reads = append(r.reads, SemanticRead{Kind: "lexical-reaching-definitions", Path: path, Name: node.Text(), Fingerprint: fingerprint})
	if node.Parent != nil && node.Parent.Kind == ast.KindParameter && node.Parent.Name() == node {
		return r.eval(path, node.Parent, env), true
	}
	if node.Parent != nil && node.Parent.Kind == ast.KindVariableDeclaration && node.Parent.Name() == node {
		return r.eval(path, node.Parent.AsVariableDeclaration().Initializer, env), true
	}
	if node.Parent != nil && node.Parent.Kind == ast.KindBinaryExpression && node.Parent.AsBinaryExpression().Left == node {
		binary := node.Parent.AsBinaryExpression()
		if binary.OperatorToken.Kind == ast.KindEqualsToken {
			return r.eval(path, binary.Right, env), true
		}
		return demandUnknown("VALUE_ASSIGNMENT_UNSUPPORTED"), true
	}
	guard := r.guardRequest(EffectRequest{Path: path, Operation: "binding-mutation:" + node.Text(), Node: node, LocalAssignment: binding.assignment != nil})
	if guard.kind == "unknown" {
		if guard.reason == "VALUE_MUTATION_UNSUPPORTED" {
			for _, initializer := range binding.initializers {
				guard.candidates = append(guard.candidates, r.eval(path, initializer, env))
			}
			if bound, ok := env[node.Text()]; ok {
				if bound.kind == "reference" {
					bound = r.eval(path, bound.node, bound.env)
				}
				guard.candidates = append(guard.candidates, bound)
			}
		}
		return guard, true
	}
	if binding.assignment != nil && guard.text == "local" {
		return r.eval(path, binding.assignment, env), true
	}
	parameterBinding := false
	for _, parameter := range function.Parameters() {
		if parameter.Name() != nil && parameter.Name().Kind == ast.KindIdentifier && parameter.Name().Text() == node.Text() {
			parameterBinding = true
		}
	}
	if bound, ok := env[node.Text()]; ok && parameterBinding {
		if bound.kind == "reference" {
			return r.evalAt(bound.module, bound.node, bound.env, r.depth+1), true
		}
		return bound, true
	}
	values := []demandValue{}
	for _, definition := range binding.definitions {
		if definition.Parent != nil && definition.Parent.Kind == ast.KindParameter {
			definition = definition.Parent
		}
		values = append(values, r.eval(path, definition, env))
	}
	if len(values) > 0 {
		return r.alternatives(values), true
	}
	return demandUnknown("VALUE_RELATION_MISSING"), true
}

// Capture lazy lexical references for a returned/stored closure. Parameters
// preserve the caller's references; no property initializer is evaluated here.
func captureDemandEnvironment(path string, function *ast.Node, environment map[string]demandValue) map[string]demandValue {
	result := map[string]demandValue{}
	for name, value := range environment {
		result[name] = value
	}
	outer := effectFunctionOwner(function)
	if outer == nil {
		return result
	}
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node != outer.Body() && ast.IsFunctionLike(node) {
			return
		}
		if ast.IsPartOfTypeNode(node) {
			return
		}
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Kind == ast.KindIdentifier {
			name := node.Name()
			scope := lexicalDeclarationScope(name, outer)
			if ancestorContains(scope, function) {
				result[name.Text()] = demandValue{kind: "reference", node: node.AsVariableDeclaration().Initializer, module: path, env: environment}
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(outer.Body())
	return result
}
