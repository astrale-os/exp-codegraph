// Predicate differential probe. Supplied resolution/binding observations are
// test authorities, not a production capture or complete native linter report.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"unicode/utf16"

	policy "astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type inputImport struct {
	Specifier string  `json:"specifier"`
	TypeOnly  bool    `json:"typeOnly"`
	Offset    int     `json:"offset"`
	Length    int     `json:"length"`
	Target    *target `json:"target"`
}
type target struct {
	Layer string `json:"layer"`
}
type inputFile struct {
	Path         string        `json:"path"`
	Text         string        `json:"text"`
	Role         string        `json:"role"`
	Layer        string        `json:"layer"`
	Imports      []inputImport `json:"imports"`
	BoundOffsets []int         `json:"boundOffsets"`
}
type location struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}
type evidence struct {
	Rule     string   `json:"rule"`
	Kind     string   `json:"kind"`
	Evidence string   `json:"evidence"`
	Location location `json:"location"`
}

func utf16at(text string, offset int) int {
	return len(utf16.Encode([]rune(text[:offset])))
}
func loc(file *policy.File, node *ast.Node) location {
	start := scanner.GetTokenPosOfNode(node, file.Source, false)
	lineStarts := scanner.GetECMALineStarts(file.Source)
	line := scanner.ComputeLineOfPosition(lineStarts, start)
	offset := utf16at(file.Source.Text(), start)
	return location{file.Path, line + 1, offset - utf16at(file.Source.Text(), int(lineStarts[line])) + 1, offset, max(1, utf16at(file.Source.Text(), node.End())-offset)}
}
func main() {
	var input struct {
		Files []inputFile `json:"files"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	files := []*policy.File{}
	resolutions := map[*ast.Node]policy.Resolution{}
	bound := map[*ast.Node]bool{}
	for _, in := range input.Files {
		kind := core.ScriptKindTS
		if len(in.Path) > 0 && in.Path[len(in.Path)-1:] == "x" {
			kind = core.ScriptKindTSX
		}
		absolute, err := filepath.Abs(in.Path)
		if err != nil {
			panic(err)
		}
		file := &policy.File{Path: in.Path, Role: in.Role, Layer: in.Layer, Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: absolute}, in.Text, kind)}
		bySpan := map[[2]int]*ast.Node{}
		var walk func(*ast.Node)
		walk = func(n *ast.Node) {
			position := loc(file, n)
			if n.Kind == ast.KindImportDeclaration || n.Kind == ast.KindExportDeclaration || n.Kind == ast.KindImportType || n.Kind == ast.KindCallExpression {
				bySpan[[2]int{position.Offset, position.Length}] = n
			}
			if n.Kind == ast.KindIdentifier {
				for _, pos := range in.BoundOffsets {
					if position.Offset == pos {
						bound[n] = true
					}
				}
			}
			n.ForEachChild(func(c *ast.Node) bool { walk(c); return false })
		}
		walk(file.Source.AsNode())
		for _, imp := range in.Imports {
			node := bySpan[[2]int{imp.Offset, imp.Length}]
			if node == nil {
				panic(fmt.Sprintf("no native import at %s %d+%d", in.Path, imp.Offset, imp.Length))
			}
			file.Imports = append(file.Imports, policy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Node: node})
			resolution := policy.Resolution{Known: true}
			if imp.Target != nil {
				resolution.Target = &policy.File{Layer: imp.Target.Layer}
			}
			resolutions[node] = resolution
		}
		files = append(files, file)
	}
	r := policy.Evaluate(files, policy.Authority{Resolve: func(_ *policy.File, imp policy.Import) policy.Resolution { return resolutions[imp.Node] }, LocallyBound: func(n *ast.Node) bool { return bound[n] }})
	out := []evidence{}
	for _, e := range r.Evidence {
		out = append(out, evidence{e.Rule, e.Kind, e.Evidence, loc(e.File, e.Node)})
	}
	if len(r.Residual) != 0 {
		panic("probe unexpectedly has residual")
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
