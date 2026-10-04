package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestScopedMappedMemberNameMayRetainOwnedCallback(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "node_modules/remap/package.json", `{"name":"remap","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/remap/index.d.ts", `export type Remap<T> = {[K in keyof T as "select"]: T[K]};`)
	governanceWrite(t, root, "queries/case.ts", `type Remap<T> = {[K in keyof T as "select"]: T[K]}; const original={self:():void=>{receiver.select()}}; declare const receiver:Remap<typeof original>;`)
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
	var fn, call *ast.Node
	walk(file.Source.AsNode(), func(n *ast.Node) bool {
		if n.Kind == ast.KindArrowFunction {
			fn = n
		}
		if n.Kind == ast.KindCallExpression {
			call = n
		}
		return true
	})
	if fn == nil || call == nil {
		t.Fatal("fixture anchors missing")
	}
	fn, _ = owner.node(file, fn)
	call, _ = owner.node(file, call)
	x := &extractor{checker: identity.TypeOwner.program.Checker}
	symbol := x.canonicalCallSymbol(call.AsCallExpression().Expression, func(*ast.Symbol) {})
	declaration := declarationNode(symbol)
	targetFunction := functionInitializer(declaration)
	target := owner.symbolKey(symbol)
	if targetFunction != nil {
		target = owner.functionKey(targetFunction)
	}
	if declaration == nil {
		t.Skip("original canonical target is unavailable for this recipe")
	}
	t.Logf("original function key %s; selected target %s; declaration kind %v; callable initializer %v", owner.functionKey(fn), target, declaration.Kind, targetFunction != nil)
	if target != owner.functionKey(fn) {
		t.Skip("pinned compiler does not preserve callback target in this remapping recipe")
	}
	t.Log("counterexample: foreign mapped type renamed owned self declaration to select while preserving recursion target")
}
