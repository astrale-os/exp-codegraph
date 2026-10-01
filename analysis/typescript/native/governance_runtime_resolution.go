package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	"path/filepath"
	"strings"
)

// Declaration provenance follows the actual compiler export/alias value chain.
// Portable package coordinates are read through the retained input capture.
func (owner *governanceRuntimeAuthority) origin(symbol *ast.Symbol) (*observabledecision.Origin, string) {
	check := owner.Identity.TypeOwner.program.Checker
	symbol = unalias(check, symbol)
	if symbol == nil {
		return nil, "runtime export symbol unavailable"
	}
	var origin *observabledecision.Origin
	for _, declaration := range symbol.Declarations {
		source := ast.GetSourceFileOfNode(declaration)
		if source == nil {
			return nil, "runtime declaration source unavailable"
		}
		coordinate, err := governancePortableUniversePath(owner.Identity.Project, source.FileName())
		if err != nil {
			return nil, err.Error()
		}
		if !strings.HasPrefix(coordinate, "package:") {
			return nil, ""
		}
		qualified := strings.TrimPrefix(coordinate, "package:")
		pkg := packageNameFromSpecifier(qualified)
		path := strings.TrimPrefix(qualified, pkg+"/")
		if path == qualified || path == "" {
			return nil, "runtime package declaration coordinate unavailable"
		}
		names := []string{stableSymbolName(symbol)}
		if names[0] == "" {
			return nil, "runtime declaration name unavailable"
		}
		for parent := declaration.Parent; parent != nil && parent.Kind != ast.KindSourceFile; parent = parent.Parent {
			if parent.Name() == nil {
				continue
			}
			if parent.Symbol() != nil {
				if name := stableSymbolName(parent.Symbol()); name != "" {
					names = append(names, name)
				}
			}
		}
		for left, right := 0, len(names)-1; left < right; left, right = left+1, right-1 {
			names[left], names[right] = names[right], names[left]
		}
		candidate := &observabledecision.Origin{Package: pkg, File: path, Path: names}
		if origin != nil && stableJSON(origin) != stableJSON(candidate) {
			return nil, "runtime merged declaration provenance differs"
		}
		origin = candidate
	}
	if origin == nil {
		return nil, "runtime declaration inventory unavailable"
	}
	return origin, ""
}
func (owner *governanceRuntimeAuthority) Resolve(path, specifier, export string) observabledecision.Resolution {
	result := observabledecision.Resolution{}
	if !owner.Identity.Complete {
		result.Reason = "actual runtime Program inventory unavailable"
		return result
	}
	file, ok := owner.ByPath[path]
	if !ok {
		result.Reason = "captured runtime owner unavailable"
		return result
	}
	if _, owned := owner.Identity.OwnedProgramFiles[path]; !owned {
		result.Reason = "runtime authored owner outside actual Program"
		return result
	}
	captured := owner.Identity.Project.FilesByPath[path]
	if captured == nil {
		captured = &governedFile{Path: path, AbsolutePath: file.AbsolutePath, Source: file.Source, Text: file.Text}
	}
	resolved := owner.Identity.Project.resolveImport(captured, specifier, false)
	result.Reads = append(result.Reads, observabledecision.SemanticRead{Kind: "contextual-runtime-resolution", Path: path, Name: specifier, Fingerprint: owner.Identity.Project.capture.certificate()})
	if !resolved.IsResolved() {
		result.Reason = "actual runtime module resolution unavailable"
		return result
	}
	source := owner.Identity.TypeOwner.program.SourceFile(resolved.ResolvedFileName)
	if source == nil {
		result.Reason = "resolved runtime module outside actual Program"
		return result
	}
	check := owner.Identity.TypeOwner.program.Checker
	module := check.GetSymbolAtLocation(source.AsNode())
	if module == nil {
		module = source.AsNode().Symbol()
	}
	if module == nil {
		result.Reason = "actual runtime module symbol unavailable"
		return result
	}
	var symbol *ast.Symbol
	for _, candidate := range checker.Checker_getExportsOfModule(check, module) {
		if candidate.Name == export {
			symbol = candidate
			break
		}
	}
	if symbol == nil {
		result.Reason = "actual runtime export absent"
		return result
	}
	if symbol.Flags&ast.SymbolFlagsAlias != 0 && check.GetTypeOnlyAliasDeclaration(symbol) != nil {
		result.Reason = "runtime export is type-only"
		return result
	}
	symbol = unalias(check, symbol)
	// Follow only executable const identifier/property aliases, as the legacy
	// callable owner does. Structurally callable types are never a value witness.
	x := &extractor{checker: check}
	if declaration := declarationNode(symbol); declaration != nil && declaration.Kind == ast.KindVariableDeclaration && ast.IsConst(declaration) {
		if initializer := declaration.AsVariableDeclaration().Initializer; initializer != nil && (initializer.Kind == ast.KindIdentifier || initializer.Kind == ast.KindPropertyAccessExpression) {
			symbol = x.canonicalCallSymbol(initializer, func(*ast.Symbol) {})
		}
	}
	origin, reason := owner.origin(symbol)
	result.Reads = append(result.Reads, observabledecision.SemanticRead{Kind: "canonical-runtime-export", Path: resolved.ResolvedFileName, Name: export, Fingerprint: governanceHash([]byte(fmt.Sprintf("%s:%s:%s", owner.symbolKey(symbol), source.Text(), stableJSON(origin))))})
	if reason != "" {
		result.Reason = reason
		return result
	}
	if origin != nil {
		result.Origin = origin
		return result
	}
	declaration := declarationNode(symbol)
	if declaration == nil {
		result.Reason = "captured local export declaration unavailable"
		return result
	}
	declSource := ast.GetSourceFileOfNode(declaration)
	logical, owned := governanceRuntimeProgramOwned(owner.Identity.Project.Root, declSource.FileName())
	if !owned || owner.ByPath[logical].Source == nil {
		result.Reason = "runtime helper source not captured"
		return result
	}
	if filepath.Clean(declSource.FileName()) != filepath.Clean(source.FileName()) || stableSymbolName(symbol) != export {
		result.Reason = "local runtime reexport/renaming requires demanded binding adapter"
		return result
	}
	result.Path = logical
	return result
}
