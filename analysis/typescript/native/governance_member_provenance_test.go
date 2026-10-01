package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestExternalFactoryMemberProvenanceClosedAndFallback(t *testing.T) {
	cases := []struct {
		name, text, decl string
		want             bool
	}{
		{"node-overload", `const callback=()=>Query.from({nodes:[]}).select({});`, "", true},
		{"edge-overload", `const callback=()=>Query.from({edges:[]}).select({});`, "", true},
		{"invalid-arity-recovery", `const callback=()=>Query.from().select({});`, "", true},
		{"parent-property-key", `const object={build:()=>Query.from({nodes:[]}).select({})};`, "", true},
		{"cast-receiver", `const callback=()=> (Query.from({nodes:[]}) as NodeBuilder).select({});`, "", false},
		{"shadowed-factory", `const Query={from:()=>({select:()=>1})}; const callback=()=>Query.from({}).select({});`, "", false},
		{"wrapper-return-alias", `const callback=()=>Query.from({nodes:[]}).select({});`, `export type Alias = NodeBuilder; export interface QueryAPI {from(value:any): Alias;}`, false},
		{"augmentation", `declare module '@astrale-os/kernel-core' {interface NodeBuilder {extra():void}} const callback=()=>Query.from({nodes:[]}).select({});`, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "package.json", `{"name":"fixture","type":"module"}`)
			governanceWrite(t, root, "node_modules/@astrale-os/kernel-core/package.json", `{"name":"@astrale-os/kernel-core","types":"index.d.ts"}`)
			declaration := `export interface NodeBuilder<T=unknown> {select(value:any):void} export interface EdgeBuilder<T=unknown> {select(value:any):void} export interface QueryAPI {from<T extends {nodes:unknown[]}>(value:T):NodeBuilder<T>;from<T extends {edges:unknown[]}>(value:T):EdgeBuilder<T>;from(value:any):NodeBuilder|EdgeBuilder} export declare const Query:QueryAPI;` + tc.decl
			governanceWrite(t, root, "node_modules/@astrale-os/kernel-core/index.d.ts", declaration)
			prefix := `import {Query,type NodeBuilder} from '@astrale-os/kernel-core'; `
			if tc.name == "shadowed-factory" {
				prefix = "export {}; "
			}
			governanceWrite(t, root, "queries/case.ts", prefix+tc.text)
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
			var fn, expression *ast.Node
			walk(file.Source.AsNode(), func(n *ast.Node) bool {
				if n.Kind == ast.KindArrowFunction {
					fn = n
				}
				if n.Kind == ast.KindPropertyAccessExpression && n.Name().Text() == "select" {
					expression = n
				}
				return true
			})
			if fn == nil || expression == nil {
				t.Fatal("fixture nodes missing")
			}
			got := owner.externalFactoryMemberCannotSelf(expression, owner.functionKey(fn))
			if got {
				x := &extractor{checker: identity.TypeOwner.program.Checker}
				symbol := x.canonicalCallSymbol(expression, func(*ast.Symbol) {})
				target := owner.symbolKey(symbol)
				declaration := declarationNode(symbol)
				function := functionInitializer(declaration)
				if declaration != nil && ast.IsFunctionLike(declaration) {
					function = declaration
				}
				if function != nil {
					target = owner.functionKey(function)
				}
				if target == owner.functionKey(fn) {
					t.Fatal("negative certificate disagrees with original target")
				}
			}
			if got != tc.want {
				t.Fatalf("projection got%v want%v", got, tc.want)
			}
		})
	}
}
