package main

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

const currentRestDeclarations = `
export interface Generic<T> {apply<U>(callback:(value:T)=>U, optional?:boolean):U}
export declare const generic:Generic<{readonly name:{readonly key:string}}>;
export declare function plain(value:string):string;
export declare function variadic<T extends unknown[]>(...values:T):T;
export declare function overloaded(value:string):string;
export declare function overloaded(value:number, extra?:boolean):number;
export declare function mixed(value:string):string;
export declare function mixed(...values:number[]):number;
export declare function completeNodeValues<T>(value:T):T[];
`

type currentRestCase struct {
	name, source string
	want         bool
}

func currentRestCases() []currentRestCase {
	return []currentRestCase{
		{"instantiated-generic-member", `const result=generic.apply(value=>({key:value.name.key}));`, true},
		{"context-coupled-suffix", `const result=generic.apply(value=>({key:value.name.key}));function coupled(value:typeof result):typeof result{return value}const contextSuffix=coupled(result);`, true},
		{"actual-array-map-context", `const result=completeNodeValues({name:{key:'name'}}).map(value=>({name:value.name.key}));`, true},
		{"readonly-array-map-context", `declare const values:readonly {name:{key:string}}[];const result=values.map(value=>({name:value.name.key}));`, true},
		{"overloads-distinct-parameter-identities", `const result=overloaded(true);`, true},
		{"excess-arguments-no-rest", `const result=plain('one','two','three');`, true},
		{"bad-explicit-typeargs", `const result=generic.apply<number,string>(value=>value.name.key);`, true},
		{"wrong-contextual-callback", `const result=generic.apply((value:number)=>value);`, true},
		{"local-callable", `const fn=(value:string)=>value;const result=fn('one');`, true},
		{"asserted-current-no-rest", `const fn=variadic as unknown as ((value:string)=>string);const result=fn('one');`, true},
		{"flow-current-no-rest", `interface Plain{(value:string):string;readonly kind:'plain'}interface Rest{(...values:string[]):string;readonly kind:'rest'}declare const fn:Plain|Rest;declare function isPlain(value:typeof fn):value is Plain;if(isPlain(fn)){const result=fn('one');}`, true},
		{"current-rest-cast", `const fn=plain as unknown as ((...values:string[])=>string);const result=fn('one','two');`, false},
		{"current-rest-flow", `interface Plain{(value:string):string;readonly kind:'plain'}interface Rest{(...values:string[]):string;readonly kind:'rest'}declare const fn:Plain|Rest;declare function isRest(value:typeof fn):value is Rest;if(isRest(fn)){const result=fn('one','two');}`, false},
		{"mixed-rest-overload", `const result=mixed('one');`, false},
		{"variadic-tuple", `const result=variadic('one',1);`, false},
		{"fixed-tuple-rest", `declare const fn:(...values:[string,number])=>string;const result=fn('one',1);`, false},
		{"current-union", `declare const fn:((value:string)=>string)|((value:number)=>number);const result=fn('one');`, false},
		{"current-intersection", `declare const fn:((value:string)=>string)&{readonly marker:true};const result=fn('one');`, false},
		{"current-typeparameter", `function use<F extends (value:string)=>string>(fn:F){const result=fn('one');}`, false},
		{"call-and-construct", `declare const fn:{(value:string):string;new(value:string):Object};const result=fn('one');`, false},
		{"any", `declare const fn:any;const result=fn('one');`, false},
		{"unknown", `declare const fn:unknown;const result=fn('one');`, false},
		{"never", `declare const fn:never;const result=fn('one');`, false},
		{"error-recovery", `const result=missing('one');`, false},
		{"optional-chain", `const result=plain?.('one');`, false},
		{"spread", `const result=plain(...['one']);`, false},
	}
}

func currentRestRoot(t *testing.T, source string) string {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "package.json", `{"name":"fixture","type":"module"}`)
	governanceWrite(t, root, "node_modules/external/package.json", `{"name":"external","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/external/index.d.ts", currentRestDeclarations)
	governanceWrite(t, root, "queries/case.ts", `import {generic,plain,variadic,overloaded,mixed,completeNodeValues} from 'external';`+source+`function downstream<T>(value:T):T{return value}const suffix=downstream({value:'after'});`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":false},"include":["queries/**/*.ts"]}`)
	return root
}

func currentRestOwner(t *testing.T, root string) (*governanceRuntimeAuthority, *ast.Node, *ast.Node) {
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
	var result, suffix, contextual *ast.Node
	walk(owner.ByPath["queries/case.ts"].Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil {
			switch node.Name().Text() {
			case "result":
				result = node.Initializer()
			case "suffix":
				suffix = node.Initializer()
			case "contextSuffix":
				contextual = node.Initializer()
			}
		}
		return true
	})
	if contextual != nil {
		suffix = contextual
	}
	if result == nil || result.Kind != ast.KindCallExpression || suffix == nil {
		t.Fatal("missing actual result/suffix calls")
	}
	return owner, result, suffix
}

func TestCurrentCallableNoRestProjection(t *testing.T) {
	for _, item := range currentRestCases() {
		t.Run(item.name, func(t *testing.T) {
			owner, call, _ := currentRestOwner(t, currentRestRoot(t, item.source))
			if got := owner.currentCallableHasNoRest(call); got != item.want {
				t.Fatalf("current family noRest=%v want=%v", got, item.want)
			}
			if item.want {
				original := owner.callObservedArguments(owner.ByPath["queries/case.ts"], call, true)
				for _, binding := range original.Bindings {
					if binding.Rest {
						t.Fatal("negative family projection hid an original rest binding")
					}
				}
			}
		})
	}
}

// Value evaluation precedes every selected-signature/diagnostic observation.
// Separate owners prevent the oracle from warming the suppressed callback.
func TestCurrentCallShapeProductionFirstAndCompleteSuffix(t *testing.T) {
	for _, item := range currentRestCases() {
		t.Run(item.name, func(t *testing.T) {
			root := currentRestRoot(t, item.source)
			type row struct {
				Result, Suffix observabledecision.DemandOutcome
				Diagnostics    []string
				Rest           bool
			}
			var rows [2]row
			for mode := range rows {
				owner, call, suffix := currentRestOwner(t, root)
				ctx := owner.DemandContext(observabledecision.Limits{})
				if mode == 0 {
					ctx.CallShape = owner.demandCallShapes(func(*ast.Node) bool { return false })
				}
				reader := observabledecision.NewNativeValueReader(ctx)
				limits := observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64, MaximumAlternatives: 32}
				rows[mode].Result = reader.Expression("queries/case.ts", call).Resolve(limits).Outcome
				rows[mode].Suffix = reader.Expression("queries/case.ts", suffix).Resolve(limits).Outcome
				check := owner.Identity.TypeOwner.program.Checker
				// This DIFFERENT original typed call comes before the skipped target.
				check.GetResolvedSignature(suffix)
				for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
					rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
				}
				rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
				original := owner.Call(owner.ByPath["queries/case.ts"], call)
				for _, binding := range original.Bindings {
					rows[mode].Rest = rows[mode].Rest || binding.Rest
				}
				rows[mode].Result = currentRestOwnedReads(owner, rows[mode].Result)
				rows[mode].Suffix = currentRestOwnedReads(owner, rows[mode].Suffix)
				if signature := check.GetResolvedSignature(call); signature == nil || checker.Signature_parameters(signature) == nil && rows[mode].Rest {
					t.Fatal("invalid original rest/signature observation")
				}
				same, err := owner.Identity.Project.capture.Verify()
				if err != nil || !same {
					t.Fatalf("source seal=%v err=%v", same, err)
				}
			}
			if !reflect.DeepEqual(rows[0], rows[1]) {
				t.Fatalf("original=%#v candidate=%#v", rows[0], rows[1])
			}
		})
	}
}

// The original resolver may have populated a selected signature through an
// earlier contextual demand. A current family proof must agree in that order
// too; this is not a substitute for the product-FIRST cases above.
func TestCurrentCallShapeAfterOriginalContextualSignature(t *testing.T) {
	root := currentRestRoot(t, `const values:{name:string}[]=completeNodeValues({name:{key:'name'}}).map(value=>({name:value.name.key}));const result=values.map(value=>value.name);`)
	type row struct {
		Result, Suffix observabledecision.DemandOutcome
		Diagnostics    []string
	}
	var rows [2]row
	for mode := range rows {
		owner, call, suffix := currentRestOwner(t, root)
		check := owner.Identity.TypeOwner.program.Checker
		if check.GetResolvedSignature(call) == nil {
			t.Fatal("prior original contextual signature missing")
		}
		ctx := owner.DemandContext(observabledecision.Limits{})
		if mode == 0 {
			ctx.CallShape = owner.demandCallShapes(func(*ast.Node) bool { return false })
		}
		reader := observabledecision.NewNativeValueReader(ctx)
		limits := observabledecision.Limits{MaximumSteps: 4096, MaximumDepth: 64, MaximumAlternatives: 32}
		rows[mode].Result = reader.Expression("queries/case.ts", call).Resolve(limits).Outcome
		rows[mode].Suffix = reader.Expression("queries/case.ts", suffix).Resolve(limits).Outcome
		for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
			rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
		}
		rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
		rows[mode].Result = currentRestOwnedReads(owner, rows[mode].Result)
		rows[mode].Suffix = currentRestOwnedReads(owner, rows[mode].Suffix)
		if len(rows[mode].Diagnostics) != 0 {
			t.Fatalf("contextual positive must be valid: %v", rows[mode].Diagnostics)
		}
	}
	if !reflect.DeepEqual(rows[0], rows[1]) {
		t.Fatalf("cached original=%#v candidate=%#v", rows[0], rows[1])
	}
}

// Only this actual owning capture's emitted tickets receive a source-owned
// alpha-renaming. Revisions, every read row, all other tokens and their order
// remain exact. A ticket from another capture cannot match this finite table.
func currentRestOwnedReads(owner *governanceRuntimeAuthority, value observabledecision.DemandOutcome) observabledecision.DemandOutcome {
	capture := owner.Identity.Project.capture
	for index, read := range value.Reads {
		for revision := uint64(1); revision <= capture.ticket.revision; revision++ {
			ticket := fmt.Sprintf("private-capture:%d:%d", capture.ticket.owner, revision)
			if read.Fingerprint == ticket {
				value.Reads[index].Fingerprint = fmt.Sprintf("paired-owned-capture:%d", revision)
				break
			}
		}
	}
	return value
}
