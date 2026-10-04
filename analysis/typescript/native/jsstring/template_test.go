package jsstring

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"reflect"
	"testing"
)

func TestOwnedTemplateSegmentCodeUnits(t *testing.T) {
	for _, prefix := range []string{"const value=", "const value=tag"} {
		source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/template.ts"}, prefix+"`\\uD800${1}\\u{DFFF}${2}\\uD800\\uDC00`;", core.ScriptKindTS)
		if len(source.Diagnostics()) != 0 {
			t.Fatal(source.Diagnostics())
		}
		var actual [][]uint16
		var kinds []ast.Kind
		var visit func(*ast.Node)
		visit = func(node *ast.Node) {
			if node.Kind == ast.KindTemplateHead || node.Kind == ast.KindTemplateMiddle || node.Kind == ast.KindTemplateTail {
				value, err := FromLiteral(source, node)
				if err != nil {
					t.Fatal(err)
				}
				actual = append(actual, value.Units())
				kinds = append(kinds, node.Kind)
			}
			node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
		}
		visit(source.AsNode())
		if !reflect.DeepEqual(kinds, []ast.Kind{ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail}) || !reflect.DeepEqual(actual, [][]uint16{{0xd800}, {0xdfff}, {0xd800, 0xdc00}}) {
			t.Fatalf("template segments kinds=%v units=%x", kinds, actual)
		}
	}
}
