package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestDeclaredSDKTemplateRestObservationMatchesSelectedSignature(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", `interface Plain<S>{<P>(project:(schema:S)=>P):P; <P>(project:()=>P, optional?:boolean):P;}
interface Rest<S>{(...args:S[]):S;}
interface Base<S>{(...args:S[]):S;}
interface Inherited<S> extends Base<S>{}
export declare function defineQuery<S extends {kind:'allowed'}>():Plain<S>;
export declare function restFactory<S>():Rest<S>;
export declare function inheritedFactory<S>():Inherited<S>;
`)
	governanceWrite(t, root, "mutations/calls.ts", `import {defineQuery,restFactory,inheritedFactory} from '@astrale-os/sdk';
defineQuery<{kind:'allowed'}>()(()=>({id:'valid'}));
defineQuery<{kind:'invalid'}>()(()=>({id:'invalid'}));
restFactory<string>()('one','two'); inheritedFactory<string>()('one');
const alias=defineQuery;
alias<{kind:'allowed'}>()(()=>1);
const cast=defineQuery as unknown as <S>()=>(...values:S[])=>S;
cast<string>()('one');
`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","strict":true,"moduleResolution":"node"},"include":["mutations/**/*.ts"]}`)
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
	context := owner.DemandContext(observabledecision.Limits{})
	originalContext := context
	originalContext.CallShape = nil
	originalContext.CallTarget = func(path string, node *ast.Node) observabledecision.NativeEffectCall {
		return owner.callObservedArguments(owner.ByPath[path], node, true)
	}
	reader := observabledecision.NewNativeValueReader(context)
	originalReader := observabledecision.NewNativeValueReader(originalContext)
	shape := owner.DemandCallShapes()
	proved := 0
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind != ast.KindCallExpression {
			return true
		}
		actual := shape(file.Path, node)
		want := owner.callObservedArguments(file, node, true)
		actualBindings, wantBindings := actual.Bindings, want.Bindings
		actual.Bindings = nil
		want.Bindings = nil
		if !reflect.DeepEqual(actual, want) {
			t.Fatalf("target observation differs at %d", node.Pos())
		}
		rest := false
		for _, binding := range wantBindings {
			rest = rest || binding.Rest
		}
		gotRest := false
		for _, binding := range actualBindings {
			gotRest = gotRest || binding.Rest
		}
		if rest != gotRest {
			t.Fatalf("rest observation differs at %d", node.Pos())
		}
		baseline := originalReader.Expression(file.Path, node).Resolve(observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64}).Outcome
		for _, steps := range []int{1, 4, 9, max(1, baseline.Steps-1), max(1, baseline.Steps), baseline.Steps + 1, 4096} {
			limits := observabledecision.Limits{MaximumSteps: steps, MaximumDepth: 64, MaximumAlternatives: 32}
			actual := reader.Expression(file.Path, node).Resolve(limits).Outcome
			original := originalReader.Expression(file.Path, node).Resolve(limits).Outcome
			actual.Reads, original.Reads = nil, nil
			if !reflect.DeepEqual(actual, original) {
				t.Fatalf("original budget/outcome differs at %d limit %d", node.Pos(), steps)
			}
		}
		if owner.canonicalFactoryReturnsNoRest(node) {
			proved++
		}
		return true
	})
	if proved != 2 {
		t.Fatalf("expected two direct factory proofs, got %d", proved)
	}
}

func TestRealFieldCallShapeCoverage(t *testing.T) {
	root := os.Getenv("ASTRALE_CALL_SHAPE_PROBE_ROOT")
	if root == "" {
		t.Skip("read-only field probe")
	}
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
	proved, total := 0, 0
	for _, file := range owner.Files {
		if !strings.HasPrefix(file.Path, "queries/") {
			continue
		}
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				total++
				if owner.canonicalFactoryReturnsNoRest(node) {
					proved++
				}
			}
			return true
		})
	}
	t.Logf("actual field calls=%d no-rest template proofs=%d", total, proved)
	if proved == 0 {
		t.Fatal("no actual call shape template proof")
	}
}
