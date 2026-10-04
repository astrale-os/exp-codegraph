package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
)

type CapturedCall struct {
	Path, SubjectID string
	Node, Callee    *ast.Node
	Start, End      int
}
type NativeCallInventory struct {
	Known, Complete bool
	Sites           []CapturedCall
	Reasons         []string
	Reads           []SemanticRead
}
type DemandDiscoveryFailure struct {
	Path       string
	Start, End int
	Reason     string
}

// Runtime call membership/order are native service products, independent from
// governed file membership and lexical source constructor authoring.
func (o *demandObserver) callInventory(layers ...string) (NativeCallInventory, bool) {
	paths := []string{}
	for path, module := range o.modules {
		if module.file.Role != "production" {
			continue
		}
		for _, layer := range layers {
			if module.file.Layer == layer {
				paths = append(paths, path)
				break
			}
		}
	}
	sort.Strings(paths)
	if o.context.Calls != nil {
		return o.context.Calls(paths), true
	}
	inventory := NativeCallInventory{}
	for _, path := range paths {
		for _, candidate := range o.modules[path].candidates {
			inventory.Sites = append(inventory.Sites, CapturedCall{Path: path, Node: candidate})
		}
	}
	return inventory, false
}
func constructorCandidates(value demandValue, allowDirect bool) (name string, definite, curried bool) {
	candidates := []demandValue{value}
	if value.kind == "alternatives" {
		candidates = value.values
	}
	if value.kind == "unknown" {
		candidates = value.candidates
	}
	matches, other := 0, false
	for _, candidate := range candidates {
		if candidate.kind == "factory" || (allowDirect && candidate.kind == "constructor") {
			if name == "" {
				name = candidate.text
				curried = candidate.kind == "factory"
			}
			if name != candidate.text {
				other = true
			}
			matches++
		} else {
			other = true
		}
	}
	return name, matches > 0 && !other && value.kind != "unknown", curried
}

type CapturedDefinitionSubject struct {
	Path       string
	Start, End int
}
type NativeDefinitionSubjects struct {
	Known    bool
	Subjects []CapturedDefinitionSubject
	Reads    []SemanticRead
}
type LibraryReceiverObservation struct {
	Known, Library bool
	Reads          []SemanticRead
}

func legacyNullRootAdmitted(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil {
		return false
	}
	if parent.Kind == ast.KindArrowFunction && parent.Body() == node {
		return true
	}
	if parent.Kind == ast.KindCallExpression {
		for _, argument := range parent.AsCallExpression().Arguments.Nodes {
			if argument == node {
				return true
			}
		}
	}
	if parent.Kind == ast.KindPropertyAccessExpression && parent.AsPropertyAccessExpression().Expression == node && parent.Parent != nil && parent.Parent.Kind == ast.KindCallExpression && parent.Parent.AsCallExpression().Expression == parent {
		return true
	}
	return false
}

func (r *demandRun) expressionAdmission(path string, node *ast.Node) (bool, bool) {
	if r.observer.context.ExpressionAdmitted != nil {
		admitted, known := r.observer.context.ExpressionAdmitted(path, node)
		if !known {
			r.migrationIncomplete = true
		}
		return admitted, known
	}
	return node.Kind != ast.KindNullKeyword || legacyNullRootAdmitted(node), true
}
