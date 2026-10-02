package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

func directCallableHeadCases() []declaredHeadsCase {
	return []declaredHeadsCase{
		{"actual-core-property", `const callback=()=>Property('key').equals('slug');`, "", true},
		{"direct-canonical-value-alias", `const saved=Property;const callback=()=>saved('key').equals('slug');`, "", true},
		{"direct-import-rename", `import {Property as RenamedProperty} from '@astrale-os/kernel-core';const callback=()=>RenamedProperty('key').equals('slug');`, "", true},
		{"direct-self-key-is-member-key", `const callback=()=>Property('key').equals('slug');`, "", true},
		{"direct-malformed-arity", `const callback=()=>Property().equals();`, "", true},
		{"direct-invalid-generic-recovery", `const callback=()=>Property<number>(1).equals('slug');`, "", true},
		{"direct-all-current-heads", `const callback=()=>Property('key').equals('slug');`, `export interface OtherPredicateBuilder {equals(value:string):QueryPropertyEqualPredicate}export declare function Property(input:number):OtherPredicateBuilder;`, true},
		{"direct-unknown-overload", `const callback=()=>Property('key').equals('slug');`, `export declare function Property(input:number):unknown;`, false},
		{"direct-typeparameter-overload", `const callback=()=>Property('key').equals('slug');`, `export declare function Property<T>(input:T):T;`, false},
		{"direct-union-return-missing-member", `const callback=()=>Property('key').equals('slug');`, `export declare function Property(input:number):QueryPropertyPredicateBuilder|ExpandedBuilder;`, false},
		{"direct-aliased-return", `const callback=()=>Property('key').equals('slug');`, `export type PredicateAlias=QueryPropertyPredicateBuilder;export declare function Property(input:number):PredicateAlias;`, false},
		{"direct-conditional-overload", `const callback=()=>Property('key').equals('slug');`, `export declare function Property<T>(input:T):T extends string?QueryPropertyPredicateBuilder:ExpandedBuilder;`, false},
		{"direct-unresolved-return", `const callback=()=>Property('key').equals('slug');`, `export declare function Property(input:number):Missing;`, false},
		{"direct-current-overload-origin", `declare module '@astrale-os/kernel-core' {function Property(input:number):QueryPropertyPredicateBuilder}const callback=()=>Property('key').equals('slug');`, "", false},
		{"direct-current-head-augmentation", `declare module '@astrale-os/kernel-core' {interface QueryPropertyPredicateBuilder {extra():void}}const callback=()=>Property('key').equals('slug');`, "", false},
		{"direct-local-callable", `const local=(input:string)=>({equals(value:string){return value}});const callback=()=>local('key').equals('slug');`, "", false},
		{"direct-any-callable", `const saved:any=Property;const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-never-callable", `declare const saved:never;const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-unknown-callable", `declare const saved:unknown;const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-union-callable", `declare const saved:typeof Property|((input:string)=>QueryPropertyPredicateBuilder);const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-intersection-callable", `declare const saved:typeof Property&{readonly marker:true};const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-typeparameter-callable", `const callback=<F extends typeof Property>(saved:F)=>saved('key').equals('slug');`, "", false},
		{"direct-asserted-callable", `const saved=Property as unknown as ((input:string)=>QueryPropertyPredicateBuilder);const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-bound-preserved-current-view", `const saved=Property.bind(undefined);const callback=()=>saved('key').equals('slug');`, "", true},
		{"direct-prebound-changed-signature", `const saved=Property.bind(undefined,'key');const callback=()=>saved().equals('slug');`, "", false},
		{"direct-call-and-construct", `declare const saved:{(input:string):QueryPropertyPredicateBuilder;new(input:string):QueryPropertyPredicateBuilder};const callback=()=>saved('key').equals('slug');`, "", false},
		{"direct-error-any", `const callback=()=>MissingFactory('key').equals('slug');`, "", false},
		{"direct-union-local-origin", `declare const condition:boolean;const localBuilder={equals:function self(value:string):QueryPropertyEqualPredicate {saved('key').equals(value);return {kind:'property.equal',property:'key',value}},isPresent(){return {kind:'property.present' as const,property:'key'}}};const localProperty=(input:string)=>localBuilder;declare const saved:typeof Property|typeof localProperty;`, "", false},
		{"direct-optional-call", `const callback=()=>Property?.('key').equals('slug');`, "", false},
		{"direct-parenthesized-callee", `const callback=()=>(Property)('key').equals('slug');`, "", false},
		{"direct-flow-predicate-self", `const localBuilder={equals:function self(value:string):QueryPropertyEqualPredicate {if(isLocal(Property)) Property('key').equals(value);return {kind:'property.equal',property:'key',value}},isPresent(){return {kind:'property.present' as const,property:'key'}}};const localProperty=Object.assign((input:string)=>localBuilder,{marker:true as const});declare function isLocal(value:typeof Property):value is typeof localProperty;`, "", false},
		{"direct-flow-assertion-self", `const localBuilder={equals:function self(value:string):QueryPropertyEqualPredicate {assertLocal(Property);Property('key').equals(value);return {kind:'property.equal',property:'key',value}},isPresent(){return {kind:'property.present' as const,property:'key'}}};const localProperty=Object.assign((input:string)=>localBuilder,{marker:true as const});declare function assertLocal(value:typeof Property):asserts value is typeof localProperty;`, "", false},
		{"direct-asserted-alias-self", `const localBuilder={equals:function self(value:string):QueryPropertyEqualPredicate {saved('key').equals(value);return {kind:'property.equal',property:'key',value}},isPresent(){return {kind:'property.present' as const,property:'key'}}};type LocalPredicate=typeof localBuilder;const saved=Property as unknown as ((input:string)=>LocalPredicate);`, "", false},
	}
}

// Unlike symbol/initializer identity, the current type sees flow and asserted
// callable substitutions. Each self fixture must be valid and reach EXACT self.
func TestDirectCallableHeadsCurrentViewAndAllSignatures(t *testing.T) {
	for _, item := range directCallableHeadCases() {
		t.Run(item.name, func(t *testing.T) {
			root := declaredHeadsRoot(t, item)
			owner, fn, expression := declaredHeadsOwner(t, root)
			got := owner.externalDeclaredMemberCannotSelf(expression, owner.functionKey(fn))
			if got != item.want {
				t.Fatalf("proof=%v want=%v", got, item.want)
			}
			target := declaredHeadsActualTarget(owner, expression)
			if got && target == owner.functionKey(fn) {
				t.Fatal("current callable proof hid original self")
			}
			if strings.HasSuffix(item.name, "-self") && target != owner.functionKey(fn) {
				t.Fatal("fixture did not reach actual original self")
			}
			if item.name == "direct-self-key-is-member-key" && (target == "" || owner.externalDeclaredMemberCannotSelf(expression, target)) {
				t.Fatal("terminal declaration identity not rejected")
			}
		})
	}
}

// The original direct FunctionDeclaration helper always misses; the new proof
// may hit. Compare the semantic target and complete later original observations,
// not that internal Boolean. Production-FIRST comparisons are in the reducer
// test shared with the fluent-arm fixtures.
func TestDirectCallableHeadsOriginalPrefixAndCompleteSuffix(t *testing.T) {
	for _, item := range directCallableHeadCases() {
		t.Run(item.name, func(t *testing.T) {
			root := declaredHeadsRoot(t, item)
			var rows [2]declaredHeadsSuffix
			for mode := 0; mode < 2; mode++ {
				owner, fn, expression := declaredHeadsOwner(t, root)
				check := owner.Identity.TypeOwner.program.Checker
				before := [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount}
				if mode == 0 {
					owner.externalFactoryMemberCannotSelfOriginal(expression, owner.functionKey(fn))
				} else {
					owner.externalFactoryMemberCannotSelf(expression, owner.functionKey(fn))
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
				for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
					row.Diagnostics = append(row.Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
				}
				row.Diagnostics = append(row.Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
				if strings.HasSuffix(item.name, "-self") && len(row.Diagnostics) != 0 {
					t.Fatalf("self case must be original valid Program: %v", row.Diagnostics)
				}
				rows[mode] = row
				t.Logf("mode=%d before=%v prefix=%v suffix=%v", mode, before, prefix, [3]uint32{check.TotalInstantiationCount, check.TypeCount, check.SymbolCount})
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
