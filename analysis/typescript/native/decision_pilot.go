package main

import (
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"os"
	"unicode/utf8"
)

// Experimental source-decision lane. No compiler Program, checker, BodyIR,
// generic fact store or JS TypeScript runtime participates in this command.
// Caller supplies admission/role authority; this is NOT a replacement admission.
type decisionInput struct {
	Files []decisionFile `json:"files"`
}
type decisionFile struct {
	Path         string `json:"path"`
	AbsolutePath string `json:"absolutePath"`
	Role         string `json:"role"`
}
type decisionLocation struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}
type decisionEvidence struct {
	Rule     string           `json:"rule"`
	Kind     string           `json:"kind"`
	Evidence string           `json:"evidence"`
	Location decisionLocation `json:"location"`
}
type decisionReport struct {
	Complete  bool               `json:"complete"`
	Decisions []decisionEvidence `json:"decisions"`
	Residual  []decisionEvidence `json:"residual"`
}

func runDecisionPilot() int {
	var input decisionInput
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	report := decisionReport{Complete: false, Decisions: []decisionEvidence{}, Residual: []decisionEvidence{}}
	for _, entry := range input.Files {
		if entry.Role != "production" {
			continue
		}
		bytes, err := os.ReadFile(entry.AbsolutePath)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		if !utf8.Valid(bytes) {
			fmt.Fprintln(os.Stderr, "invalid governed UTF-8")
			return 2
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: entry.AbsolutePath}, string(bytes), core.ScriptKindTS)
		ast.SetParentInChildren(file.AsNode())
		coordinates := indexSourceCoordinates(file.Text())
		emit := func(node *ast.Node, message string, residual bool) {
			start := scanner.GetTokenPosOfNode(node, file, false)
			line := scanner.ComputeLineOfPosition(scanner.GetECMALineStarts(file), start)
			offset := coordinates.utf16(start)
			location := decisionLocation{entry.Path, line + 1, offset - coordinates.utf16(int(scanner.GetECMALineStarts(file)[line])) + 1, offset, max(1, coordinates.utf16(node.End())-offset)}
			evidence := decisionEvidence{"IMP-STATIC", "violation", message, location}
			if residual {
				evidence.Kind = "requires-authority"
				report.Residual = append(report.Residual, evidence)
			} else {
				report.Decisions = append(report.Decisions, evidence)
			}
		}
		literal := func(node *ast.Node) bool {
			return node != nil && (node.Kind == ast.KindStringLiteral || node.Kind == ast.KindNoSubstitutionTemplateLiteral)
		}
		var visit func(*ast.Node)
		visit = func(node *ast.Node) {
			switch node.Kind {
			case ast.KindImportEqualsDeclaration:
				emit(node, "Production dependency uses import-equals instead of analyzable ESM.", false)
			case ast.KindImportType:
				arg := node.AsImportTypeNode().Argument
				if arg == nil || arg.Kind != ast.KindLiteralType || !literal(arg.AsLiteralTypeNode().Literal) {
					emit(node, "Production dependency uses a nonliteral dynamic import.", false)
				}
			case ast.KindCallExpression:
				call := node.AsCallExpression()
				if call.Expression.Kind == ast.KindImportKeyword {
					if call.Arguments == nil || len(call.Arguments.Nodes) != 1 || !literal(call.Arguments.Nodes[0]) {
						emit(node, "Production dependency uses a nonliteral dynamic import.", false)
					}
				} else if call.Expression.Kind == ast.KindIdentifier && call.Expression.Text() == "require" {
					if !governanceLocallyOwned(call.Expression, false) && !governanceLocallyOwned(call.Expression, true) {
						emit(node, "Production dependency uses require instead of analyzable ESM.", false)
					}
				}
			}
			node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
		}
		visit(file.AsNode())
	}
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		return 2
	}
	return 0
}
