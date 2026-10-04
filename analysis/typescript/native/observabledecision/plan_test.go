package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"testing"
)

func TestNativePlansDemandOnlySelectedPropertyAndOwnCapturedNodes(t *testing.T) {
	text := `export const projector = (domain) => ({id: 'issues.native-plan', build: (_input) => domain.unknownCall(), project: (result) => arbitrary(result)});`
	file := captured("query.ts", text)
	file.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: file.AbsolutePath}, text, core.ScriptKindTS)
	projector := file.Source.Statements.Nodes[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].AsVariableDeclaration().Initializer
	reader := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	root := reader.Expression(file.Path, projector)
	proof := root.Invoke().Property("id").Resolve(Limits{})
	if proof.Outcome.Kind != "known" || proof.Value.Kind != "string" || proof.Value.Literal != "issues.native-plan" {
		t.Fatalf("selected ID demand: %+v", proof)
	}
	callback := root.Invoke().Property("build").Resolve(Limits{})
	if callback.Value.Kind != "function" {
		t.Fatalf("callback presence should not execute it: %+v", callback)
	}
	execution := root.Invoke().Property("build").Invoke().Resolve(Limits{})
	if execution.Outcome.Kind != "unknown" {
		t.Fatalf("unsupported body cannot become pass: %+v", execution)
	}
	for _, read := range proof.Outcome.Reads {
		if read.Kind == "binding" && (read.Name == "arbitrary" || read.Name == "unknownCall") {
			t.Fatalf("unobserved body entered: %+v", read)
		}
	}
	otherFile := file
	otherFile.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: file.AbsolutePath}, text, core.ScriptKindTS)
	other := NewNativeValueReader(fixtureContext([]CapturedFile{otherFile}))
	bad := other.Expression(file.Path, projector).Resolve(Limits{})
	if bad.Outcome.Kind != "unknown" || bad.Outcome.Reason != "expression does not belong to captured reader" {
		t.Fatalf("old AST node reused with new capture: %+v", bad)
	}
	mismatched := root.Invoke(other.Expression(otherFile.Path, otherFile.Source.Statements.Nodes[0])).Resolve(Limits{})
	if mismatched.Outcome.Kind != "unknown" {
		t.Fatalf("mixed readers: %+v", mismatched)
	}
}
