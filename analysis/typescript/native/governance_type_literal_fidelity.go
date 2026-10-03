package main

import (
	"strings"
	"unicode/utf8"

	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	compiler "github.com/microsoft/typescript-go/shim/compiler"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

// This prerequisite certifies literal code units, not Go/TS type equivalence.
// Every actual compiler source contributes, including imported/global/lib files.
func governanceTypeLiteralFidelity(source *ast.SourceFile) bool {
	if source == nil || len(source.Diagnostics()) != 0 || !utf8.ValidString(source.Text()) {
		return false
	}
	faithful := true
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	walk(source.AsNode(), func(node *ast.Node) bool {
		if !faithful {
			return false
		}
		// JSDoc is outside ForEachChild; use the same raw ranges as the pinned
		// lazy parser, without calling Node.JSDoc or changing its cache.
		if node.Flags&ast.NodeFlagsHasJSDoc != 0 {
			for _, comment := range parser.GetJSDocCommentRanges(factory, nil, node, source.Text()) {
				if strings.Contains(source.Text()[comment.Pos():comment.End()], `\u`) {
					faithful = false // Even benign doc escapes decline conservatively.
					return false
				}
			}
		}
		invalid := false
		switch node.Kind {
		case ast.KindStringLiteral:
		case ast.KindNoSubstitutionTemplateLiteral:
			invalid = node.AsNoSubstitutionTemplateLiteral().TemplateFlags&ast.TokenFlagsContainsInvalidEscape != 0
		case ast.KindTemplateHead:
			invalid = node.AsTemplateHead().TemplateFlags&ast.TokenFlagsContainsInvalidEscape != 0
		case ast.KindTemplateMiddle:
			invalid = node.AsTemplateMiddle().TemplateFlags&ast.TokenFlagsContainsInvalidEscape != 0
		case ast.KindTemplateTail:
			invalid = node.AsTemplateTail().TemplateFlags&ast.TokenFlagsContainsInvalidEscape != 0
		default:
			return true
		}
		raw, rawError := jsstring.FromNode(node)
		cooked, cookedError := jsstring.FromCompilerText(node.Text())
		faithful = !invalid && ast.GetSourceFileOfNode(node) == source && rawError == nil && cookedError == nil && raw.Equal(cooked)
		return faithful
	})
	return faithful
}

func (owner *governanceTypeAuthority) literalFidelity() bool {
	if !owner.project.capture.metadataFidelity() {
		return false
	}
	if owner.program == nil {
		return true // No checker-derived value exists in the unavailable-program path.
	}
	if owner.typeSourceBase == nil {
		base := map[string]governanceTypeSource{}
		faithful := true
		for _, source := range owner.program.TSProgram.SourceFiles() {
			base[source.FileName()] = governanceTypeSource{text: source.Text(), references: governanceTypeReferenceSyntax(source), options: source.ParseOptions(), ordinary: governanceOrdinaryTypeSource(source), needed: compiler.FileAffectsGlobalScope(source) || len(source.ModuleAugmentations) > 0 || sourceHasAmbientModule(source)}
			// Check each list member even if two paths share a map key.
			faithful = governanceTypeLiteralFidelity(source) && faithful
		}
		owner.typeSourceBase = base
		owner.typeSourceFaithful = faithful
	}
	return owner.typeSourceFaithful
}
