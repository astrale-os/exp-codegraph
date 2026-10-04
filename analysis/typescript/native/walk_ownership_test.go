package main

import (
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"reflect"
	"testing"
)

// Exact former scalar traversal: an independent order/pruning oracle.
func scalarWalkOwnership(node *ast.Node, visit func(*ast.Node) bool) {
	if node == nil || !visit(node) {
		return
	}
	node.ForEachChild(func(child *ast.Node) bool {
		scalarWalkOwnership(child, visit)
		return false
	})
}

func TestWalkOwnershipPreservesOccurrenceOrderAndPruning(t *testing.T) {
	for _, text := range []string{
		"f(a(), b()); g(c());",
		"function outer(p: number) { if(p) { return f(p) } else { g(p) } } outer(1);",
		`/* recovery */ const λ = '\uD800'; if (`,
	} {
		source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/walk.ts"}, text, core.ScriptKindTS)
		for _, prune := range []ast.Kind{ast.KindUnknown, ast.KindCallExpression, ast.KindFunctionDeclaration} {
			trace := func(reader func(*ast.Node, func(*ast.Node) bool)) []*ast.Node {
				var seen []*ast.Node
				reader(source.AsNode(), func(node *ast.Node) bool { seen = append(seen, node); return node.Kind != prune })
				return seen
			}
			if !reflect.DeepEqual(trace(scalarWalkOwnership), trace(walk)) {
				t.Fatalf("occurrence/prune order changed: %q/%v", text, prune)
			}
		}
	}
	source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/shared.ts"}, "f(); g();", core.ScriptKindTS)
	first, second := source.Statements.Nodes[0], source.Statements.Nodes[1]
	source.Statements.Nodes = []*ast.Node{first, first, second}
	var actual, expected []*ast.Node
	walkFile(source, func(node *ast.Node) bool { actual = append(actual, node); return true })
	for _, statement := range source.Statements.Nodes {
		scalarWalkOwnership(statement, func(node *ast.Node) bool { expected = append(expected, node); return true })
	}
	if !reflect.DeepEqual(actual, expected) || actual[0] != first {
		t.Fatal("walkFile lost statement-only boundary or shared occurrences")
	}
	walk(nil, nil)
	walkFile(nil, nil)
	source.Statements = nil
	walkFile(source, nil)
	didPanic := func(reader func(*ast.Node, func(*ast.Node) bool)) (panicked bool) {
		defer func() { panicked = recover() != nil }()
		reader(first, nil)
		return
	}
	if !didPanic(walk) || !didPanic(scalarWalkOwnership) {
		t.Fatal("non-nil root with nil callback changed its original panic")
	}
}

func TestWalkOwnershipKeepsReentryAndLateChildMutation(t *testing.T) {
	run := func(reader func(*ast.Node, func(*ast.Node) bool)) []string {
		parse := func(text string) *ast.SourceFile {
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/reentrant.ts"}, text, core.ScriptKindTS)
		}
		source, replacement, nested := parse("first(); stale();"), parse("freshLateChild();"), parse("inner(a(),b());")
		first := source.Statements.Nodes[0]
		var trace []string
		changed := false
		reader(source.AsNode(), func(node *ast.Node) bool {
			trace = append(trace, fmt.Sprintf("outer:%d:%d:%d", node.Kind, node.Pos(), node.End()))
			if node == first && !changed {
				changed = true
				source.Statements.Nodes[1] = replacement.Statements.Nodes[0]
				reader(nested.AsNode(), func(inner *ast.Node) bool {
					trace = append(trace, fmt.Sprintf("inner:%d:%d:%d", inner.Kind, inner.Pos(), inner.End()))
					return inner.Kind != ast.KindCallExpression
				})
			}
			return true
		})
		return trace
	}
	if !reflect.DeepEqual(run(scalarWalkOwnership), run(walk)) {
		t.Fatal("reentry changed callback ownership or eager child collection ignored mutation")
	}
}
