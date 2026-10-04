package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
	"testing"
)

func TestCapturedCallInventoryOwnsMembershipOrderAndAuthoredSelection(t *testing.T) {
	text := `import {defineQuery} from '@astrale-os/sdk/query'; function factory(){return defineQuery()(()=>({id:'nested'}))}; export const top=defineQuery()(()=>({id:'top'}));`
	_, file := effectFixture(text)
	file.Path = "queries.ts"
	file.Layer = "queries"
	sites := []CapturedCall{}
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression {
			sites = append(sites, CapturedCall{Path: file.Path, SubjectID: "certified-call", Node: node, Callee: node.AsCallExpression().Expression, Start: utf16At(text, node.Pos()), End: utf16At(text, node.End())})
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(file.Source.AsNode())
	// Reverse order is intentional: the observer must not re-sort native rows.
	for i, j := 0, len(sites)-1; i < j; i, j = i+1, j-1 {
		sites[i], sites[j] = sites[j], sites[i]
	}
	context := fixtureContext([]CapturedFile{*file})
	context.Calls = func(paths []string) NativeCallInventory {
		if len(paths) != 1 || paths[0] != file.Path {
			t.Fatalf("requested membership: %v", paths)
		}
		return NativeCallInventory{Known: true, Complete: true, Sites: sites, Reads: []SemanticRead{{Kind: "owned-call-inventory", Fingerprint: "fixture-v1"}}}
	}
	queries := ObserveQueriesAndIDs(context)
	if !queries.InventoryKnown || len(queries.Observations) != 2 || queries.Observations[0].ID.String != "top" || queries.Observations[1].ID.String != "nested" {
		t.Fatalf("captured inventory order/membership: %+v", queries)
	}
	if queries.Observations[0].SubjectID != "certified-call" {
		t.Fatal("service call identity replaced")
	}
	topSubject := CapturedDefinitionSubject{Path: file.Path, Start: queries.Observations[0].Start, End: queries.Observations[0].End}
	missing := CapturedDefinitionSubject{Path: file.Path, Start: 999, End: 1000}
	context.DefinitionSubjects = func([]string) NativeDefinitionSubjects {
		return NativeDefinitionSubjects{Known: true, Subjects: []CapturedDefinitionSubject{topSubject, missing}}
	}
	definitions := ObserveDefinitionIDs(context)
	if len(definitions.Observations) != 1 || definitions.Observations[0].ID.String != "top" || len(definitions.DiscoveryFailures) != 1 || definitions.DiscoveryFailures[0].Reason != "The authored call is absent from the call inventory." {
		t.Fatalf("authored subjects are independent: %+v", definitions)
	}
	context.Calls = func([]string) NativeCallInventory { return NativeCallInventory{} }
	if result := ObserveQueriesAndIDs(context); len(result.Observations) != 0 || len(result.Residual) == 0 {
		t.Fatalf("missing authority silently scanned source: %+v", result)
	}
}
func TestNativeLibraryDataArgumentsRequireDeepClosedData(t *testing.T) {
	for _, fixture := range []struct {
		text string
		want bool
	}{
		{`Object.assign({id:'safe',nested:{value:1}}, {})`, true},
		{`Object.assign({factory:()=>null}, {})`, false},
		{`Object.assign({nested:{factory:()=>null}}, {})`, false},
		{`Object.assign({id:'safe',...unknown}, {})`, false},
		{`Object.assign([], {})`, false},
	} {
		_, file := effectFixture(fixture.text)
		observer := newDemandObserver(fixtureContext([]CapturedFile{*file}))
		var call *ast.Node
		file.Source.AsNode().ForEachChild(func(node *ast.Node) bool {
			if node.Kind == ast.KindExpressionStatement {
				call = node.AsExpressionStatement().Expression
			}
			return false
		})
		if observer.dataArguments(file.Path, call) != fixture.want {
			t.Fatalf("deep bounded data %s", fixture.text)
		}
	}
}
func TestAuthoritativeMissingCallRowsRemainPublicUncertainty(t *testing.T) {
	_, file := effectFixture(`export const marker=1;`)
	context := fixtureContext([]CapturedFile{*file})
	context.Calls = func([]string) NativeCallInventory {
		return NativeCallInventory{Known: true, Complete: false, Sites: []CapturedCall{{Path: file.Path, Start: 1, End: 2}}, Reasons: []string{"Legacy inventory is partial."}}
	}
	context.DefinitionSubjects = func([]string) NativeDefinitionSubjects {
		return NativeDefinitionSubjects{Known: true, Subjects: []CapturedDefinitionSubject{{Path: file.Path, Start: 1, End: 2}}}
	}
	queries := ObserveQueriesAndIDs(context)
	definitions := ObserveDefinitionIDs(context)
	if len(queries.InventoryReasons) != 1 || len(queries.Residual) != 0 {
		t.Fatalf("inventory uncertainty became migration: %+v", queries)
	}
	if len(definitions.DiscoveryFailures) != 1 || !strings.Contains(definitions.DiscoveryFailures[0].Reason, "source or callee") || len(definitions.Residual) != 0 {
		t.Fatalf("missing call row dropped: %+v", definitions)
	}
}
