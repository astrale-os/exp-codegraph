package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func quotientFixture(t *testing.T, text string) (*governanceTypeAuthority, *sourcepolicy.File, *ast.Node) {
	t.Helper()
	return quotientFixtureFile(t, text, "mutations/source.ts")
}

func quotientFixtureFile(t *testing.T, text, path string) (*governanceTypeAuthority, *sourcepolicy.File, *ast.Node) {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, path, text)
	governanceWrite(t, root, "mutations/module.js", `exports.selected = 1;`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"strict":true,"target":"ES2022","allowJs":true,"checkJs":true},"include":["mutations/**/*"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	shared := governanceSharedProject(project)
	file := shared.FilesByPath[path]
	var requested *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name().Text() == "requested" {
			requested = node.Initializer()
		}
		return true
	})
	if requested == nil {
		t.Fatal("request missing")
	}
	owner := project.typeOwner
	owner.open()
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
		}
	})
	return owner, file, requested
}

func TestConstantUnknownCallQuotientAgainstOriginalCompiler(t *testing.T) {
	cases := []struct {
		name, text string
		admitted   bool
	}{
		{"dynamic-import-special-call", `const requested=import("unresolved-module");`, false},
		{"super-special-call", `class Base {x=1}; class Derived extends Base {constructor(){const requested=super();}}`, false},
		{"generic-value-index", `declare function f<T>(x:T):{[key:string]:T}; const requested=f({x:1});`, true},
		{"number-index", `declare function f<T>(x:T):{[key:number]:T}; const requested=f(1);`, true},
		{"fallback-overload", `declare function f<T>(x:T):{[key:string]:T}; declare function f(x:any):any; const requested=f(1);`, true},
		{"unknown-return", `declare function f(x:number):unknown; const requested=f(1);`, true},
		{"wrong-argument-error", `declare function f(x:number):{[key:string]:number}; const requested=f('bad');`, true},
		{"global-augment-finite-overload", `declare function f<T>(x:T):{[key:string]:T}; declare function f(x:number):{selected:string}; const requested=f(1);`, false},
		{"shadowing", `declare function f(x:any):any; function scope(){const f=(x:number)=>({selected:x});const requested=f(1);}`, false},
		{"generic-key-mapped", `declare function f<K extends string>(x:K):{[key in K]:number}; const requested=f('selected');`, false},
		{"conditional-return", `declare function f<T>(x:T):T extends number ? {selected:number}:{[key:string]:T}; const requested=f(1);`, false},
		{"constrained-parameter", `declare function f<T extends {[key:string]:unknown}>(x:T):T; const requested=f({selected:1});`, false},
		{"flow-callee", `declare const f:((x:number)=>{selected:number})|((x:string)=>{[key:string]:string}); const requested=f(1 as never);`, false},
		{"reassigned-callee", `let f:(x:number)=>{[key:string]:number};f=(x)=>({selected:x});const requested=f(1);`, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			candidate, file, node := quotientFixture(t, c.text)
			match, _ := candidate.compilerNode(file, node)
			admitted := candidate.constantUnknownCallNames(match)
			if admitted != c.admitted {
				t.Fatalf("admission=%v expected=%v", admitted, c.admitted)
			}
			observed := candidate.names(file, node)
			// Use the same canonical Program for semantic equality: unique-symbol
			// property names contain checker-local ids. Timings use separate processes.
			_, typ, known := candidate.expression(file, node)
			names, ok := candidate.propertyNames(typ)
			if !ok {
				names = nil
			}
			if observed.Known != known || !reflect.DeepEqual(observed.Names, names) {
				t.Fatalf("candidate=%#v original names=%#v known=%v", observed, names, known)
			}
		})
	}
}

func TestConstantUnknownQuotientExcludesCommonJSRequire(t *testing.T) {
	owner, file, node := quotientFixtureFile(t, `const requested=require('./module.js');`, "mutations/source.js")
	match, _ := owner.compilerNode(file, node)
	if owner.constantUnknownCallNames(match) {
		t.Fatal("CommonJS special call admitted")
	}
	observed := owner.names(file, node)
	_, typ, known := owner.expression(file, node)
	names, ok := owner.propertyNames(typ)
	if !ok {
		names = nil
	}
	if !known || !observed.Known || !reflect.DeepEqual(observed.Names, names) {
		t.Fatalf("candidate=%#v original=%#v", observed, names)
	}
	if len(names) != 1 || names[0] != "selected" {
		t.Fatalf("CommonJS module quotient not finite: %#v", names)
	}
}
