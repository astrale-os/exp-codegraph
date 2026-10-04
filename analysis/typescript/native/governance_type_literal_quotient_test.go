package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func TestGovernanceEmptyConditionalNamesOriginalCheckerDifferential(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"unknown condition", `declare const condition: unknown; const out=condition?{}:{assigneeId:1}; out;`},
		{"true condition", `const out=true?{}:{assigneeId:1}; out;`},
		{"false condition", `const out=false?{}:{assigneeId:1}; out;`},
		{"reverse", `declare const condition:boolean; const out=condition?{assigneeId:1}:{}; out;`},
		{"any value", `declare const condition:boolean; declare const value:any; const out=condition?{}:{assigneeId:value}; out;`},
		{"unknown value", `declare const condition:boolean; declare const value:unknown; const out=condition?{}:{assigneeId:value}; out;`},
		{"never value", `declare const condition:boolean; declare const value:never; const out=condition?{}:{assigneeId:value}; out;`},
		{"undefined value", `declare const condition:boolean; const out=condition?{}:{assigneeId:undefined}; out;`},
		{"many names", `declare const condition:boolean; const out=condition?{}:{second:1,first:2}; out;`},
		{"duplicate name", `declare const condition:boolean; const out=condition?{}:{assigneeId:1,assigneeId:2}; out;`},
		{"proto", `declare const condition:boolean; const out=condition?{}:{__proto__:null}; out;`},
		{"any context", `declare const condition:boolean; function consume(value:any){};consume(condition?{}:{assigneeId:1});`},
		{"index context", `declare const condition:boolean; function consume(value:{[key:string]:unknown}){};consume(condition?{}:{assigneeId:1});`},
		{"generic context", `declare const condition:boolean; function consume<T extends {assigneeId?:unknown}>(value:T){};consume(condition?{}:{assigneeId:1});`},
		{"binding pattern context", `declare const condition:boolean; function consume({assigneeId=1}:{assigneeId?:number}){};consume(condition?{}:{assigneeId:1});`},
		{"flow narrowed value", `function consume(input:{assigneeId?:string}){ if(input.assigneeId) { const out=input.assigneeId===undefined?{}:{assigneeId:input.assigneeId};out;}}`},
		{"asserted value", `declare const condition:boolean; const out=condition?{}:{assigneeId:({} as {x:1})};out;`},
		{"callee value", `declare const condition:boolean; declare function value():any; const out=condition?{}:{assigneeId:value()};out;`},
		{"both empty", `declare const condition:boolean;const out=condition?{}:{};out;`},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := typeDemandFixture(t)
			governanceWrite(t, root, "mutations/demand.ts", `export {};`+test.source)
			project, err := captureGovernedProject(root, governanceTestPolicy())
			if err != nil {
				t.Fatal(err)
			}
			shared := governanceSharedProject(project)
			file := shared.FilesByPath["mutations/demand.ts"]
			var expression *ast.Node
			walkFile(file.Source, func(node *ast.Node) bool {
				if node.Kind == ast.KindConditionalExpression {
					expression = node
				}
				return true
			})
			observed := project.typeOwner.names(file, expression)
			if project.stats.CompilerPrograms != 0 {
				t.Fatal("quotient opened compiler")
			}
			same, err := project.capture.Verify()
			if err != nil || !same {
				t.Fatal("quotient seal", same, err)
			}
			_, typ, known := project.typeOwner.expression(file, expression)
			if !known || typ == nil {
				t.Fatal("original type absent")
			}
			names, ok := project.typeOwner.propertyNames(typ)
			original := sourcepolicy.NamesObservation{Known: true}
			if ok {
				original.Names = names
			}
			if !reflect.DeepEqual(observed, original) {
				t.Fatalf("quotient=%#v original=%#v", observed, original)
			}
			if project.typeRelease != nil {
				project.typeRelease()
			}
		})
	}
}
func TestGovernanceEmptyConditionalNamesRejectsOtherShapes(t *testing.T) {
	for _, source := range []string{
		`true?{}:{...{x:1}}`, `true?{}:{['x']:1}`, `true?{}:{get x(){return 1}}`, `true?{}:{x(){return 1}}`, `true?{}:{x}`, `true?{}:({x:1} as any)`, `true?{x:1}:{y:1}`, `true?({} as unknown):{x:1}`,
	} {
		root := typeDemandFixture(t)
		governanceWrite(t, root, "mutations/demand.ts", `export {};const x=1;const out=`+source+`;out;`)
		project, err := captureGovernedProject(root, governanceTestPolicy())
		if err != nil {
			t.Fatal(err)
		}
		file := governanceSharedProject(project).FilesByPath["mutations/demand.ts"]
		var expression *ast.Node
		walkFile(file.Source, func(node *ast.Node) bool {
			if node.Kind == ast.KindConditionalExpression {
				expression = node
			}
			return true
		})
		if _, ok := governanceEmptyConditionalNames(expression); ok {
			t.Fatal("admitted", source)
		}
	}
}

func TestGovernanceEmptyConditionalNamesTransitiveAdmission(t *testing.T) {
	for _, test := range []struct{ name, entry string }{
		{"imported non-root", "import './mutations/sample.js';"},
		{"excluded source", "export {};"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"noLib":true},"include":["entry.ts"]}`)
			governanceWrite(t, root, "entry.ts", test.entry)
			governanceWrite(t, root, "mutations/sample.ts", `export const patch=true?{}:{status:"active"};`)
			project, err := captureGovernedProject(root, governanceTestPolicy())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if project.typeRelease != nil {
					project.typeRelease()
				}
			})
			file := governanceSharedProject(project).FilesByPath["mutations/sample.ts"]
			var expression *ast.Node
			walkFile(file.Source, func(node *ast.Node) bool {
				if node.Kind == ast.KindConditionalExpression {
					expression = node
				}
				return true
			})
			observed := project.typeOwner.names(file, expression)
			_, typ, known := project.typeOwner.expression(file, expression)
			original := sourcepolicy.NamesObservation{Known: known}
			if typ != nil {
				if names, ok := project.typeOwner.propertyNames(typ); ok {
					original.Names = names
				}
			}
			if test.name == "imported non-root" && (!original.Known || !reflect.DeepEqual(original.Names, []string{"status"})) {
				t.Fatalf("original imported checker proof missing: %#v", original)
			}
			if test.name == "excluded source" && (!original.Known || original.Names != nil) {
				t.Fatalf("original excluded source proof changed: %#v", original)
			}
			if !reflect.DeepEqual(observed, original) {
				t.Fatalf("names=%#v original checker=%#v", observed, original)
			}
		})
	}
}
