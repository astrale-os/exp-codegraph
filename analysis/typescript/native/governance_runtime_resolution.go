package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	"os"
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

		coordinate, err := governanceRuntimeDeclarationCoordinate(owner.Identity.Project, source.FileName())
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
			return nil, "" // Original callTargetOrigin rejects differing declaration coordinates authoritatively.
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
	result.Reads = append(result.Reads, observabledecision.SemanticRead{Kind: "contextual-runtime-resolution", Path: path, Name: specifier, Fingerprint: owner.Identity.Project.capture.semanticTicket()})
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
	result.Path = logical
	result.Target = declaration
	return result
}

// Global lookup is reached only after the captured lexical/import owner misses.
// It returns actual external value-symbol provenance, never a callable type.
func (owner *governanceRuntimeAuthority) GlobalValue(path string, node *ast.Node) observabledecision.GlobalValueObservation {
	file, ok := owner.ByPath[path]
	if !ok {
		return observabledecision.GlobalValueObservation{}
	}
	matched, known := owner.node(file, node)
	if !known || matched.Kind != ast.KindIdentifier {
		return observabledecision.GlobalValueObservation{}
	}
	check := owner.Identity.TypeOwner.program.Checker
	symbol := unalias(check, check.GetSymbolAtLocation(matched))
	read := observabledecision.SemanticRead{Kind: "actual-global-value-origin", Path: path, Name: matched.Text(), Fingerprint: owner.Identity.Project.capture.semanticTicket()}
	if symbol == nil {
		return observabledecision.GlobalValueObservation{Known: true, Reads: []observabledecision.SemanticRead{read}}
	}
	origin, reason := owner.origin(symbol)
	if origin == nil {
		declaration := declarationNode(symbol)
		if declaration != nil {
			source := ast.GetSourceFileOfNode(declaration)
			if source != nil {
				if targetPath, owned := governanceRuntimeProgramOwned(owner.Identity.Project.Root, source.FileName()); owned {
					owner.ensureAdmissions(targetPath)
					switch declaration.Kind {
					case ast.KindBindingElement, ast.KindParameter:
						return observabledecision.GlobalValueObservation{Known: true, Reads: []observabledecision.SemanticRead{read}}
					case ast.KindVariableDeclaration:
						if owner.admission(declaration) != "" {
							return observabledecision.GlobalValueObservation{Known: true, Target: declaration, TargetPath: targetPath, Reads: []observabledecision.SemanticRead{read}}
						}
					case ast.KindFunctionDeclaration:
						if owner.FunctionBodies[declaration] {
							return observabledecision.GlobalValueObservation{Known: true, Target: declaration, TargetPath: targetPath, Reads: []observabledecision.SemanticRead{read}}
						}
					}
					return observabledecision.GlobalValueObservation{Reads: []observabledecision.SemanticRead{read}}
				}
			}
		}
	}

	return observabledecision.GlobalValueObservation{Known: reason == "", Origin: origin, Reads: []observabledecision.SemanticRead{read}}
}
func (owner *governanceRuntimeAuthority) ExpressionAdmitted(path string, node *ast.Node) (bool, bool) {
	file, ok := owner.ByPath[path]
	if !ok {
		return false, false
	}
	matched, known := owner.node(file, node)
	if !known {
		return false, false
	}
	return owner.admission(matched) != "", true
}

func (owner *governanceRuntimeAuthority) ReferenceAvailable(path string, node *ast.Node) (bool, bool) {
	file, ok := owner.ByPath[path]
	if !ok {
		return false, false
	}
	matched, known := owner.node(file, node)
	if !known || matched.Kind != ast.KindIdentifier {
		return false, false
	}
	symbol := owner.Symbol(file, matched)
	return symbol.Key != "", symbol.Known
}

// Value provenance is distinct from universe identity. The legacy producer resolves
// relative bundled declaration paths from its project cwd, then walks manifests.
// Every absent manifest is retained by the same immutable input capture.
func governanceRuntimeDeclarationCoordinate(project *governedProject, path string) (string, error) {
	if typescriptLibraryFile(path) == "" {
		return governancePortableUniversePath(project, path)
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(project.Root, path)
	}
	path = filepath.Clean(path)
	directory := filepath.Dir(path)
	inside := pathContains(project.Root, path)
	for {
		if inside && !pathContains(project.Root, directory) {
			break
		}
		manifest := project.capture.packageManifestProduct(filepath.Join(directory, "package.json"))
		if manifest.readError == nil {
			if manifest.parseError != nil {
				break
			}
			if manifest.name != "" {
				relative, err := filepath.Rel(directory, path)
				if err != nil {
					return "", err
				}
				return "package:" + manifest.name + "/" + filepath.ToSlash(relative), nil
			}
		} else if !os.IsNotExist(manifest.readError) {
			return "", manifest.readError
		}
		if inside && directory == project.Root {
			break
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", nil
}
