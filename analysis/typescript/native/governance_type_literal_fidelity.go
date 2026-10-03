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
		// lazy parser. Only original top-level documentation text may contain
		// escapes; tags, links and unclassified ranges remain conservative.
		if node.Flags&ast.NodeFlagsHasJSDoc != 0 {
			for _, comment := range parser.GetJSDocCommentRanges(factory, nil, node, source.Text()) {
				if !governanceJSDocProseEscapes(source, node, comment.Pos(), comment.End()) {
					faithful = false
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

// Use the pinned parser's own classification, not a second comment grammar.
// This initializes its ordinary lazy JSDoc cache only when an escape exists.
// Restrict acceptance to top-level prose: tag comments and link/name/type
// subtrees deliberately remain outside this narrow documentary exception.
func governanceJSDocProseEscapes(source *ast.SourceFile, host *ast.Node, start, end int) bool {
	raw := source.Text()[start:end]
	if !strings.Contains(raw, `\u`) {
		return true
	}
	docs := host.JSDoc(source)
	for offset := 0; offset < len(raw); {
		next := strings.Index(raw[offset:], `\u`)
		if next < 0 {
			break
		}
		position := start + offset + next
		classified := false
		for _, doc := range docs {
			if doc.Kind != ast.KindJSDoc || doc.Pos() > start || doc.End() < end {
				continue
			}
			comment := doc.AsJSDoc().Comment
			if comment == nil {
				continue
			}
			for _, part := range comment.Nodes {
				if part.Kind == ast.KindJSDocText && part.Pos() <= position && position+2 <= part.End() {
					classified = true
					break
				}
			}
		}
		if !classified {
			return false
		}
		offset = position - start + 2
	}
	return true
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
