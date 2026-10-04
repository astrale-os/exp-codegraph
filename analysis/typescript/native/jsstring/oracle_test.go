package jsstring

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

// This fixture is produced independently by the pinned SDK TypeScript parser,
// including malformed source and tagged templates. It does not execute authored
// code and does not derive expected units from the native scanner or this codec.
func TestPinnedSDKLiteralOracle(t *testing.T) {
	type specimen struct {
		ID, Source, Kind string
		TSX              bool
		Units            []uint16
	}
	data, err := os.ReadFile("testdata/literals.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []specimen
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases {
		t.Run(item.ID, func(t *testing.T) {
			kind := core.ScriptKindTS
			fileName := "/private/fixture.ts"
			if item.TSX {
				kind = core.ScriptKindTSX
				fileName += "x"
			}
			source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: fileName}, item.Source, kind)
			ast.SetParentInChildren(source.AsNode())
			var found *ast.Node
			var walk func(*ast.Node)
			walk = func(node *ast.Node) {
				if node.Kind == ast.KindStringLiteral || node.Kind == ast.KindNoSubstitutionTemplateLiteral {
					found = node
				}
				node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
			}
			walk(source.AsNode())
			if found == nil {
				t.Fatalf("No literal: %s", item.Source)
			}
			value, err := FromLiteral(source, found)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(value.Units(), item.Units) {
				t.Fatalf("Source=%q; AST.Text=%x; actual=%x; SDK=%x", item.Source, []byte(found.Text()), value.Units(), item.Units)
			}
			encoded, err := json.Marshal(value)
			if err != nil || !json.Valid(encoded) {
				t.Fatalf("Invalid exact JSON: %s %v", encoded, err)
			}
		})
	}
}
