// Focused differential probe. Source capture/resolution/type cells are supplied
// by the frozen SDK oracle; this is not the production native capture service.
package main

import (
	policy "astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

type location struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}
type evidence struct {
	Rule            string   `json:"rule"`
	Kind            string   `json:"kind"`
	Evidence        string   `json:"evidence"`
	Location        location `json:"location"`
	AmbiguityReason string   `json:"ambiguityReason,omitempty"`
}
type cell struct {
	Kind, Path  string
	Offset, End int
	Names       []string
	GraphKind   string
}

func utf16at(text string, offset int) int { return len(utf16.Encode([]rune(text[:offset]))) }
func loc(file *policy.File, node *ast.Node) location {
	start := scanner.GetTokenPosOfNode(node, file.Source, false)
	lines := scanner.GetECMALineStarts(file.Source)
	line := scanner.ComputeLineOfPosition(lines, start)
	offset := utf16at(file.Source.Text(), start)
	return location{file.Path, line + 1, offset - utf16at(file.Source.Text(), int(lines[line])) + 1, offset, max(1, utf16at(file.Source.Text(), node.End())-offset)}
}
func main() {
	var input struct {
		Files []struct {
			Path, Role, Layer, Submodule, Text string
			Imports                            []struct {
				Specifier, Namespace, Target string
				TypeOnly, Dynamic            bool
				Offset, Length               int
				Bindings                     []policy.Binding
			}
		}
		ApplicationPath  string
		LayerSourcePaths map[string]string
		Cells            []cell
	}
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	project := &policy.Project{FilesByPath: map[string]*policy.File{}, ApplicationPath: input.ApplicationPath, LayerSourcePaths: input.LayerSourcePaths}
	targets := map[string]string{}
	for _, in := range input.Files {
		absolute, err := filepath.Abs(in.Path)
		if err != nil {
			panic(err)
		}
		kind := core.ScriptKindTS
		if strings.HasSuffix(in.Path, ".tsx") {
			kind = core.ScriptKindTSX
		}
		file := &policy.File{Path: in.Path, Role: in.Role, Layer: in.Layer, Submodule: in.Submodule, Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: absolute}, in.Text, kind)}
		nodes := map[[2]int]*ast.Node{}
		var walk func(*ast.Node)
		walk = func(node *ast.Node) {
			if node.Kind == ast.KindImportDeclaration || node.Kind == ast.KindExportDeclaration || node.Kind == ast.KindImportType || node.Kind == ast.KindCallExpression {
				position := loc(file, node)
				nodes[[2]int{position.Offset, position.Length}] = node
			}
			node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
		}
		walk(file.Source.AsNode())
		for _, imp := range in.Imports {
			node := nodes[[2]int{imp.Offset, imp.Length}]
			if node == nil {
				panic("unanchored import")
			}
			file.Imports = append(file.Imports, policy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Node: node, Bindings: imp.Bindings, Namespace: imp.Namespace, Dynamic: imp.Dynamic})
			targets[file.Path+"\x00"+imp.Specifier] = imp.Target
		}
		project.Files = append(project.Files, file)
		project.FilesByPath[file.Path] = file
	}
	project.Resolve = func(file *policy.File, imp policy.Import) policy.Resolution {
		return policy.Resolution{Known: true, Target: project.FilesByPath[targets[file.Path+"\x00"+imp.Specifier]]}
	}
	requests := []cell{}
	get := func(kind string, file *policy.File, node *ast.Node) (cell, bool) {
		position := loc(file, node)
		end := utf16at(file.Source.Text(), node.End())
		for _, c := range input.Cells {
			if c.Kind == kind && c.Path == file.Path && c.Offset == position.Offset && c.End == end {
				return c, true
			}
		}
		request := cell{Kind: kind, Path: file.Path, Offset: position.Offset, End: end}
		for _, r := range requests {
			if r.Kind == kind && r.Path == file.Path && r.Offset == request.Offset && r.End == end {
				return cell{}, false
			}
		}
		requests = append(requests, request)
		return cell{}, false
	}
	project.ExpressionPropertyNames = func(file *policy.File, node *ast.Node) policy.NamesObservation {
		c, known := get("expression-properties", file, node)
		return policy.NamesObservation{Known: known, Names: c.Names}
	}
	project.QueryCollectionKind = func(file *policy.File, node *ast.Node) policy.KindObservation {
		c, known := get("query-collection-kind", file, node)
		return policy.KindObservation{Known: known, Kind: c.GraphKind}
	}
	query, mutation := policy.EvaluateQuerySource(project), policy.EvaluateMutationSource(project)
	out := []evidence{}
	for _, result := range []policy.Result{query, mutation} {
		for _, e := range result.Evidence {
			out = append(out, evidence{e.Rule, e.Kind, e.Evidence, loc(e.File, e.Node), e.AmbiguityReason})
		}
	}
	result := struct {
		Evidence []evidence             `json:"evidence"`
		Residual []policy.Residual      `json:"residual"`
		Requests []cell                 `json:"requests"`
		Topology policy.MachineTopology `json:"topology"`
	}{Evidence: out, Requests: requests, Topology: policy.BuildMachineTopology(project)}
	for _, r := range append(query.Residual, mutation.Residual...) {
		result.Residual = append(result.Residual, policy.Residual{Rule: r.Rule, Reason: r.Reason})
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
