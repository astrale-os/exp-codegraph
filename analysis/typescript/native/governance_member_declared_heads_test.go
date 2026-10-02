package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

const declaredHeadsFixture = `
export interface NodeBuilder<T=unknown> {readonly input:T;expand(value:any):ExpandedBuilder;filter(value:any):NodeBuilder<T>;select(value:any):number}
export interface EdgeBuilder<T=unknown> {readonly input:T;expand(value:any):ExpandedBuilder;filter(value:any):EdgeBuilder<T>;select(value:any):number}
export interface ExpandedBuilder {expand(value:any):ExpandedBuilder;filter(value:any):ExpandedBuilder;select(value:any):number}
export interface QueryAPI {from<T extends {nodes:unknown[]}>(value:T):NodeBuilder<T>;from<T extends {edges:unknown[]}>(value:T):EdgeBuilder<T>;from(value:any):NodeBuilder|EdgeBuilder}
export declare const Query:QueryAPI;
export interface QueryPropertyEqualPredicate {readonly kind:'property.equal';readonly property:string;readonly value:string}
export interface QueryPropertyPresentPredicate {readonly kind:'property.present';readonly property:string}
export interface QueryPropertyPredicateBuilder {equals(value:string):QueryPropertyEqualPredicate;isPresent():QueryPropertyPresentPredicate}
export declare function Property(input:string):QueryPropertyPredicateBuilder;
`

type declaredHeadsCase struct {
	name, text, declaration string
	want                    bool
}

func declaredHeadsCases() []declaredHeadsCase {
	return []declaredHeadsCase{
		{"all-overloads", `const callback=()=>Query.from({nodes:[]}).select({});`, "", true},
		{"recursive-node-edge-heads", `const callback=()=>Query.from({edges:[]}).expand({}).filter({}).expand({}).select({});`, "", true},
		{"malformed-arity", `const callback=()=>Query.from().expand().select();`, "", true},
		{"invalid-generic-recovery", `const callback=()=>Query.from<number>(1).expand({}).select({});`, "", true},
		{"const-value-alias", `const alias=Query;const callback=()=>alias.from({nodes:[]}).expand({}).select({});`, "", true},
		{"import-spelling-independent", `const callback=()=>Renamed.from({nodes:[]}).expand({}).select({});`, "", true},
		{"self-key-is-member-key", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, "", true},
		{"cast-intermediate", `const callback=()=> (Query.from({nodes:[]}) as ExpandedBuilder).select({});`, "", false},
		{"optional-call", `const callback=()=>Query.from?.({nodes:[]}).expand({}).select({});`, "", false},
		{"optional-member", `const callback=()=>Query.from({nodes:[]})?.select({});`, "", false},
		{"element-call", `const callback=()=>Query['from']({nodes:[]}).expand({}).select({});`, "", false},
		{"shadowed-root", `const Query={from:()=>({expand:()=>({select:()=>1})})};const callback=()=>Query.from({}).expand({}).select({});`, "", false},
		{"any-root", `const value:any=Query;const callback=()=>value.from({}).expand({}).select({});`, "", false},
		{"union-root-local-origin", `declare const condition:boolean;const value=condition?Query:{from(value:any){return {select(value:any){return 1}}}};const callback=()=>value.from({}).select({});`, "", false},
		{"unknown-overload-return", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface QueryAPI {from(value:string):unknown}`, false},
		{"typeparameter-overload-return", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface QueryAPI {from<T>(value:T):T}`, false},
		{"unresolved-overload-return", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface QueryAPI {from(value:string):Missing}`, false},
		{"return-alias", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export type Alias=NodeBuilder;export interface QueryAPI {from(value:string):Alias}`, false},
		{"return-intersection", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface QueryAPI {from(value:string):NodeBuilder&EdgeBuilder}`, false},
		{"current-head-augmentation", `declare module '@astrale-os/kernel-core' {interface ExpandedBuilder {extra():void}}const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, "", false},
		{"current-root-overload-augmentation", `declare module '@astrale-os/kernel-core' {interface QueryAPI {from(value:string):ExpandedBuilder}}const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, "", false},
		{"head-heritage", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface Base {other():void}export interface ExpandedBuilder extends Base {}`, false},
		{"computed-head-member", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `declare const key:unique symbol;export interface ExpandedBuilder {[key]:string}`, false},
		{"optional-terminal-member", `const callback=()=>Query.from({nodes:[]}).expand({}).select({});`, `export interface ExpandedBuilder {select?(value:number):number}`, false},
		{"flow-predicate-self", `const localQuery={marker:true,from(value:any){return {select:function self(value:any):number {if(isLocal(Query)) Query.from({}).select({});return 1}}}};declare function isLocal(value:QueryAPI):value is typeof localQuery;`, "", false},
		{"assertion-alias-self", `const localQuery={marker:true,from(value:any){return {select:function self(value:any):number {assertLocal(Query); Query.from({}).select({});return 1}}}};declare function assertLocal(value:QueryAPI):asserts value is typeof localQuery;`, "", false},
		{"asserted-callable-alias-self", `const localExpanded={expand(value:any){return {select:function self(value:any):number {Q.from({}).expand({}).select({});return 1}}}};namespace Q {export const from=Query.from as unknown as ((value:any)=>typeof localExpanded)}`, "", false},
		{"bounded-chain", `const callback=()=>Query.from({nodes:[]})` + strings.Repeat(`.expand({})`, 40) + `.select({});`, "", false},
	}
}

func declaredHeadsRoot(t *testing.T, item declaredHeadsCase) string {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "package.json", `{"name":"fixture","type":"module"}`)
	governanceWrite(t, root, "node_modules/@astrale-os/kernel-core/package.json", `{"name":"@astrale-os/kernel-core","types":"index.d.ts"}`)
	declaration := declaredHeadsFixture + item.declaration
	if item.name == "flow-predicate-self" || item.name == "assertion-alias-self" {
		declaration = `export interface ExpandedBuilder {select(value:any):number}export interface QueryAPI {from(value:any):ExpandedBuilder}export declare const Query:QueryAPI;`
	}
	governanceWrite(t, root, "node_modules/@astrale-os/kernel-core/index.d.ts", declaration)
	prefix := `import {Query,Query as Renamed,type QueryAPI,type ExpandedBuilder,Property,type QueryPropertyEqualPredicate,type QueryPropertyPredicateBuilder} from '@astrale-os/kernel-core';`
	if item.name == "flow-predicate-self" || item.name == "assertion-alias-self" {
		prefix = `import {Query,Query as Renamed,type QueryAPI,type ExpandedBuilder} from '@astrale-os/kernel-core';`
	}
	if item.name == "shadowed-root" {
		prefix = "export {};"
	}
	governanceWrite(t, root, "queries/case.ts", prefix+item.text)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":false},"include":["queries/**/*.ts"]}`)
	return root
}

func declaredHeadsOwner(t *testing.T, root string) (*governanceRuntimeAuthority, *ast.Node, *ast.Node) {
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
	file := owner.ByPath["queries/case.ts"]
	var fn, expression *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindArrowFunction && node.Parent.Kind == ast.KindVariableDeclaration && node.Parent.Name().Text() == "callback" {
			fn = node
		}
		if node.Kind == ast.KindFunctionExpression && node.Name() != nil && node.Name().Text() == "self" {
			fn = node
		}
		if node.Kind == ast.KindPropertyAccessExpression && (node.Name().Text() == "select" || node.Name().Text() == "equals") && fn != nil && node.Pos() >= fn.Pos() && node.End() <= fn.End() {
			expression = node
		}
		return true
	})
	if fn == nil || expression == nil {
		t.Fatal("fixture function/member missing")
	}
	return owner, fn, expression
}

func declaredHeadsActualTarget(owner *governanceRuntimeAuthority, expression *ast.Node) string {
	x := &extractor{checker: owner.Identity.TypeOwner.program.Checker}
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
	return target
}

func TestDeclaredMemberHeadsAllCurrentOverloadsAndFallback(t *testing.T) {
	for _, item := range declaredHeadsCases() {
		t.Run(item.name, func(t *testing.T) {
			root := declaredHeadsRoot(t, item)
			owner, fn, expression := declaredHeadsOwner(t, root)
			self := owner.functionKey(fn)
			got := owner.externalDeclaredMemberCannotSelf(expression, self)
			if got != item.want {
				t.Fatalf("declared proof=%v want=%v", got, item.want)
			}
			target := declaredHeadsActualTarget(owner, expression)
			if got && target == self {
				t.Fatal("declaration proof concealed the original self target")
			}
			if strings.HasSuffix(item.name, "-self") && target != self {
				t.Fatal("flow regression fixture did not reach the actual self target")
			}
			if item.name == "self-key-is-member-key" && (target == "" || owner.externalDeclaredMemberCannotSelf(expression, target)) {
				t.Fatal("actual terminal declaration identity was not rejected")
			}
		})
	}
}

type declaredHeadsSuffix struct {
	Target, Signature, ReturnSymbol string
	SignaturePresent                bool
	Parameters, ReturnFlags         uint32
	ReturnObjectFlags               uint32
	FunctionFlags                   uint32
	Diagnostics                     []string
}

func declaredHeadsDiagnostics(rows []*ast.Diagnostic) []string {
	var result []string
	for _, row := range rows {
		file := ""
		if row.File() != nil {
			file = row.File().FileName()
		}
		result = append(result, fmt.Sprintf("%s:%d:%d:%d:%d:%v:%v", file, row.Code(), row.Category(), row.Pos(), row.End(), row.MessageKey(), row.MessageArgs()))
		result = append(result, declaredHeadsDiagnostics(row.MessageChain())...)
		result = append(result, declaredHeadsDiagnostics(row.RelatedInformation())...)
	}
	return result
}

// Independent original and candidate Programs run the same suffix in the same
// order. Counter differences are retained; equal Booleans are not a claim that
// resource/cache prefixes or arbitrary later compiler queries are equivalent.
func TestDeclaredMemberHeadsOriginalPrefixAndSubsequentObservations(t *testing.T) {
	for _, item := range declaredHeadsCases() {
		t.Run(item.name, func(t *testing.T) {
			root := declaredHeadsRoot(t, item)
			var observations [2]declaredHeadsSuffix
			var result [2]bool
			for mode := 0; mode < 2; mode++ {
				owner, fn, expression := declaredHeadsOwner(t, root)
				check := owner.Identity.TypeOwner.program.Checker
				before := [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount}
				if mode == 0 {
					result[mode] = owner.externalFactoryMemberCannotSelfOriginal(expression, owner.functionKey(fn))
				} else {
					result[mode] = owner.externalFactoryMemberCannotSelf(expression, owner.functionKey(fn))
				}
				prefix := [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount}
				row := declaredHeadsSuffix{Target: declaredHeadsActualTarget(owner, expression)}
				signature := check.GetResolvedSignature(expression.Parent)
				row.SignaturePresent = signature != nil
				if signature != nil {
					row.Parameters = uint32(len(checker.Signature_parameters(signature)))
					if declaration := signature.Declaration(); declaration != nil {
						row.Signature = fmt.Sprintf("%s:%d:%d:%d", ast.GetSourceFileOfNode(declaration).FileName(), declaration.Pos(), declaration.End(), declaration.Kind)
					}
					if returned := checker.Checker_getReturnTypeOfSignature(check, signature); returned != nil {
						row.ReturnFlags, row.ReturnObjectFlags = uint32(returned.Flags()), uint32(returned.ObjectFlags())
						row.ReturnSymbol = owner.symbolKey(returned.Symbol())
					}
				}
				if value := check.GetTypeAtLocation(fn); value != nil {
					row.FunctionFlags = uint32(value.Flags())
				}
				sources := append([]*ast.SourceFile(nil), owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles()...)
				sort.Slice(sources, func(left, right int) bool { return sources[left].FileName() < sources[right].FileName() })
				for _, source := range sources {
					row.Diagnostics = append(row.Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
				}
				row.Diagnostics = append(row.Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
				if strings.HasSuffix(item.name, "-self") && len(row.Diagnostics) != 0 {
					t.Fatalf("self counterexample must be an original valid Program: %v", row.Diagnostics)
				}
				observations[mode] = row
				t.Logf("mode=%d before=%v prefix=%v suffix=%v", mode, before, prefix, [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount})
				same, err := owner.Identity.Project.capture.Verify()
				if err != nil || !same {
					t.Fatalf("original fresh source seal=%v err=%v", same, err)
				}
			}
			if result[0] != result[1] || !reflect.DeepEqual(observations[0], observations[1]) {
				t.Fatalf("original result=%v observations=%#v; candidate result=%v observations=%#v", result[0], observations[0], result[1], observations[1])
			}
		})
	}
}

// Unlike the supplemental target test, this runs the production reducer FIRST.
// Its hit continues without a lookup of the skipped expression. The first
// downstream query is a different context-coupled call, not the skipped target.
func TestDeclaredMemberHeadsProductionReducerBeforeUnrelatedSuffix(t *testing.T) {
	cases := []declaredHeadsCase{
		{"two-external-calls", `const callback=()=>{Query.from({nodes:[]}).expand({}).filter({});Query.from({edges:[]}).expand({}).filter({});return 1};`, "", true},
		{"external-then-self", `const callback=():number=>{Query.from({nodes:[]}).expand({}).filter({});callback();return 1};`, "", true},
		{"direct-property-two-calls", `const callback=()=>{Property('key').equals('slug');Property('key').isPresent();return 1};`, "", true},
		{"direct-property-then-self", `const callback=():number=>{Property('key').equals('slug');callback();return 1};`, "", true},
		{"direct-property-current-overload-fallback", `declare module '@astrale-os/kernel-core' {function Property(input:number):QueryPropertyPredicateBuilder}const callback=()=>{Property('key').equals('slug');return 1};`, "", false},
		{"missing-head-fallback", `const callback=()=>{Query.from({nodes:[]}).expand({}).filter({});return 1};`, `export interface QueryAPI {from(value:string):Missing}`, false},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			// Keep one select access inside the callback for the common AST owner
			// fixture helper, but never query that target before the suffix.
			item.text = strings.Replace(item.text, "return 1", "Query.from({nodes:[]}).select({});return 1", 1)
			item.text += `const downstream=()=>Query.from({nodes:[{suffix:true}]}).select({});const observed=downstream();`
			root := declaredHeadsRoot(t, item)
			var summaries [2]observabledecision.EffectSummary
			var suffixes [2][]string
			for mode := 0; mode < 2; mode++ {
				owner, fn, _ := declaredHeadsOwner(t, root)
				check := owner.Identity.TypeOwner.program.Checker
				request := observabledecision.EffectRequest{Path: "queries/case.ts", Node: fn, Operation: "invoke-function"}
				reader := owner.externalFactoryMemberCannotSelfOriginal
				if mode == 1 {
					reader = owner.externalFactoryMemberCannotSelf
				}
				summaries[mode] = owner.scopedEffectsWithMemberOrigin(request, reader)
				if repeated := owner.scopedEffectsWithMemberOrigin(request, reader); !reflect.DeepEqual(repeated, summaries[mode]) {
					t.Fatal("same-generation scoped proof cache changed the result")
				}
				prefix := [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount}
				var downstream *ast.Node
				walk(owner.ByPath["queries/case.ts"].Source.AsNode(), func(node *ast.Node) bool {
					if node.Kind == ast.KindCallExpression && node.Expression().Kind == ast.KindIdentifier && node.Expression().Text() == "downstream" {
						downstream = node
					}
					return true
				})
				if downstream == nil {
					t.Fatal("unrelated suffix absent")
				}
				value := check.GetTypeAtLocation(downstream)
				signature := check.GetResolvedSignature(downstream)
				if value == nil || signature == nil {
					t.Fatal("unrelated original typed observation absent")
				}
				suffixes[mode] = append(suffixes[mode], fmt.Sprintf("%d:%d:%d", value.Flags(), value.ObjectFlags(), len(checker.Signature_parameters(signature))))
				for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
					suffixes[mode] = append(suffixes[mode], declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
				}
				suffixes[mode] = append(suffixes[mode], declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
				t.Logf("mode=%d reducer=%v final=%v", mode, prefix, [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount})
			}
			if !reflect.DeepEqual(summaries[0], summaries[1]) || !reflect.DeepEqual(suffixes[0], suffixes[1]) {
				t.Fatalf("original summary=%#v suffix=%v; candidate summary=%#v suffix=%v", summaries[0], suffixes[0], summaries[1], suffixes[1])
			}
			if (item.name == "external-then-self" || item.name == "direct-property-then-self") && summaries[1].Reason != "VALUE_RECURSION" {
				t.Fatal("second call self recurrence was lost")
			}
		})
	}
}
