package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func TestMappedParameterOriginsRequiresActualIdentityValueTemplate(t *testing.T) {
	cases := []struct {
		name, mapping, property, call string
		want                          bool
	}{
		{"readonly", `type Wrapper<T>={readonly[P in keyof T]:T[P]};`, `typeof helper`, `namespace.helper(String);`, true},
		{"identity-other-name", `type Wrapper<T>={[P in keyof T]:T[P]};`, `typeof helper`, `namespace.helper(String);`, true},
		{"rest-transformation", `type Wrapper<T>={readonly[P in keyof T]:(...args:any[])=>void};`, `typeof helper`, `namespace.helper(String);`, false},
		{"conditional-transformation", `type Wrapper<T>={readonly[P in keyof T]:T[P] extends object ? (...args:any[])=>void : T[P]};`, `typeof helper`, `namespace.helper(String);`, false},
		{"remapped-name", `type Wrapper<T>={readonly[P in keyof T as 'helper']:T[P]};`, `typeof helper`, `namespace.helper(String);`, false},
		{"value-alias", `type Wrapper<T>={readonly[P in keyof T]:T[P]}; type Callable=typeof helper;`, `Callable`, `namespace.helper(String);`, false},
		{"callee-cast", `type Wrapper<T>={readonly[P in keyof T]:T[P]};`, `typeof helper`, `(namespace as any).helper(String);`, false},
		{"asserted-property-narrowing", `type Wrapper<T>={readonly[P in keyof T]:T[P]};`, `typeof helper`, `declare function assertRest(value:any):asserts value is (...args:any[])=>void; assertRest(namespace.helper); namespace.helper(String,String,String);`, false},
		{"rest-original", `type Wrapper<T>={readonly[P in keyof T]:T[P]};`, `typeof restHelper`, `namespace.helper(String);`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "package.json", `{"name":"fixture","type":"module"}`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
			declaration := `declare function helper<T extends {x:true}>(p:T):void;declare function helper(p:any):void;declare function restHelper(...args:any[]):void;` + tc.mapping + `export declare const namespace:Wrapper<{helper:` + tc.property + `}>;`
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", declaration)
			governanceWrite(t, root, "queries/case.ts", `import {namespace} from '@astrale-os/sdk'; `+tc.call)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext"},"include":["queries/**/*.ts"]}`)
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
			file := owner.ByPath["queries/case.ts"]
			var call *ast.Node
			walk(file.Source.AsNode(), func(n *ast.Node) bool {
				if n.Kind == ast.KindCallExpression {
					call = n
				}
				return true
			})
			if call == nil {
				t.Fatal("fixture call missing")
			}
			projection := owner.mappedParameterOrigins(call)
			original := owner.Call(file, call)
			if projection.noRest() != tc.want {
				t.Fatalf("projection got%v want%v; original%+v", projection.noRest(), tc.want, original.Bindings)
			}
			if !original.Known {
				t.Fatal("original authority absent")
			}
			// Stabilize the same current-owner resolution receipts before comparing
			// fingerprints; first resolution legitimately advances the capture ticket.
			owner.Resolve(file.Path, "@astrale-os/sdk", "namespace")
			owner.Resolve(file.Path, "@astrale-os/sdk", "namespace")
			context := owner.DemandContext(observabledecision.Limits{})
			baseline := context
			baseline.CallShape = func(path string, node *ast.Node) observabledecision.NativeEffectCall {
				result := owner.Call(owner.ByPath[path], node)
				for index := range result.Bindings {
					result.Bindings[index].Argument = nil
					result.Bindings[index].Parameter = ""
				}
				return result
			}
			for _, steps := range []int{1, 2, 3, 4, 8, 16, 4096} {
				for _, depth := range []int{1, 2, 4, 64} {
					limits := observabledecision.Limits{MaximumSteps: steps, MaximumDepth: depth}
					want := observabledecision.NewNativeValueReader(baseline).Expression(file.Path, call).Resolve(limits).Outcome
					got := observabledecision.NewNativeValueReader(context).Expression(file.Path, call).Resolve(limits).Outcome
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("reader boundary changed at steps%d depth%d: got%+v want%+v", steps, depth, got, want)
					}
				}
			}
			if projection.noRest() {
				for _, binding := range original.Bindings {
					if binding.Rest {
						t.Fatal("projection erased selected rest")
					}
				}
			}
		})
	}
}
