package main

import (
	"reflect"
	"testing"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
)

func TestOwnedBodyGrammarOrderAndBoundaries(t *testing.T) {
	source := cfgCompletionFixtureSource("owned-boundaries", `
interface I { x: typeof hiddenType }
type T = () => void;
declare function signatureOnly(x: typeof hiddenSignature): void;
class C { field = hiddenClass(); method() { hiddenMethod(); } }
namespace N { hiddenNamespace(); }
const opaque = class { static { hiddenStatic(); } };
first(nested(), () => hiddenArrow());
function literal() { hiddenFunction(); }
last();`, false, core.ScriptKindTS)
	label := func(node *shimast.Node, kind string, function bool) string {
		if function {
			if kind != "expression" {
				t.Fatal("nested function root must be a value")
			}
			if node.Kind == shimast.KindArrowFunction {
				return "arrow"
			}
			return "function:" + node.Name().Text()
		}
		if kind == "call" {
			return "call:" + node.AsCallExpression().Expression.Text()
		}
		return ""
	}
	expected := []string{"call:first", "call:nested", "arrow", "function:literal", "call:last"}
	var actual []string
	walkOwnedBody(source.AsNode(), func(node *shimast.Node, kind string, function bool) {
		if event := label(node, kind, function); event != "" {
			actual = append(actual, event)
		}
	})
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("parent/argument order or owned execution boundaries changed: %v", actual)
	}
	for stop := 1; stop <= len(expected); stop++ {
		marker := &struct{ at int }{stop}
		var prefix []string
		failure := func() (caught any) {
			defer func() { caught = recover() }()
			walkOwnedBody(source.AsNode(), func(node *shimast.Node, kind string, function bool) {
				if event := label(node, kind, function); event != "" {
					prefix = append(prefix, event)
					if len(prefix) == stop {
						panic(marker)
					}
				}
			})
			return
		}()
		if failure != marker || !reflect.DeepEqual(prefix, expected[:stop]) {
			t.Fatalf("failure identity or prefix changed at %d: %v / %v", stop, failure, prefix)
		}
	}
}

func TestOwnedBodyGrammarPreAdmissionCounterexamples(t *testing.T) {
	source := cfgCompletionFixtureSource("pre-admission", `outer(inner(), delete object.x, class { static { hidden() } method(){ own() } }); delete object.x;`, false, core.ScriptKindTS)
	body := &thinBody{kinds: map[*shimast.Node]string{}}
	body.walk(source.AsNode())
	var inner, hidden, opaque *shimast.Node
	var deletes []*shimast.Node
	walk(source.AsNode(), func(node *shimast.Node) bool {
		if node.Kind == shimast.KindCallExpression && node.AsCallExpression().Expression.Kind == shimast.KindIdentifier {
			switch node.AsCallExpression().Expression.Text() {
			case "inner":
				inner = node
			case "hidden":
				hidden = node
			}
		}
		if node.Kind == shimast.KindClassExpression {
			opaque = node
		}
		if node.Kind == shimast.KindDeleteExpression {
			deletes = append(deletes, node)
		}
		return true
	})
	if inner == nil || hidden == nil || opaque == nil || len(deletes) != 2 {
		t.Fatal("counterexample fixture absent")
	}
	if body.kinds[inner] != "expression" || len(body.calls) != 2 {
		t.Fatal("parent argument pre-admission was overwritten or inner call callback lost")
	}
	if body.kinds[opaque] != "expression" || body.kinds[hidden] != "" {
		t.Fatal("opaque class argument pre-admission/pruning changed")
	}
	if body.kinds[deletes[0]] != "expression" || body.kinds[deletes[1]] != "" || len(body.effects) != 1 || body.effects[0] != deletes[0] {
		t.Fatal("argument delete vs standalone delete changed")
	}
}
