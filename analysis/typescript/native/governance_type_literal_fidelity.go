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
	// Original compiler pragma arguments may overlap JSDoc prose.
	for _, pragma := range source.Pragmas {
		for _, argument := range pragma.Args {
			if argument.Pos() < 0 || argument.End() < argument.Pos() || argument.End() > len(source.Text()) || strings.Contains(source.Text()[argument.Pos():argument.End()], `\u`) {
				return false
			}
		}
	}

	faithful := true
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	walk(source.AsNode(), func(node *ast.Node) bool {
		if !faithful {
			return false
		}
		// JSDoc is outside ForEachChild; use the same raw ranges as the pinned
		// lazy parser. Only original top-level documentation text may contain
		// escapes; only strict parameter descriptions add eligible tag text.
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
// Only top-level prose and untyped, unbracketed parameter descriptions qualify.
// Names, types, defaults, links and every other tag stay outside the exception.
func governanceJSDocProseEscapes(source *ast.SourceFile, host *ast.Node, start, end int) bool {
	raw := source.Text()[start:end]
	if !strings.Contains(raw, `\u`) {
		return true
	}
	jsdocErrors := ast.NodeFlagsThisNodeHasError | ast.NodeFlagsThisNodeOrAnySubNodesHasError
	var selected *ast.Node
	for _, doc := range host.JSDoc(source) {
		if doc == nil || doc.Kind != ast.KindJSDoc || doc.End() != end {
			continue
		}
		if selected != nil || doc.Flags&jsdocErrors != 0 || doc.Pos() > start || doc.AsJSDoc().Comment == nil {
			return false
		}
		selected = doc
	}
	if selected == nil {
		return false
	}
	var tags []*ast.Node
	if selected.AsJSDoc().Tags != nil {
		tags = selected.AsJSDoc().Tags.Nodes
	}
	previousEnd := start
	for _, tag := range tags {
		if tag == nil || tag.Flags&jsdocErrors != 0 || tag.Pos() < previousEnd || tag.Pos() > tag.End() || tag.End() > end {
			return false
		}
		previousEnd = tag.End()
	}
	// Defaults are parsed and discarded by the pinned parser: only unbracketed,
	// untyped genuine parameter names can provide documentary comment ranges.
	partsAt := func(group int) (*ast.NodeList, int, int) {
		if group < 0 {
			upper := end
			if len(tags) > 0 {
				upper = tags[0].Pos()
			}
			return selected.AsJSDoc().Comment, start, upper
		}
		tag := tags[group]
		if tag.Kind != ast.KindJSDocParameterTag {
			return nil, 0, 0
		}
		parameter := tag.AsJSDocParameterOrPropertyTag()
		name := tag.Name()
		if parameter.IsBracketed || parameter.TypeExpression != nil || name == nil || name.Kind != ast.KindIdentifier || name.Text() == "" || name.Flags&jsdocErrors != 0 {
			return nil, 0, 0
		}
		return parameter.Comment, name.End(), tag.End()
	}
	for group := -1; group < len(tags); group++ {
		parts, lower, upper := partsAt(group)
		if parts == nil {
			continue
		}
		previousEnd := lower
		for _, part := range parts.Nodes {
			if part == nil || part.Flags&jsdocErrors != 0 || part.Pos() < previousEnd || part.Pos() > part.End() || part.End() > upper {
				return false
			}
			previousEnd = part.End()
		}
	}
	group, cursor := -1, 0
	for offset := 0; offset < len(raw); {
		next := strings.Index(raw[offset:], `\u`)
		if next < 0 {
			break
		}
		position := start + offset + next
		var part *ast.Node
		for group < len(tags) {
			parts, _, _ := partsAt(group)
			if parts != nil {
				for cursor < len(parts.Nodes) && parts.Nodes[cursor].End() <= position {
					cursor++
				}
				if cursor < len(parts.Nodes) {
					part = parts.Nodes[cursor]
					break
				}
			}
			group++
			cursor = 0
		}
		if part == nil || part.Kind != ast.KindJSDocText || part.Pos() > position || position+2 > part.End() {
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
