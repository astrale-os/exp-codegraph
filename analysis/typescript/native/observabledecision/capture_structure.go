package observabledecision

import ast "github.com/microsoft/typescript-go/shim/ast"

// A capture product owns only declarations in one actual outer function. It
// intentionally differs from local binding selection: original capture walks
// classes/modules, includes nil initializers, and selects by whole-body preorder.
type demandCaptureIndex struct {
	scopes map[*ast.Node]map[string]demandCaptureDeclaration
}

type demandCaptureDeclaration struct {
	ordinal     int
	initializer *ast.Node
}

func newDemandCaptureIndex(outer *ast.Node) *demandCaptureIndex {
	index := &demandCaptureIndex{scopes: map[*ast.Node]map[string]demandCaptureDeclaration{}}
	ordinal := 0
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
			declarations := index.scopes[scope]
			if declarations == nil {
				declarations = map[string]demandCaptureDeclaration{}
				index.scopes[scope] = declarations
			}
			ordinal++
			declarations[name.Text()] = demandCaptureDeclaration{ordinal: ordinal, initializer: node.AsVariableDeclaration().Initializer}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(outer.Body())
	return index
}

func (o *demandObserver) captureDemandEnvironment(path string, function *ast.Node, environment map[string]demandValue) map[string]demandValue {
	outer := effectFunctionOwner(function)
	if outer == nil || outer.Body() == nil || !o.ownsFunctionStructure(path, function) {
		return captureDemandEnvironment(path, function, environment)
	}
	structure := o.functionStructureOwner(path, outer)
	if structure == nil {
		return captureDemandEnvironment(path, function, environment)
	}
	// No flow product or semantic callback is demanded here. Once only publishes
	// the completed immutable declaration index; environments remain call-owned.
	structure.captureOnce.Do(func() { structure.capture = newDemandCaptureIndex(outer) })
	selected := map[string]demandCaptureDeclaration{}
	for scope := function; scope != nil; scope = scope.Parent {
		for name, declaration := range structure.capture.scopes[scope] {
			if declaration.ordinal > selected[name].ordinal {
				selected[name] = declaration
			}
		}
		if scope == outer {
			break
		}
	}
	result := map[string]demandValue{}
	for name, value := range environment {
		result[name] = value
	}
	for name, declaration := range selected {
		// Nil is a real last declaration, not absence. Retain CURRENT environment
		// map identity just as the original lazy reference does; never retain it in
		// the shared declaration owner or reuse a previous returned map.
		result[name] = demandValue{kind: "reference", node: declaration.initializer, module: path, env: environment}
	}
	return result
}
