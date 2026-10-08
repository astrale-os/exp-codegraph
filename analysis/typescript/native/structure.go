package main

import (
	"context"
	"path/filepath"
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

// Structure describes static compiler bindings, not runtime value flow. Each
// owned non-declaration source publishes a row, including a completely empty
// source, so an empty result has an attributable coverage certificate.
type structurePayload struct {
	Source       string                `json:"source"`
	Revision     string                `json:"revision"`
	LogicalPath  string                `json:"logicalPath"`
	TextDigest   string                `json:"textDigest"`
	Symbols      []structureSymbol     `json:"symbols"`
	Exports      []structureExport     `json:"exports"`
	References   []structureReference  `json:"references"`
	Dependencies []structureDependency `json:"dependencies"`
	Completeness structureCompleteness `json:"completeness"`
}

type structureCompleteness struct {
	Exports      completeness `json:"exports"`
	References   completeness `json:"references"`
	Dependencies completeness `json:"dependencies"`
}

type structureSymbol struct {
	Symbol           string            `json:"symbol"`
	Name             string            `json:"name"`
	Declarations     []sourceSpan      `json:"declarations"`
	Origin           *callTargetOrigin `json:"origin,omitempty"`
	GenerationScoped bool              `json:"generationScoped"`
}

type structureExport struct {
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	TypeOnly bool   `json:"typeOnly"`
}

type structureReference struct {
	Symbol  string `json:"symbol,omitempty"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Kind    string `json:"kind"`
	Binding string `json:"binding,omitempty"`
}

type structureDependency struct {
	Start      int     `json:"start"`
	End        int     `json:"end"`
	Kind       string  `json:"kind"`
	TypeOnly   bool    `json:"typeOnly"`
	Specifier  *string `json:"specifier,omitempty"`
	TargetPath string  `json:"targetPath,omitempty"`
}

func structurePartial(before completeness, code, message string, span sourceSpan) completeness {
	before.Kind = "partial"
	before.Reasons = append(before.Reasons, map[string]any{
		"code": code, "message": message,
		"effective": map[string]any{"start": span.Start, "end": span.End},
	})
	return before
}

func (x *extractor) structureShard(program *driver.Program, file *shimast.SourceFile, record sourceRecord) factShard {
	x.beginProjection(file)
	result := structurePayload{
		Source: record.Source, Revision: record.Revision, LogicalPath: record.Path, TextDigest: record.TextDigest,
		Symbols: []structureSymbol{}, Exports: []structureExport{}, References: []structureReference{}, Dependencies: []structureDependency{},
		Completeness: structureCompleteness{Exports: complete(), References: complete(), Dependencies: complete()},
	}
	seen := map[string]structureSymbol{}
	admit := func(symbol *shimast.Symbol) (string, bool) {
		// Record every alias declaration before erasing it. Barrel edits must
		// invalidate readers even when the final target declaration stays unchanged.
		aliases := map[*shimast.Symbol]bool{}
		for symbol != nil && symbol.Flags&shimast.SymbolFlagsAlias != 0 && !aliases[symbol] {
			aliases[symbol] = true
			x.observeProjectionSymbol(symbol)
			symbol = x.checker.GetImmediateAliasedSymbol(symbol)
		}
		symbol = unalias(x.checker, symbol)
		if symbol != nil {
			for _, declaration := range symbol.Declarations {
				if owner := shimast.GetSourceFileOfNode(declaration); owner != nil {
					coordinate, _ := x.publicSourceCoordinate(owner.FileName())
					if strings.HasPrefix(coordinate, "external:") {
						// The legacy fallback is a basename, so two loose external
						// files can otherwise fabricate the same canonical identity.
						// Keep structural uncertainty local without changing old IDs.
						x.observeProjectionSymbol(symbol)
						return "", true
					}
				}
			}
		}
		id := x.symbolID(symbol)
		if id == "" {
			return "", false
		}
		if _, exists := seen[id]; exists {
			return id, false
		}
		spans := []sourceSpan{}
		for _, declaration := range symbol.Declarations {
			owner := shimast.GetSourceFileOfNode(declaration)
			if owner != nil {
				if _, owned := x.sources[owner.FileName()]; owned {
					spans = append(spans, x.span(owner, declaration))
				}
			}
		}
		sort.Slice(spans, func(i, j int) bool {
			if spans[i].Source != spans[j].Source {
				return spans[i].Source < spans[j].Source
			}
			return spans[i].Start < spans[j].Start
		})
		name := stableSymbolName(symbol)
		// Compiler module-symbol names contain physical paths. Their public
		// presentation uses the already owned portable source coordinate.
		if isModuleNamespaceSymbol(symbol) {
			if owner := shimast.GetSourceFileOfNode(symbol.Declarations[0]); owner != nil {
				name, _ = x.publicSourceCoordinate(owner.FileName())
			}
		}
		generationScoped := name == "" || name == "<anonymous>"
		if payload, ok := x.symbolSeen[id]; ok {
			generationScoped = payload.GenerationScoped
		}
		var origin *callTargetOrigin
		if !isModuleNamespaceSymbol(symbol) {
			origin = x.callTargetOrigin(symbol)
		}
		seen[id] = structureSymbol{Symbol: id, Name: name, Declarations: spans,
			Origin: origin, GenerationScoped: generationScoped}
		return id, false
	}

	if module := x.checker.GetSymbolAtLocation(file.AsNode()); module != nil {
		moduleType := x.checker.GetTypeOfSymbol(module)
		for _, exported := range shimchecker.Checker_getExportsOfModule(x.checker, module) {
			target := unalias(x.checker, exported)
			id, looseExternal := admit(exported)
			if id == "" {
				code, message := "STRUCTURE_EXPORT_UNRESOLVED", "An export has no canonical declaration identity."
				if looseExternal {
					code, message = "STRUCTURE_EXTERNAL_COORDINATE_UNREGISTERED", "A loose external declaration has no unambiguous owned or package coordinate."
				}
				result.Completeness.Exports = structurePartial(result.Completeness.Exports,
					code, message, x.span(file, file.AsNode()))
				continue
			}
			// Star exports may return the original value symbol even when reached
			// solely through `export type *`. Ask the compiler's module value type
			// rather than attempting to rebuild its star/alias conflict algorithm.
			typeOnly := exportTypeOnly(exported, target, declarationKindOf(x.checker, target)) ||
				x.checker.GetPropertyOfType(moduleType, exported.Name) == nil
			result.Exports = append(result.Exports, structureExport{Name: exported.Name, Symbol: id, TypeOnly: typeOnly})
		}
	}
	sort.Slice(result.Exports, func(i, j int) bool { return result.Exports[i].Name < result.Exports[j].Name })

	walkFile(file, func(node *shimast.Node) bool {
		if node.Kind != shimast.KindIdentifier && node.Kind != shimast.KindPrivateIdentifier && node.Kind != shimast.KindElementAccessExpression {
			return true
		}
		if structuralNonReference(node) {
			return true
		}
		referenceNode := node
		if node.Kind == shimast.KindElementAccessExpression {
			argument := node.AsElementAccessExpression().ArgumentExpression
			if argument != nil && (argument.Kind == shimast.KindStringLiteral || argument.Kind == shimast.KindNoSubstitutionTemplateLiteral || argument.Kind == shimast.KindNumericLiteral) {
				// The compiler's location API resolves the literal index token,
				// not the enclosing ElementAccessExpression.
				referenceNode = argument
			}
		}
		symbol := x.checker.GetSymbolAtLocation(referenceNode)
		if node.Parent != nil && node.Parent.Kind == shimast.KindShorthandPropertyAssignment && node.Parent.Name() == node {
			symbol = x.checker.GetShorthandAssignmentValueSymbol(node.Parent)
		}
		kind := structuralReferenceKind(node, symbol)
		span := x.span(file, referenceNode)
		id, looseExternal := admit(symbol)
		if id == "" {
			code, message := "STRUCTURE_REFERENCE_UNRESOLVED", "A symbolic reference has no canonical declaration identity."
			if looseExternal {
				code, message = "STRUCTURE_EXTERNAL_COORDINATE_UNREGISTERED", "A loose external declaration has no unambiguous owned or package coordinate."
			}
			result.Completeness.References = structurePartial(result.Completeness.References,
				code, message, span)
		}
		binding := ""
		if node.Kind == shimast.KindIdentifier || node.Kind == shimast.KindPrivateIdentifier {
			binding = node.Text()
		}
		result.References = append(result.References, structureReference{Symbol: id, Start: span.Start, End: span.End, Kind: kind, Binding: binding})
		return true
	})

	references, computed := x.dependencyReferences(file)
	for _, reference := range references {
		span := x.span(file, reference.node)
		specifier := reference.specifier
		edge := structureDependency{Start: span.Start, End: span.End, Kind: structuralDependencyKind(reference.node),
			TypeOnly: reference.typeOnly, Specifier: &specifier}
		for parent := reference.node.Parent; parent != nil && parent.Kind != shimast.KindSourceFile; parent = parent.Parent {
			if parent.Kind == shimast.KindImportEqualsDeclaration {
				edge.TypeOnly = parent.AsImportEqualsDeclaration().IsTypeOnly
				break
			}
		}
		resolved := program.TSProgram.GetResolvedModuleFromModuleSpecifier(file, reference.node)
		if resolved != nil && resolved.IsResolved() {
			path := resolved.ResolvedFileName
			if canonical, err := filepath.EvalSymlinks(path); err == nil {
				path = canonical
			}
			edge.TargetPath, _ = x.publicSourceCoordinate(path)
			if strings.HasPrefix(edge.TargetPath, "external:") {
				edge.TargetPath = ""
				result.Completeness.Dependencies = structurePartial(result.Completeness.Dependencies,
					"STRUCTURE_EXTERNAL_COORDINATE_UNREGISTERED", "A resolved loose external module has no unambiguous owned or package coordinate.", span)
			}
		} else {
			result.Completeness.Dependencies = structurePartial(result.Completeness.Dependencies,
				"STRUCTURE_DEPENDENCY_UNRESOLVED", "A module specifier could not be resolved.", span)
			if edge.Kind == "export" {
				result.Completeness.Exports = structurePartial(result.Completeness.Exports,
					"STRUCTURE_EXPORT_MODULE_UNRESOLVED", "A re-export source could not be resolved.", span)
			}
		}
		result.Dependencies = append(result.Dependencies, edge)
	}
	for _, reference := range computed {
		span := x.span(file, reference.node)
		result.Dependencies = append(result.Dependencies, structureDependency{Start: span.Start, End: span.End, Kind: reference.kind})
		result.Completeness.Dependencies = structurePartial(result.Completeness.Dependencies,
			"STRUCTURE_COMPUTED_DEPENDENCY", "A computed module request has an unknown target.", span)
		result.Completeness.References = structurePartial(result.Completeness.References,
			"STRUCTURE_COMPUTED_DEPENDENCY", "A computed module request may introduce symbolic uses outside this projection.", span)
	}
	// Syntactic recovery cannot certify the absence of missing authored syntax.
	if len(program.TSProgram.GetSyntacticDiagnostics(context.Background(), file)) != 0 {
		span := x.span(file, file.AsNode())
		result.Completeness.Exports = structurePartial(result.Completeness.Exports, "STRUCTURE_PARSE_ERROR", "Source syntax required compiler recovery.", span)
		result.Completeness.References = structurePartial(result.Completeness.References, "STRUCTURE_PARSE_ERROR", "Source syntax required compiler recovery.", span)
		result.Completeness.Dependencies = structurePartial(result.Completeness.Dependencies, "STRUCTURE_PARSE_ERROR", "Source syntax required compiler recovery.", span)
	}
	// Binding conflicts and failed/ambiguous re-exports may cause the compiler to
	// omit symbols while still returning a module export table.
	for _, diagnostic := range program.DiagnosticsForFiles([]*shimast.SourceFile{file}) {
		if diagnostic.File != file.FileName() || diagnostic.Severity != driver.SeverityError {
			continue
		}
		span := x.span(file, file.AsNode())
		result.Completeness.Exports = structurePartial(result.Completeness.Exports,
			"STRUCTURE_COMPILER_ERROR", "Compiler errors prevent exhaustive export certification.", span)
		result.Completeness.References = structurePartial(result.Completeness.References,
			"STRUCTURE_COMPILER_ERROR", "Compiler errors prevent exhaustive reference certification.", span)
		break
	}
	for _, symbol := range seen {
		result.Symbols = append(result.Symbols, symbol)
	}
	sort.Slice(result.Symbols, func(i, j int) bool { return result.Symbols[i].Symbol < result.Symbols[j].Symbol })
	sort.SliceStable(result.Dependencies, func(i, j int) bool {
		if result.Dependencies[i].Start != result.Dependencies[j].Start {
			return result.Dependencies[i].Start < result.Dependencies[j].Start
		}
		return result.Dependencies[i].TypeOnly && !result.Dependencies[j].TypeOnly
	})
	completion := complete()
	for _, dimension := range []completeness{result.Completeness.Exports, result.Completeness.References, result.Completeness.Dependencies} {
		if dimension.Kind != "complete" {
			completion.Kind = "partial"
			completion.Reasons = append(completion.Reasons, dimension.Reasons...)
		}
	}
	span := x.span(file, file.AsNode())
	entry := x.newFact(structureNamespace, "structure", record.Source, result, []sourceSpan{span}, completion)
	return finishShard(structureNamespace, record.Source, completion, []preparedFact{entry})
}

func structuralReferenceKind(node *shimast.Node, symbol *shimast.Symbol) string {
	for parent := node.Parent; parent != nil && parent.Kind != shimast.KindSourceFile; parent = parent.Parent {
		switch parent.Kind {
		case shimast.KindImportDeclaration, shimast.KindImportEqualsDeclaration:
			return "import"
		case shimast.KindExportDeclaration, shimast.KindExportAssignment:
			return "export"
		}
	}
	if node.Parent != nil && node.Parent.Kind == shimast.KindShorthandPropertyAssignment {
		return "value"
	}
	if symbol != nil && isDeclarationName(node, symbol) {
		return "declaration"
	}
	if shimast.IsPartOfTypeNode(node) {
		return "type"
	}
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if parent.Kind == shimast.KindTypeQuery {
			return "type"
		}
		if parent.Kind != shimast.KindQualifiedName {
			break
		}
		if shimast.IsPartOfTypeNode(parent) {
			return "type"
		}
	}
	return "value"
}

func structuralNonReference(node *shimast.Node) bool {
	if node.Parent == nil {
		return false
	}
	// Labels are control-flow names, not TypeScript value/type symbols.
	switch strings.TrimPrefix(node.Parent.KindString(), "Kind") {
	case "LabeledStatement", "BreakStatement", "ContinueStatement":
		return true
	}
	return false
}

func structuralDependencyKind(node *shimast.Node) string {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		switch parent.Kind {
		case shimast.KindImportDeclaration, shimast.KindImportEqualsDeclaration:
			return "import"
		case shimast.KindExportDeclaration:
			return "export"
		case shimast.KindImportType:
			return "import-type"
		case shimast.KindCallExpression:
			if parent.AsCallExpression().Expression.Kind == shimast.KindImportKeyword {
				return "dynamic"
			}
			return "require"
		}
	}
	return "import"
}
