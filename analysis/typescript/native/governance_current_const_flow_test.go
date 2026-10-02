package main

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

func currentConstFlowCases() []declaredHeadsCase {
	return []declaredHeadsCase{
		{"stored-fluent", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", true},
		{"stored-recursive-fluent", `const callback=()=>{const first=Query.from({nodes:[]});const expanded=first.expand({});return expanded.select({})};`, "", true},
		{"stored-unreachable-prefix", `declare function stop():never;const callback=()=>{stop();const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", true},
		{"stored-malformed-arity", `const callback=()=>{const expanded=Query.from().expand();return expanded.select()};`, "", true},
		{"stored-error-generic", `const callback=()=>{const expanded=Query.from<number>(1).expand({});return expanded.select({})};`, "", true},
		{"stored-annotation", `const callback=()=>{const expanded:ExpandedBuilder=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-assertion", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({}) as ExpandedBuilder;return expanded.select({})};`, "", false},
		{"stored-satisfies", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({}) satisfies ExpandedBuilder;return expanded.select({})};`, "", false},
		{"stored-parentheses", `const callback=()=>{const expanded=(Query.from({nodes:[]}).expand({}));return expanded.select({})};`, "", false},
		{"stored-non-null", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({})!;return expanded.select({})};`, "", false},
		{"stored-conditional", `declare const flag:boolean;const callback=()=>{const expanded=flag?Query.from({nodes:[]}).expand({}):Query.from({edges:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-let", `const callback=()=>{let expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-using", `const callback=()=>{using expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-await-using", `const callback=async()=>{await using expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-jsdoc", `const callback=()=>{/** @type {ExpandedBuilder} */const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-other-assignment", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});const other=Query.from({edges:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-same-name-other-pointer", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});{const expanded=Query.from({edges:[]}).expand({})}return expanded.select({})};`, "", false},
		{"stored-branch", `declare const flag:boolean;const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});if(flag){return expanded.select({})}return 1};`, "", false},
		{"stored-loop", `declare const flag:boolean;const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});while(flag){expanded.select({})}return 1};`, "", false},
		{"stored-captured-container", `const expanded=Query.from({nodes:[]}).expand({});const callback=()=>expanded.select({});`, "", false},
		{"stored-export", `export const expanded=Query.from({nodes:[]}).expand({});const callback=()=>expanded.select({});`, "", false},
		{"stored-unknown-head", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, `export interface QueryAPI {from(value:string):unknown}`, false},
		{"stored-current-namespace-head", `declare module '@astrale-os/kernel-core' {interface ExpandedBuilder {extra():void}}const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false},
		{"stored-local-call", `const local=()=>({select(value:any){return 1}});const callback=()=>{const expanded=local();return expanded.select({})};`, "", false},
		{"stored-flow-predicate-self", `const local={marker:true as const,expand(value:any):ExpandedBuilder{return this},filter(value:any):ExpandedBuilder{return this},select:function self(value:any):number {const expanded=Query.from({nodes:[]}).expand({});if(isLocal(expanded)){expanded.select({})}return 1}};declare function isLocal(value:ExpandedBuilder):value is typeof local;`, "", false},
		{"stored-flow-assertion-self", `const local={marker:true as const,expand(value:any):ExpandedBuilder{return this},filter(value:any):ExpandedBuilder{return this},select:function self(value:any):number {const expanded=Query.from({nodes:[]}).expand({});assertLocal(expanded);expanded.select({});return 1}};declare function assertLocal(value:ExpandedBuilder):asserts value is typeof local;`, "", false},
		{"stored-local-self", `const local={select:function self(value:any):number {const expanded=localFactory();expanded.select({});return 1}};function localFactory(){return local}`, "", false},
	}
}

func TestCurrentConstFlowHeadsActualAssignmentAndFallback(t *testing.T) {
	for _, item := range currentConstFlowCases() {
		t.Run(item.name, func(t *testing.T) {
			owner, fn, expression := declaredHeadsOwner(t, declaredHeadsRoot(t, item))
			proof := owner.externalDeclaredMemberCannotSelf(expression, owner.functionKey(fn))
			if proof != item.want {
				t.Fatalf("current original flow proof=%v want=%v", proof, item.want)
			}
			check := owner.Identity.TypeOwner.program.Checker
			if item.want {
				reference := expression.AsPropertyAccessExpression().Expression
				flow := reference.FlowNodeData().FlowNode
				symbol := check.GetSymbolAtLocation(reference)
				if flow == nil || symbol == nil || flow.Node != symbol.ValueDeclaration {
					t.Fatal("positive did not bind exact original assignment pointer")
				}
				t.Logf("original reference=%p flow=%p declaration=%p flags=%d", reference, flow, flow.Node, flow.Flags)
			}
			target := declaredHeadsActualTarget(owner, expression)
			if proof && target == owner.functionKey(fn) {
				t.Fatal("current const proof hid actual self")
			}
			if strings.HasSuffix(item.name, "-self") {
				if target != owner.functionKey(fn) {
					t.Fatal("fallback fixture did not reach exact original self")
				}
				for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
					if diagnostics := check.GetDiagnostics(context.Background(), source); len(diagnostics) != 0 {
						t.Fatalf("self fixture must be valid: %v", declaredHeadsDiagnostics(diagnostics))
					}
				}
			}
		})
	}
}

func TestCurrentConstFlowProductionFirstAndOrderedSuffix(t *testing.T) {
	cases := append(currentConstFlowCases(), declaredHeadsCase{"stored-external-then-self", `const callback=():number=>{const expanded=Query.from({nodes:[]}).expand({});expanded.select({});callback();return 1};`, "", true})
	for _, cached := range []bool{false, true} {
		for _, item := range cases {
			t.Run(fmt.Sprintf("cached-%v/%s", cached, item.name), func(t *testing.T) {
				item.text += `function downstream(value:ReturnType<typeof Query.from>){return value}const observed=downstream(Query.from({nodes:[{suffix:true}]}));`
				root := declaredHeadsRoot(t, item)
				type row struct {
					Summary     observabledecision.EffectSummary
					Suffix      []string
					Target      string
					Diagnostics []string
				}
				var rows [2]row
				for mode := range rows {
					owner, fn, expression := declaredHeadsOwner(t, root)
					check := owner.Identity.TypeOwner.program.Checker
					if cached {
						check.GetResolvedSignature(expression.Parent)
					}
					reader := owner.externalFactoryMemberCannotSelfOriginal
					if mode == 1 {
						reader = owner.externalFactoryMemberCannotSelf
					}
					request := observabledecision.EffectRequest{Path: "queries/case.ts", Node: fn, Operation: "invoke-function"}
					rows[mode].Summary = owner.scopedEffectsWithMemberOrigin(request, reader)
					if repeat := owner.scopedEffectsWithMemberOrigin(request, reader); !reflect.DeepEqual(repeat, rows[mode].Summary) {
						t.Fatal("same owner repeated production proof changed")
					}
					var suffix *ast.Node
					walk(owner.ByPath["queries/case.ts"].Source.AsNode(), func(node *ast.Node) bool {
						if node.Kind == ast.KindCallExpression && node.Expression().Kind == ast.KindIdentifier && node.Expression().Text() == "downstream" {
							suffix = node
						}
						return true
					})
					if suffix == nil {
						t.Fatal("context-coupled suffix missing")
					}
					value, signature := check.GetTypeAtLocation(suffix), check.GetResolvedSignature(suffix)
					if value == nil || signature == nil {
						t.Fatal("original suffix observation missing")
					}
					rows[mode].Suffix = append(rows[mode].Suffix, fmt.Sprintf("%d:%d:%d:%s", value.Flags(), value.ObjectFlags(), len(checker.Signature_parameters(signature)), owner.symbolKey(value.Symbol())))
					if declaration := signature.Declaration(); declaration != nil {
						rows[mode].Suffix = append(rows[mode].Suffix, fmt.Sprintf("signature:%s:%d:%d:%d", ast.GetSourceFileOfNode(declaration).FileName(), declaration.Pos(), declaration.End(), declaration.Kind))
					}
					for _, parameter := range checker.Signature_parameters(signature) {
						rows[mode].Suffix = append(rows[mode].Suffix, "parameter:"+owner.symbolKey(parameter))
					}
					for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
						rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
					}
					rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
					// The suppressed target is not observed until after the suffix
					// and whole diagnostics. It cannot prewarm these comparisons.
					rows[mode].Target = declaredHeadsActualTarget(owner, expression)
					same, err := owner.Identity.Project.capture.Verify()
					if err != nil || !same {
						t.Fatalf("source seal=%v err=%v", same, err)
					}
				}
				if !reflect.DeepEqual(rows[0], rows[1]) {
					t.Fatalf("original=%#v candidate=%#v", rows[0], rows[1])
				}
				if strings.HasSuffix(item.name, "-self") && rows[1].Summary.Reason != "VALUE_RECURSION" {
					t.Fatal("production first lost actual self recurrence")
				}
			})
		}
	}
}

// JavaScript parser mode, including JSDoc, is deliberately outside the original
// TypeScript assignment certificate even when its declaration syntax is equal.
func TestCurrentConstFlowJavaScriptFallback(t *testing.T) {
	root := declaredHeadsRoot(t, declaredHeadsCase{"javascript", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", false})
	governanceWrite(t, root, "queries/case.ts", `import {Query} from '@astrale-os/kernel-core';const callback=()=>{/** @type {any} */const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`)
	if err := os.Rename(root+"/queries/case.ts", root+"/queries/case.js"); err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"allowJs":true,"checkJs":true,"skipLibCheck":false},"include":["queries/**/*.js"]}`)
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
	file, exists := owner.ByPath["queries/case.js"]
	if !exists {
		t.Fatal("actual JS source missing")
	}
	var fn, expression *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindArrowFunction {
			fn = node
		}
		if node.Kind == ast.KindPropertyAccessExpression && node.Name().Text() == "select" {
			expression = node
		}
		return true
	})
	if fn == nil || expression == nil {
		t.Fatal("actual JS member missing")
	}
	if file.Source.AsNode().Flags&ast.NodeFlagsJavaScriptFile == 0 {
		t.Fatal("not original JavaScript parser mode")
	}
	if owner.externalDeclaredMemberCannotSelf(expression, owner.functionKey(fn)) {
		t.Fatal("JS certificate must decline")
	}
}
