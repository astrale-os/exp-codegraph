package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"reflect"
	"testing"
)

func syntaxRuntimeOwner(t *testing.T, project *governedProject) *governanceRuntimeAuthority {
	t.Helper()
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	return governanceNewRuntimeAuthority(identity)
}

func TestProgramSyntaxCurrentCheckerAfterRetainedHelperEdit(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "queries/helper.ts", "export function helper(p:{x:number}){return p.x;}")
	governanceWrite(t, root, "queries/independent.ts", "import {helper} from './helper.js';const object={x:0};helper(object);")
	session := &governanceSession{}
	first, _ := generationSessionCell(t, session, root)
	old := syntaxRuntimeOwner(t, first)
	file := old.ByPath["queries/independent.ts"]
	old.ensureAllAdmissions()
	oldSyntax := old.Syntax.source(file.Source)
	oldCalls := oldSyntax.callNodes(file.Source)
	var object *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name().Text() == "object" {
			object = node.Name()
		}
		return true
	})
	if object == nil || len(oldCalls) != 1 {
		t.Fatal("fixture demand absent")
	}
	before := old.Call(file, oldCalls[0])
	if !before.Known || !before.BodyPresent {
		t.Fatal("imported helper unavailable", before)
	}
	oldChecker := first.typeOwner.program.Checker
	if generationSessionSeal(t, session, first, "syntax-first") != "committed" {
		t.Fatal("first seal")
	}
	governanceWrite(t, root, "queries/helper.ts", "export function helper(p:{x:number}){p.x=1;return p.x;}")
	next, _ := generationSessionCell(t, session, root)
	current := syntaxRuntimeOwner(t, next)
	currentFile := current.ByPath[file.Path]
	if next.borrowedGeneration == nil || currentFile.Source != file.Source || next.typeOwner.program.Checker == oldChecker {
		t.Fatal("fixture did not exercise actual same-AST/fresh-checker update")
	}
	current.ensureAllAdmissions()
	if current.Syntax.source(currentFile.Source) != oldSyntax {
		t.Fatal("unchanged source structure not reused")
	}
	after := current.Call(currentFile, oldCalls[0])
	if !after.Known || !after.BodyPresent || after.Target == before.Target || after.Target.Body() == before.Target.Body() {
		t.Fatal("old imported binding/body survived", before, after)
	}
	core := observabledecision.NewCapturedNativeEffectCoreWithSyntax(current.Files, current.EffectAuthority(), current.Syntax.values)
	actual := core.Proof("mutation", current.Symbol(currentFile, object).Key, "")
	inventory := current.Calls([]string{file.Path})
	// A fresh index in the SAME current authority compares full ordered reads,
	// charges and node relations without cross-capture ticket normalization.
	next.runtimeSyntax = governanceNewRuntimeSyntaxOwner()
	fresh := syntaxRuntimeOwner(t, next)
	freshCore := observabledecision.NewCapturedNativeEffectCoreWithSyntax(fresh.Files, fresh.EffectAuthority(), fresh.Syntax.values)
	want := freshCore.Proof("mutation", fresh.Symbol(fresh.ByPath[file.Path], object).Key, "")
	if !reflect.DeepEqual(actual, want) || !reflect.DeepEqual(after, fresh.Call(fresh.ByPath[file.Path], oldCalls[0])) || !reflect.DeepEqual(inventory, fresh.Calls([]string{file.Path})) {
		t.Fatalf("retained syntax changed current proofs/calls: actual=%#v fresh=%#v", actual, want)
	}
	if generationSessionSeal(t, session, next, "syntax-next") != "committed" {
		t.Fatal("updated seal")
	}
}

func TestProgramSyntaxMembershipAndAbandonment(t *testing.T) {
	root := typeDemandFixture(t)
	session := &governanceSession{}
	first, _ := generationSessionCell(t, session, root)
	old := syntaxRuntimeOwner(t, first)
	old.ensureAllAdmissions()
	removed := old.ByPath["queries/independent.ts"].Source
	if generationSessionSeal(t, session, first, "members-first") != "committed" {
		t.Fatal("first seal")
	}
	if err := os.Remove(root + "/queries/independent.ts"); err != nil {
		t.Fatal(err)
	}
	next, _ := generationSessionCell(t, session, root)
	current := syntaxRuntimeOwner(t, next)
	if next.borrowedGeneration != nil || current.Identity.OwnedProgramFiles["queries/independent.ts"] != nil {
		t.Fatal("removed source reused")
	}
	current.ensureAllAdmissions()
	if current.Syntax.sources[removed] != nil {
		t.Fatal("removed AST remains in current syntax membership")
	}
	if generationSessionSeal(t, session, next, "members-next") != "committed" {
		t.Fatal("removal seal")
	}
	governanceWrite(t, root, "queries/independent.ts", "export const independent = (): number => 1;")
	recreated, _ := generationSessionCell(t, session, root)
	fresh := syntaxRuntimeOwner(t, recreated)
	if fresh.ByPath["queries/independent.ts"].Source == removed {
		t.Fatal("recreated path borrowed old AST")
	}
	fresh.ensureAllAdmissions()
	if fresh.Syntax.sources[removed] != nil {
		t.Fatal("recreated current owner retained removed AST")
	}
	if generationSessionSeal(t, session, recreated, "members-recreated") != "committed" {
		t.Fatal("recreated seal")
	}
	governanceWrite(t, root, "schema/value.ts", "export const subject={after:1};")
	draft, _ := generationSessionCell(t, session, root)
	draftOwner := syntaxRuntimeOwner(t, draft)
	draftOwner.ensureAllAdmissions()
	if draft.borrowedGeneration == nil {
		t.Fatal("fixture did not borrow")
	}
	session.productsSession = &governanceProductsSession{Project: draft}
	session.discardProducts()
	if session.programGeneration != nil || draft.runtimeSyntax != nil {
		t.Fatal("abandoned syntax proposal retained")
	}
}

func TestProgramSyntaxRefoldsCurrentGlobalsImportsAndAugmentations(t *testing.T) {
	for _, text := range []string{
		"const independent=2;",
		"import {subject} from '../schema/value.js';export const independent=()=>subject;",
		"export {};declare global {interface Object {current:number}}",
		"export {};declare module '../schema/value.js' {interface Current {value:number}}",
	} {
		t.Run(text, func(t *testing.T) {
			root := typeDemandFixture(t)
			session := &governanceSession{}
			first, _ := generationSessionCell(t, session, root)
			old := syntaxRuntimeOwner(t, first)
			old.ensureAllAdmissions()
			previous := old.ByPath["queries/independent.ts"].Source
			if generationSessionSeal(t, session, first, "context-first") != "committed" {
				t.Fatal("first seal")
			}
			governanceWrite(t, root, "queries/independent.ts", text)
			next, names := generationSessionCell(t, session, root)
			current := syntaxRuntimeOwner(t, next)
			current.ensureAllAdmissions()
			if current.Syntax.sources[previous] != nil {
				t.Fatal("replaced AST retained")
			}
			file := current.ByPath["queries/independent.ts"]
			actual := current.Calls([]string{file.Path})
			next.runtimeSyntax = governanceNewRuntimeSyntaxOwner()
			fresh := syntaxRuntimeOwner(t, next)
			if !reflect.DeepEqual(actual, fresh.Calls([]string{file.Path})) {
				t.Fatal("context edit changed fresh inventory")
			}
			_, expected := testTypeDemand(t, root, &governanceTypeDemandCache{})
			if !reflect.DeepEqual(names, expected.Names) {
				t.Fatal("current checker differs", names, expected)
			}
			if generationSessionSeal(t, session, next, "context-next") != "committed" {
				t.Fatal("context seal")
			}
		})
	}
}
