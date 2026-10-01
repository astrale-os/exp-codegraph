package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	"os"
	"reflect"
	"strings"
	"testing"
)

func projectorProductTestOwner(t *testing.T, root string) (*governanceRuntimeAuthority, observabledecision.CapturedFile, *ast.Node) {
	t.Helper()
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	t.Cleanup(project.typeRelease)
	owner := governanceNewRuntimeAuthority(identity)
	file := owner.ByPath["mutations/demand.ts"]
	var call *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindCallExpression && node.AsCallExpression().Expression.Kind == ast.KindCallExpression {
			call = node
			return false
		}
		return true
	})
	if call == nil {
		t.Fatal("factory application absent")
	}
	return owner, file, call
}

func comparableArgumentCall(t *testing.T, call observabledecision.NativeEffectCall) observabledecision.NativeEffectCall {
	t.Helper()
	for index := range call.Bindings {
		if call.Bindings[index].Argument == nil {
			t.Fatal("argument authority absent")
		}
		call.Bindings[index].Argument = nil
	}
	// These tests use external factory return callables: they must not invent an
	// executable local body or a callable owner from a structural signature.
	if call.Target != nil || call.CallableOwner || call.BodyPresent {
		t.Fatal("structural callable became executable owner")
	}
	return call
}

func TestProjectorArgumentProductMatchesFreshOriginalInferenceAndFailure(t *testing.T) {
	bodies := []string{`({input:1,output:'before'})`, `({input:'changed',output:42})`, `{domain.nested.method();return {input:{different:true},output:[1,2]};}`, `({input:'🧪',output:'unicode'})`, `({input:mutation,output:domain})`, `({input:notDefined,output:1})`, `{domain={before:1,nested:{method(){}}};return {input:false,output:null};}`}
	for _, body := range bodies {
		t.Run(body, func(t *testing.T) {
			source := strings.Replace(projectorSourceFixture, `({input:1,output:'before'})`, body, 1)
			root := projectorProductFixture(t, projectorSDKFixture, source)
			original, originalFile, originalCall := projectorProductTestOwner(t, root)
			// The original full signature reader runs FIRST in an independent actual
			// original checker, not after a Names/context query has warmed inference.
			want := original.callObservedArguments(originalFile, originalCall, true)
			projected, file, call := projectorProductTestOwner(t, root)
			got := projected.Call(file, call)
			shape := projected.projectorArgumentShape(call)
			if !shape.Known || len(shape.Parameters) != 1 || shape.Rest {
				t.Fatalf("shape %#v", shape)
			}
			if len(got.Bindings) != 1 || got.Bindings[0].Argument != call.Arguments()[0] {
				t.Fatal("current argument AST not retained")
			}
			if !reflect.DeepEqual(comparableArgumentCall(t, got), comparableArgumentCall(t, want)) {
				t.Fatalf("original=%#v projected=%#v", want, got)
			}
			signature := original.Identity.TypeOwner.program.Checker.GetResolvedSignature(originalCall)
			if len(checker.Signature_parameters(signature)) != 1 {
				t.Fatal("original sole-candidate declaration vector absent")
			}
			t.Logf("body=%s parameter=%s rest=%v", body, shape.Parameters[0], shape.Rest)
			for _, owner := range []*governanceRuntimeAuthority{original, projected} {
				same, err := owner.Identity.Project.capture.Verify()
				if err != nil || !same {
					t.Fatalf("fresh seal %v %v", same, err)
				}
			}
		})
	}
	for _, sdk := range []string{strings.Replace(projectorSDKFixture, "<Input,Output>", "<Input extends {required:number},Output>", 1), strings.Replace(projectorSDKFixture, "function defineMutation<S>", "function defineMutation<S extends {required:number}>", 1)} {
		root := projectorProductFixture(t, sdk, projectorSourceFixture)
		original, of, oc := projectorProductTestOwner(t, root)
		want := original.callObservedArguments(of, oc, true)
		projected, pf, pc := projectorProductTestOwner(t, root)
		got := projected.Call(pf, pc)
		if !projected.projectorArgumentShape(pc).Known || !reflect.DeepEqual(comparableArgumentCall(t, got), comparableArgumentCall(t, want)) {
			t.Fatal("generic constraint recovery altered bindings")
		}
	}
}

func TestProjectorArgumentProductFallsBackForAmbiguousAndSyntheticHeaders(t *testing.T) {
	cases := []struct{ name, sdk, source string }{
		{"overload", strings.Replace(projectorSDKFixture, "interface Projector<S> {", "interface Projector<S> {(project:()=>number):number;", 1), projectorSourceFixture},
		{"merge", projectorSDKFixture + `interface Projector<S>{(project:()=>void):void;}`, projectorSourceFixture},
		{"factory-overload", projectorSDKFixture + `export declare function defineMutation<S>(extra?:number):Projector<S>;`, projectorSourceFixture},
		{"rest", strings.Replace(projectorSDKFixture, "project:(domain:Context<S>)=>{input:Input;output:Output}", "...project:((domain:Context<S>)=>{input:Input;output:Output})[]", 1), projectorSourceFixture},
		{"this", strings.Replace(projectorSDKFixture, "(project:", "(this:unknown,project:", 1), projectorSourceFixture},
		{"alias", projectorSDKFixture, strings.Replace(projectorSourceFixture, "export const mutation=defineMutation", "const alias=defineMutation;export const mutation=alias", 1)},
		{"inferred-factory", projectorSDKFixture, strings.Replace(projectorSourceFixture, "defineMutation<Schema>", "defineMutation", 1)},
		{"inner-explicit", projectorSDKFixture, strings.Replace(projectorSourceFixture, "<Schema>()(", "<Schema>()<number,string>(", 1)},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			root := projectorProductFixture(t, item.sdk, item.source)
			owner, file, call := projectorProductTestOwner(t, root)
			if owner.projectorArgumentShape(call).Known {
				t.Fatal("uncertified selected signature admitted")
			}
			got := owner.Call(file, call)
			want := owner.callObservedArguments(file, call, true)
			if !reflect.DeepEqual(got, want) {
				t.Fatal("fallback differs from original complete reader")
			}
		})
	}
}

func TestProjectorArgumentProductPreservesOriginalReaderBudgets(t *testing.T) {
	root := projectorProductFixture(t, projectorSDKFixture, projectorSourceFixture)
	owner, file, call := projectorProductTestOwner(t, root)
	context := owner.DemandContext(observabledecision.Limits{})
	original := context
	authority := owner.EffectAuthority()
	authority.Call = func(file observabledecision.CapturedFile, node *ast.Node) observabledecision.NativeEffectCall {
		return owner.callObservedArguments(file, node, true)
	}
	core := observabledecision.NewCapturedNativeEffectCore(owner.Files, authority)
	original.CallTarget = core.DemandCallTargets()
	original.Effect = core.DemandEffects(owner.ScopedEffects)
	reader := observabledecision.NewNativeValueReader(context)
	oracle := observabledecision.NewNativeValueReader(original)
	for _, steps := range []int{1, 2, 4, 9, 32, 4096} {
		for _, depth := range []int{1, 2, 4, 64} {
			limits := observabledecision.Limits{MaximumSteps: steps, MaximumDepth: depth, MaximumAlternatives: 32}
			got := reader.Expression(file.Path, call).Resolve(limits).Outcome
			want := oracle.Expression(file.Path, call).Resolve(limits).Outcome
			got.Reads, want.Reads = nil, nil
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("steps=%d depth=%d original=%#v projected=%#v", steps, depth, want, got)
			}
		}
	}
}

func TestProjectorArgumentProductActualSDKDiagnostic(t *testing.T) {
	root := os.Getenv("ASTRALE_PROJECTOR_ARGUMENT_PROBE_ROOT")
	if root == "" {
		t.Skip("explicit read-only original SDK diagnostic")
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
	rows := []map[string]any{}
	for _, file := range owner.Files {
		if !strings.HasPrefix(file.Path, "mutations/") || strings.Contains(file.Path, "/__tests__/") {
			continue
		}
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			if len(rows) >= 3 {
				return false
			}
			if node.Kind != ast.KindCallExpression || node.AsCallExpression().Expression.Kind != ast.KindCallExpression {
				return true
			}
			shape := owner.projectorArgumentShape(node)
			got := owner.Call(file, node)
			want := owner.callObservedArguments(file, node, true)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("actual original Call differs at %s:%d", file.Path, node.Pos())
			}
			row := map[string]any{"path": file.Path, "start": node.Pos(), "projected": shape.Known, "parameters": shape.Parameters, "rest": shape.Rest, "originalArgumentCount": len(want.Bindings), "fullCallOriginalEqual": true}
			rows = append(rows, row)
			return true
		})
		if len(rows) >= 3 {
			break
		}
	}
	if len(rows) == 0 {
		t.Fatal("no actual SDK application")
	}
	same, err := project.capture.Verify()
	if err != nil || !same {
		t.Fatalf("fresh seal %v %v", same, err)
	}
	output := map[string]any{"root": root, "originalSourceFiles": len(project.typeOwner.program.TSProgram.GetSourceFiles()), "rows": rows, "freshSeal": true, "latencyClaim": false}
	bytes, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	t.Log(string(bytes))
	if path := os.Getenv("ASTRALE_PROJECTOR_ARGUMENT_PROBE_RECEIPT"); path != "" {
		if err := os.WriteFile(path, append(bytes, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

const projectorSDKFixture = `type Context<S> = S;
interface Projector<S> { <Input,Output>(project:(domain:Context<S>)=>{input:Input;output:Output}):{input:Input;output:Output}; }
export declare function defineMutation<S>():Projector<S>;`
const projectorSourceFixture = `import {defineMutation} from '@astrale-os/sdk'; import type {Schema} from '../schema/value.js';
export const mutation=defineMutation<Schema>()((domain)=>({input:1,output:'before'}));`

func projectorProductFixture(t *testing.T, sdk, source string) string {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"moduleDetection":"force"},"include":["mutations","schema","queries"]}`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", sdk)
	governanceWrite(t, root, "schema/value.ts", `export interface Schema { before:number; nested:{method():void} }`)
	governanceWrite(t, root, "queries/independent.ts", `export const separate=1;`)
	governanceWrite(t, root, "mutations/demand.ts", source)
	return root
}
