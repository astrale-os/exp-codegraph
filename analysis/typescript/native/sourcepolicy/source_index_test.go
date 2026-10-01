package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"testing"
	"unicode/utf16"
)

func originalAnchor(file *File, node *ast.Node) (int, int) {
	text := file.Source.Text()
	return len(utf16.Encode([]rune(text[:scanner.GetTokenPosOfNode(node, file.Source, false)]))), len(utf16.Encode([]rune(text[:node.End()])))
}
func originalRuntimeCall(file *File, start, end int, top bool) *ast.Node {
	var found *ast.Node
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression && (!top || qmTopLevel(node)) {
			a, b := originalAnchor(file, node)
			if a == start && b == end {
				found = node
			}
		}
	})
	return found
}
func TestRuntimeAnchorIndexOriginalDFSAndTopLevel(t *testing.T) {
	samples := []string{
		"/*é日😀*/\r\nconst a=f()({build(){return q(x())},project:v=>v}); const b=g();",
		"\ufeff//😀\nconst a=((f()))({build:()=>q()}); function h(){return f()()} h();",
		"const a=f(f(f( ; const b=(g() ; function bad( { q( )",
		"//" + string([]byte{0xed, 0xa0, 0x80, 0xff}) + "\nconst a=f()();",
	}
	for _, text := range samples {
		file := &File{Path: "current.ts", Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/current.ts"}, text, core.ScriptKindTS)}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			start, end := originalAnchor(file, node)
			if qmStart(file, node) != start || qmEnd(file, node) != end {
				t.Fatal("original anchor changed")
			}
			for _, top := range []bool{false, true} {
				if got, want := file.runtimeCall(start, end, top), originalRuntimeCall(file, start, end, top); got != want {
					t.Fatalf("anchor(%d,%d) top%v changed", start, end, top)
				}
			}
		})
		if file.runtimeCall(-1, len(text)+999, false) != nil {
			t.Fatal("absent anchor fabricated")
		}
	}
}
func TestRuntimeAnchorOwnerReplacementAndLookupAllocation(t *testing.T) {
	parse := func(text string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/same.ts"}, text, core.ScriptKindTS)
	}
	file := &File{Path: "same.ts", Source: parse("const a=f();")}
	var first *ast.Node
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind == ast.KindCallExpression {
			first = n
		}
	})
	start, end := originalAnchor(file, first)
	if file.runtimeCall(start, end, false) != first {
		t.Fatal("initial owner")
	}
	old := file.index
	if n := testing.AllocsPerRun(100, func() { _ = file.runtimeCall(start, end, false) }); n != 0 {
		t.Fatalf("indexed anchor lookup allocates %g", n)
	}
	file.Source = parse("const a=g();")
	found := file.runtimeCall(start, end, false)
	if found == nil || found == first || file.index == old || found.AsCallExpression().Expression.Text() != "g" {
		t.Fatal("replacement borrowed prior AST")
	}
	file.Source = parse("/*😀*/const a=g();")
	if file.runtimeCall(start, end, false) != originalRuntimeCall(file, start, end, false) {
		t.Fatal("old coordinate survived changed source")
	}
}
