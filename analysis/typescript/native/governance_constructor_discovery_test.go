package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func TestConstructorExclusionPreservesOriginalDiscoveryAndBudgetBoundary(t *testing.T) {
	fixtures := []string{
		`String(1); const alias=String; opaque(alias); declare function opaque(value:object):void;`,
		`function localImpl(parameter:any){parameter.changed=1;} declare const receiver:{[key:string]:typeof localImpl}; receiver['map'](String); String(1);`,
		`class Box { constructor(public value:any){value.changed=1;} } function local(parameter:any){new Box(parameter);} local(String); String(1);`,
		`function generic<T extends {required:true}>(parameter:T){parameter.required=true;} generic(String); String(1);`,
		`function rest(...parameter:any[]){parameter[0].changed=1;} rest(String,String); String(1);`,
		`declare const union:((first:any)=>void)|((second:string)=>void); union(String); String(1);`,
		`function overload(parameter:string):void; function overload(parameter:number):void; function overload(parameter:any){parameter.changed=1;} overload(String); String(1);`,
	}
	for _, text := range fixtures {
		t.Run(text[:min(30, len(text))], func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "queries/cases.ts", text)
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
			context := owner.DemandContext(observabledecision.Limits{})
			baseline := context
			baseline.ConstructorDiscovery = nil
			want := observabledecision.ObserveQueries(baseline)
			got := observabledecision.ObserveQueries(context)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("discovery changed: got%+v want%+v", got, want)
			}
			file := owner.ByPath["queries/cases.ts"]
			var selected *ast.Node
			walk(file.Source.AsNode(), func(n *ast.Node) bool {
				if n.Kind == ast.KindCallExpression && n.AsCallExpression().Expression.Kind == ast.KindIdentifier && n.AsCallExpression().Expression.Text() == "String" {
					selected = n.AsCallExpression().Expression
				}
				return true
			})
			if selected == nil {
				t.Fatal("fixture String call missing")
			}
			exclusion := context.ConstructorDiscovery(file.Path, selected, observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64})
			if !exclusion.Known || !exclusion.Excluded {
				t.Fatalf("no closed exclusion %+v", exclusion)
			}
			mutation := context.Effect(observabledecision.EffectRequest{Path: file.Path, Operation: "binding-mutation:String", Node: selected})
			escape := context.Effect(observabledecision.EffectRequest{Path: file.Path, Operation: "binding-escape:String", Node: selected})
			if mutation.Unavailable || escape.Unavailable || 1+mutation.VirtualSteps+escape.VirtualSteps > exclusion.MaximumSteps {
				t.Fatalf("original effect cost/authority outside certificate: mutation%+v escape%+v exclusion%+v", mutation, escape, exclusion)
			}
			below := context.ConstructorDiscovery(file.Path, selected, observabledecision.Limits{MaximumSteps: exclusion.MaximumSteps - 1, MaximumDepth: 64})
			if below.Known || below.Excluded {
				t.Fatalf("unsafe budget shortcut %+v", below)
			}
			equal := context.ConstructorDiscovery(file.Path, selected, observabledecision.Limits{MaximumSteps: exclusion.MaximumSteps, MaximumDepth: 64})
			if !equal.Known || !equal.Excluded {
				t.Fatal("exact bound rejected")
			}
		})
	}
}
func TestDiscoveryCeilingKeepsMissingAuthorityAndUnknownClassification(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "queries/cases.ts", `function inspect(parameter:any){parameter.changed=1;} inspect(String); String(1);`)
	governanceWrite(t, root, "tsconfig.json", `{"include":["queries/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	for _, missing := range []string{"membership", "admission", "parameter"} {
		authority := owner.EffectAuthority()
		if missing == "membership" {
			authority.MembershipComplete = false
		}
		if missing == "admission" {
			authority.CandidateAdmitted = func(observabledecision.CapturedFile, *ast.Node, string) (bool, bool) { return false, false }
		}
		core := observabledecision.NewCapturedNativeEffectCore(owner.Files, authority)
		classify := func(observabledecision.CapturedFile, *ast.Node) (bool, bool) { return true, missing != "parameter" }
		ceiling := core.NewDiscoveryAliasCeiling(classify, func(observabledecision.CapturedFile, *ast.Node, string) bool { return true })
		if _, known := ceiling("String"); known {
			t.Fatalf("%s gap erased", missing)
		}
	}
}

func TestImportedExternalExclusionPreservesDiscovery(t *testing.T) {
	for _, body := range []string{`NodeId('x'); [1].map(NodeId);`, `function local(NodeId:any){NodeId('x');} NodeId('x');`, `const alias=NodeId; alias('x'); NodeId('x');`} {
		t.Run(body, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "package.json", `{"name":"fixture","type":"module"}`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", `export declare function NodeId(value:any):string;`)
			governanceWrite(t, root, "queries/cases.ts", `import {NodeId} from '@astrale-os/sdk'; `+body)
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
			ctx := owner.DemandContext(observabledecision.Limits{})
			baseline := ctx
			baseline.ConstructorDiscovery = nil
			file := owner.ByPath["queries/cases.ts"]
			closed := 0
			walk(file.Source.AsNode(), func(node *ast.Node) bool {
				if node.Kind == ast.KindCallExpression && node.AsCallExpression().Expression.Kind == ast.KindIdentifier {
					if exclusion := ctx.ConstructorDiscovery(file.Path, node.AsCallExpression().Expression, observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64}); exclusion.Known && exclusion.Excluded {
						closed++
					}
				}
				return true
			})
			if closed == 0 {
				t.Fatal("fixture admitted no external exclusion")
			}
			if got, want := observabledecision.ObserveQueries(ctx), observabledecision.ObserveQueries(baseline); !reflect.DeepEqual(got, want) {
				t.Fatalf("import discovery differs: got%+v want%+v", got, want)
			}
			for _, missing := range []string{"unavailable", "reason", "constructor"} {
				candidate, original := ctx, baseline
				candidate.Resolve = func(path, specifier, export string) observabledecision.Resolution {
					switch missing {
					case "unavailable":
						return observabledecision.Resolution{Unavailable: true}
					case "reason":
						return observabledecision.Resolution{Reason: "missing original route"}
					default:
						return observabledecision.Resolution{Origin: &observabledecision.Origin{Package: "@astrale-os/sdk", File: "src/application/query/define.ts", Path: []string{"defineQuery"}}}
					}
				}
				original.Resolve = candidate.Resolve
				if got, want := observabledecision.ObserveQueries(candidate), observabledecision.ObserveQueries(original); !reflect.DeepEqual(got, want) {
					t.Fatalf("authority %s changed outcome: got%+v want%+v", missing, got, want)
				}
			}
			for _, steps := range []int{1, 2, 3, 4, 8, 16, 4096} {
				for _, depth := range []int{1, 2, 4, 64} {
					candidate, original := ctx, baseline
					candidate.Limits = observabledecision.Limits{MaximumSteps: steps, MaximumDepth: depth}
					original.Limits = candidate.Limits
					if got, want := observabledecision.ObserveQueries(candidate), observabledecision.ObserveQueries(original); !reflect.DeepEqual(got, want) {
						t.Fatalf("boundary steps%d depth%d: got%+v want%+v", steps, depth, got, want)
					}
				}
			}
		})
	}
}
