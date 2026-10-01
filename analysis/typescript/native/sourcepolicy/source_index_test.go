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
			a := len(utf16.Encode([]rune(file.Source.Text()[:scanner.GetTokenPosOfNode(node, file.Source, false)])))
			if a == start && len(utf16.Encode([]rune(file.Source.Text()[:node.End()]))) == end {
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

func TestRuntimeAnchorOriginalShortCircuitMalformedRanges(t *testing.T) {
	parse := func() *File {
		return &File{Path: "malformed.ts", Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/malformed.ts"}, "f(); function h(){g()}", core.ScriptKindTS)}
	}
	panicOf := func(f func()) (panics bool) { defer func() { panics = recover() != nil }(); f(); return }
	t.Run("nested excluded before invalid start", func(t *testing.T) {
		file := parse()
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindCallExpression && !qmTopLevel(node) {
				node.Loc = core.NewTextRange(999, 1000)
			}
		})
		if panicOf(func() { _ = originalRuntimeCall(file, 0, 3, true) }) || panicOf(func() { _ = file.runtimeCall(0, 3, true) }) {
			t.Fatal("excluded nested range evaluated")
		}
	})
	t.Run("end only when start matches", func(t *testing.T) {
		for _, target := range []int{0, 1} {
			file := parse()
			authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind == ast.KindCallExpression && qmTopLevel(node) {
					node.Loc = core.NewTextRange(node.Pos(), 999)
				}
			})
			old := panicOf(func() { _ = originalRuntimeCall(file, target, 3, true) })
			current := panicOf(func() { _ = file.runtimeCall(target, 3, true) })
			if old != current || current != (target == 0) {
				t.Fatalf("start%d panic old%v current%v", target, old, current)
			}
		}
	})
	t.Run("ordered duplicate starts retain last matching end", func(t *testing.T) {
		file := &File{Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/duplicate.ts"}, "f();g();h();", core.ScriptKindTS)}
		count := 0
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindCallExpression {
				count++
				end := 3
				if count == 2 {
					end = 2
				}
				node.Loc = core.NewTextRange(0, end)
			}
		})
		for _, end := range []int{2, 3, 4} {
			if file.runtimeCall(0, end, false) != originalRuntimeCall(file, 0, end, false) {
				t.Fatal("duplicate start reordered")
			}
		}
	})
}

func TestMalformedASTKeepsOriginalFirstPanic(t *testing.T) {
	file := &File{Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/invalid.ts"}, "f();g();", core.ScriptKindTS)}
	n := 0
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression {
			n++
			if n == 1 {
				node.Loc = core.NewTextRange(0, 999)
			} else {
				node.Loc = core.NewTextRange(1000, 1001)
			}
		}
	})
	fault := func(f func()) (value any) { defer func() { value = recover() }(); f(); return }
	old := fault(func() { _ = originalRuntimeCall(file, 0, 3, false) })
	current := fault(func() { _ = file.runtimeCall(0, 3, false) })
	if old == nil || current == nil || old.(error).Error() != current.(error).Error() {
		t.Fatalf("original panic order changed: old%v current%v", old, current)
	}
}
