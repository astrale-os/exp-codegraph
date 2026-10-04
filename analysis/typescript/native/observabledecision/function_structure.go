package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
	"sync"
)

// Only captured syntactic facts are retained. Values, environments, reads,
// effects and evaluation allowances belong to each fresh demandRun.
type demandFunctionStructure struct {
	flowOnce    sync.Once
	flow        demandFlow
	lexicalOnce sync.Once
	lexical     *demandLexicalIndex
	captureOnce sync.Once
	capture     *demandCaptureIndex
}

type demandLexicalIndex struct {
	bindings map[string]map[*ast.Node]*demandLexicalBinding
}

type demandLexicalBinding struct {
	definitions, initializers []*ast.Node
	frontier                  []demandWriteFrontier
}

type demandWriteFrontier struct {
	end             int
	definitionIndex int
}

func (o *demandObserver) ownsFunctionStructure(path string, function *ast.Node) bool {
	module := o.modules[path]
	return module != nil && module.reason == "" && function != nil &&
		module.file.Source != nil && ast.GetSourceFileOfNode(function) == module.file.Source
}

func (o *demandObserver) functionStructureOwner(path string, function *ast.Node) *demandFunctionStructure {
	if !o.ownsFunctionStructure(path, function) {
		return nil
	}
	o.structuresMu.RLock()
	enabled := o.structures != nil
	structure := o.structures[function]
	o.structuresMu.RUnlock()
	if !enabled {
		return nil
	}
	if structure == nil {
		o.structuresMu.Lock()
		structure = o.structures[function]
		if structure == nil {
			if o.context.Syntax != nil {
				structure = o.context.Syntax.function(o.modules[path].file.Source, function)
			} else {
				structure = &demandFunctionStructure{}
			}
			o.structures[function] = structure
		}
		o.structuresMu.Unlock()
	}
	return structure
}

func (o *demandObserver) functionStructure(path string, function *ast.Node) *demandFunctionStructure {
	structure := o.functionStructureOwner(path, function)
	if structure != nil {
		// Only initialization waits. No semantic evaluation or callback runs under
		// the map lock or either Once, and different functions initialize separately.
		structure.flowOnce.Do(func() { structure.flow = inspectDemandFlow(function) })
	}
	return structure
}

func (o *demandObserver) functionFlow(path string, function *ast.Node) demandFlow {
	if structure := o.functionStructure(path, function); structure != nil {
		// This private borrowed return list is read only by invocation. No AST
		// plan or mutable slice is returned through the public proof interface.
		return structure.flow
	}
	return inspectDemandFlow(function)
}

func (o *demandObserver) localStructure(path string, function, identifier *ast.Node) localDemandBinding {
	structure := o.functionStructure(path, function)
	if structure == nil || !o.ownsFunctionStructure(path, identifier) || effectFunctionOwner(identifier) != function {
		return selectedLocalBinding(function, identifier, inspectDemandFlow(function))
	}
	structure.lexicalOnce.Do(func() { structure.lexical = newDemandLexicalIndex(function) })
	return structure.lexical.selectBinding(function, identifier, structure.flow.linear)
}

func (index *demandLexicalIndex) nearestScope(function, identifier *ast.Node) *ast.Node {
	scopes := index.bindings[identifier.Text()]
	for parent := identifier.Parent; parent != nil; parent = parent.Parent {
		if scopes[parent] != nil {
			return parent
		}
		if parent == function {
			break
		}
	}
	return nil
}

func newDemandLexicalIndex(function *ast.Node) *demandLexicalIndex {
	index := &demandLexicalIndex{bindings: map[string]map[*ast.Node]*demandLexicalBinding{}}
	declare := func(name *ast.Node) {
		scope := lexicalDeclarationScope(name, function)
		scopes := index.bindings[name.Text()]
		if scopes == nil {
			scopes = map[*ast.Node]*demandLexicalBinding{}
			index.bindings[name.Text()] = scopes
		}
		binding := scopes[scope]
		if binding == nil {
			binding = &demandLexicalBinding{}
			scopes[scope] = binding
		}
		binding.definitions = append(binding.definitions, name)
		if name.Parent.Kind == ast.KindVariableDeclaration {
			if initializer := name.Parent.AsVariableDeclaration().Initializer; initializer != nil {
				binding.initializers = append(binding.initializers, initializer)
			}
		}
	}
	for _, parameter := range function.Parameters() {
		if parameter.Name() != nil && parameter.Name().Kind == ast.KindIdentifier {
			declare(parameter.Name())
		}
	}
	var declarations func(*ast.Node)
	declarations = func(node *ast.Node) {
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
			if node.Name() != nil && node.Name().Kind == ast.KindIdentifier {
				declare(node.Name())
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { declarations(child); return false })
	}
	declarations(function.Body())
	// Preserve the original assignment traversal, including its intentionally
	// different class/type pruning from the declaration traversal.
	var assignments func(*ast.Node)
	assignments = func(node *ast.Node) {
		if node != function.Body() && ast.IsFunctionLike(node) {
			return
		}
		if node.Kind == ast.KindBinaryExpression {
			binary := node.AsBinaryExpression()
			left := binary.Left
			if binary.OperatorToken.Kind >= ast.KindFirstAssignment && binary.OperatorToken.Kind <= ast.KindLastAssignment && left.Kind == ast.KindIdentifier {
				if scope := index.nearestScope(function, left); scope != nil {
					binding := index.bindings[left.Text()][scope]
					binding.definitions = append(binding.definitions, left)
				}
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { assignments(child); return false })
	}
	assignments(function.Body())
	for _, scopes := range index.bindings {
		for _, binding := range scopes {
			// Keep exactly the original definition order, including equal-position
			// sort behavior; end positions need not be monotone in that order.
			sort.Slice(binding.definitions, func(i, j int) bool { return binding.definitions[i].Pos() < binding.definitions[j].Pos() })
			for i, definition := range binding.definitions {
				end := definition.End()
				if definition.Parent != nil {
					end = definition.Parent.End()
				}
				binding.frontier = append(binding.frontier, demandWriteFrontier{end: end, definitionIndex: i})
			}
			sort.Slice(binding.frontier, func(i, j int) bool { return binding.frontier[i].end < binding.frontier[j].end })
			latest := -1
			for i := range binding.frontier {
				if binding.frontier[i].definitionIndex > latest {
					latest = binding.frontier[i].definitionIndex
				}
				binding.frontier[i].definitionIndex = latest
			}
		}
	}
	return index
}

func (index *demandLexicalIndex) selectBinding(function, identifier *ast.Node, linear bool) localDemandBinding {
	scope := index.nearestScope(function, identifier)
	if scope == nil {
		return localDemandBinding{}
	}
	binding := index.bindings[identifier.Text()][scope]
	result := localDemandBinding{found: true, initializers: binding.initializers}
	if !linear {
		// Private read-only slices are shared once per actual lexical binding.
		result.definitions = binding.definitions
		return result
	}
	frontier := sort.Search(len(binding.frontier), func(i int) bool { return binding.frontier[i].end > identifier.Pos() }) - 1
	if frontier < 0 {
		return result
	}
	latest := binding.definitions[binding.frontier[frontier].definitionIndex]
	result.definitions = []*ast.Node{latest}
	result.definite = true
	if latest.Parent.Kind == ast.KindBinaryExpression && latest.Parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
		result.assignment = latest.Parent.AsBinaryExpression().Right
	}
	return result
}
