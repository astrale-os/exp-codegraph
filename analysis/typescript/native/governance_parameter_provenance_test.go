package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestClosedParameterHeadersPreserveOriginalRestConsumer(t *testing.T) {
	cases := []struct {
		name, text string
		want       bool
	}{
		{"plain-generic", `function f<T extends {x:true}>(p:T){} f(String);`, true},
		{"overload-error-recovery", `function f(p:string):void;function f(p:number):void;function f(p:any){} f(String);`, true},
		{"default-parameter", `function f(p:any=1){} f(String);`, true},
		{"rest", `function f(...p:any[]){} f(String);`, false},
		{"assigned-function", `function f(p:any){} f=(...p:any[])=>{}; f(String);`, true},
		{"mapped-rest-value", `interface Base {f(p:any):void} type Changed<T>={[K in keyof T]:(...p:any[])=>void};declare const receiver:Changed<Base>; receiver.f(String);`, false},
		{"index-local-function", `function local(p:any){p.x=1} declare const receiver:{[k:string]:typeof local};receiver.map(String);`, false},
		{"asserted-variable-rest", `function original(p:any){} const f=original as (...p:any[])=>void; f(String);`, false},
		{"asserted-any", `function f(p:any){} (f as any)(String);`, false},
		{"builtin-freeze", `Object.freeze(String);`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "queries/case.ts", "export {}; "+tc.text)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["queries/**/*.ts"]}`)
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
				t.Fatal("fixture call absent")
			}
			projection := owner.directParameterOrigins(call)
			original := owner.Call(file, call)
			t.Logf("original binding rows %+v", original.Bindings)
			if projection.noRest() != tc.want {
				t.Fatalf("admission got%v want%v", projection.noRest(), tc.want)
			}
			if !original.Known {
				t.Fatal("original call authority absent")
			}
			if projection.noRest() {
				for _, binding := range original.Bindings {
					if binding.Rest {
						t.Fatal("closed header projection erased original rest")
					}
				}
			}
		})
	}
}
