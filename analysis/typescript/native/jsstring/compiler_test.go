package jsstring

import (
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"reflect"
	"strings"
	"testing"
)

func literal(t *testing.T, text string) (*ast.SourceFile, *ast.Node) {
	t.Helper()
	source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/fixture.ts"}, "const value="+text+";", core.ScriptKindTS)
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
		t.Fatalf("No parsed literal %s", text)
	}
	ast.SetParentInChildren(source.AsNode())
	return source, found
}
func TestPinnedCompilerLiteralCodeUnits(t *testing.T) {
	cases := []struct {
		text  string
		units []uint16
	}{{`'a'`, []uint16{97}}, {`'\uD800'`, []uint16{0xd800}}, {`'\uDC00'`, []uint16{0xdc00}}, {`'\uFFFD'`, []uint16{0xfffd}}, {`'\uD800\uDC00'`, []uint16{0xd800, 0xdc00}}, {`'\u{10000}'`, []uint16{0xd800, 0xdc00}}, {`'🌱'`, []uint16{0xd83c, 0xdf31}}, {`'\uFEFFx'`, []uint16{0xfeff, 120}}, {`'\u0085x'`, []uint16{0x85, 120}}, {"`line\\nnext`", []uint16{'l', 'i', 'n', 'e', 10, 'n', 'e', 'x', 't'}}}
	for _, item := range cases {
		t.Run(item.text, func(t *testing.T) {
			source, node := literal(t, item.text)
			value, err := FromLiteral(source, node)
			if err != nil {
				t.Fatalf("AST text bytes=%x: %v", []byte(node.Text()), err)
			}
			if !reflect.DeepEqual(value.Units(), item.units) {
				t.Fatalf("Compiler literal lost code units: raw=%x actual=%x expected=%x", []byte(node.Text()), value.Units(), item.units)
			}
			bytes, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("AST.Text bytes=%x; code units=%x; faithfulJSON=%s", []byte(node.Text()), value.Units(), bytes)
		})
	}
}
func TestCodeUnitIdentityConcatAndOwnership(t *testing.T) {
	a := FromUnits([]uint16{0xd800})
	b := FromUnits([]uint16{0xdc00})
	source, node := literal(t, `'\u{10000}'`)
	pair, err := FromLiteral(source, node)
	if err != nil {
		t.Fatal(err)
	}
	if !a.Concat(b).Equal(pair) || a.Equal(FromUnits([]uint16{0xfffd})) {
		t.Fatal("JavaScript literal identity collapsed")
	}
	units := a.Units()
	units[0] = 0xfffd
	if a.Units()[0] != 0xd800 {
		t.Fatal("Caller mutated owned string")
	}
	if a.Concat(b).Length() != 2 {
		t.Fatal("Scalar count used instead of code-unit length")
	}
	first, err := pair.Slice(0, 1)
	if err != nil || !first.Equal(a) {
		t.Fatal("Code-unit slice rejected split surrogate")
	}
	if _, err := DecodeWire([]uint16{1, 2}, 1); err == nil {
		t.Fatal("Wire budget bypassed")
	}
	if _, err := FromCompilerText(string([]byte{0xff})); err == nil {
		t.Fatal("Invalid UTF8 replaced")
	}
}

func TestAllSurrogateUnitsAreDistinct(t *testing.T) {
	var raw strings.Builder
	raw.WriteByte('\'')
	units := make([]uint16, 0, 2048)
	for unit := uint32(0xd800); unit <= 0xdfff; unit++ {
		fmt.Fprintf(&raw, "\\u%04x", unit)
		units = append(units, uint16(unit))
	}
	raw.WriteByte('\'')
	source, node := literal(t, raw.String())
	value, err := FromLiteral(source, node)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(value.Units(), units) {
		t.Fatal("Surrogate domain collapsed or reordered")
	}
	if value.ValidUnicode() {
		t.Fatal("Lone surrogate identity incorrectly classified as scalar Unicode")
	}
	encoded, err := json.Marshal(JSONText(value.WTF8()))
	if err != nil {
		t.Fatal(err)
	}
	exact, err := value.MarshalJSON()
	if err != nil || string(encoded) != string(exact) {
		t.Fatal("Evidence boundary lost code units")
	}
}
