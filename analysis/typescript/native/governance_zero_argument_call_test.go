package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func TestZeroArgumentMetadataMatchesOriginalCompleteCallRows(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/calls.ts", `declare function rest(...items: unknown[]): unknown;
declare function required(x: string): unknown;
declare function constrained<T extends {kind:'allowed'}>(): T;
declare function overloaded(): 1;
declare function overloaded(value: string): 2;
declare const intersection: (()=>number) & ((...xs:string[])=>string);
declare const union: (()=>number) | ((...xs:string[])=>string);
function local(x=1,...tail:unknown[]){return {id:'local'}};
const alias=local;
const object={fn:local};
const noncallable=42;
rest(); required(); constrained<{kind:'invalid'}>(); overloaded();
intersection(); union(); local(); alias(); object.fn(); noncallable();
(()=>({id:'arrow'}))();
const nested=(()=>()=>({id:'nested'}))()();
rest('one'); alias(1);
`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","strict":true},"include":["mutations/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	file := owner.ByPath["mutations/calls.ts"]
	count := 0
	var calls []*ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind != ast.KindCallExpression {
			return true
		}
		optimized := owner.Call(file, node)
		original := owner.callObservedArguments(file, node, true)
		if !reflect.DeepEqual(optimized, original) {
			t.Fatalf("original complete metadata differs at %d: %#v != %#v", node.Pos(), optimized, original)
		}
		count++
		calls = append(calls, node)
		return true
	})
	if count < 14 {
		t.Fatalf("fixture inventory %d", count)
	}
	// Effects receive the same target/binding records, including empty rows for
	// zero-argument rest or erroneous calls; retain original virtual charging.
	authority := owner.EffectAuthority()
	originalAuthority := authority
	originalAuthority.Call = func(file observabledecision.CapturedFile, node *ast.Node) observabledecision.NativeEffectCall {
		return owner.callObservedArguments(file, node, true)
	}
	fast := observabledecision.NewNativeEffectCore(owner.Files, authority)
	old := observabledecision.NewNativeEffectCore(owner.Files, originalAuthority)
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind != ast.KindIdentifier {
			return true
		}
		symbol := owner.Symbol(file, node)
		if !symbol.Known || symbol.Key == "" {
			return true
		}
		for _, kind := range []string{"mutation", "escape"} {
			actual, want := fast.Proof(kind, symbol.Key, ""), old.Proof(kind, symbol.Key, "")
			if !reflect.DeepEqual(actual, want) {
				t.Fatalf("%s complete effect proof/virtual cost differs for %s", kind, node.Text())
			}
		}
		return true
	})
	context := owner.DemandContext(observabledecision.Limits{})
	originalContext := context
	originalContext.CallShape = nil
	originalContext.CallTarget = old.DemandCallTargets()
	originalContext.Effect = old.DemandEffects(owner.ScopedEffects)
	reader := observabledecision.NewNativeValueReader(context)
	originalReader := observabledecision.NewNativeValueReader(originalContext)
	for _, call := range calls {
		baseline := originalReader.Expression(file.Path, call).Resolve(observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64}).Outcome
		steps := []int{1, 4, 9, max(1, baseline.Steps-1), max(1, baseline.Steps), baseline.Steps + 1, 4096}
		for _, limit := range steps {
			for _, depth := range []int{1, 2, 4, 64} {
				limits := observabledecision.Limits{MaximumSteps: limit, MaximumDepth: depth, MaximumAlternatives: 32}
				actual := reader.Expression(file.Path, call).Resolve(limits).Outcome
				want := originalReader.Expression(file.Path, call).Resolve(limits).Outcome
				actual.Reads, want.Reads = nil, nil // distinct producer capture-ticket diagnostics
				if !reflect.DeepEqual(actual, want) {
					t.Fatalf("original outcome/reasons/budget differs at %d limits %#v: %#v != %#v", call.Pos(), limits, actual, want)
				}
			}
		}
	}
}
