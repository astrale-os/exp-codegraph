package main

import (
	"path/filepath"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

// exportSourceModule retains the public package named by an authored re-export.
// Local barrel hops are followed through the resident Checker; no resolver is
// reimplemented outside TypeScript-Go.
func (x *extractor) exportSourceModule(exported *shimast.Symbol) string {
	return x.exportSourceModuleSeen(exported, map[*shimast.Symbol]bool{})
}

func (x *extractor) exportSourceModuleSeen(exported *shimast.Symbol, active map[*shimast.Symbol]bool) string {
	if exported == nil || active[exported] {
		return ""
	}
	active[exported] = true
	defer delete(active, exported)

	for _, declaration := range exported.Declarations {
		exportDeclaration := exportDeclarationOf(declaration)
		if exportDeclaration == nil {
			continue
		}
		specifierNode := exportDeclaration.AsExportDeclaration().ModuleSpecifier
		if specifierNode == nil {
			continue
		}
		specifier := specifierNode.Text()
		if source := publicPackageSpecifier(specifier); source != "" {
			return source
		}

		module := unalias(x.checker, x.checker.GetSymbolAtLocation(specifierNode))
		if module == nil || (!strings.HasPrefix(specifier, ".") && !x.symbolWithinCatalog(module)) {
			continue
		}
		name := exported.Name
		if declaration.Kind == shimast.KindExportSpecifier {
			value := declaration.AsExportSpecifier()
			if value.PropertyName != nil {
				name = value.PropertyName.Text()
			} else if value.Name() != nil {
				name = value.Name().Text()
			}
		}
		for _, candidate := range shimchecker.Checker_getExportsOfModule(x.checker, module) {
			if candidate.Name == name {
				if source := x.exportSourceModuleSeen(candidate, active); source != "" {
					return source
				}
				break
			}
		}
	}

	resolved := unalias(x.checker, exported)
	if resolved == nil || resolved == exported || x.symbolWithinCatalog(resolved) {
		return ""
	}
	declaration := firstDeclaration(resolved)
	if declaration == nil {
		return ""
	}
	file := shimast.GetSourceFileOfNode(declaration)
	if file == nil {
		return ""
	}
	return publicPackageCoordinate(x.declarationPackageCoordinate(file))
}

func exportDeclarationOf(declaration *shimast.Node) *shimast.Node {
	if declaration == nil {
		return nil
	}
	if declaration.Kind == shimast.KindExportDeclaration {
		return declaration
	}
	if declaration.Kind == shimast.KindExportSpecifier && declaration.Parent != nil && declaration.Parent.Parent != nil && declaration.Parent.Parent.Kind == shimast.KindExportDeclaration {
		return declaration.Parent.Parent
	}
	return nil
}

func publicPackageSpecifier(specifier string) string {
	if strings.HasPrefix(specifier, ".") || filepath.IsAbs(specifier) || strings.HasPrefix(specifier, "#") || strings.HasPrefix(specifier, "node:") {
		return ""
	}
	return "package:" + specifier
}

func publicPackageCoordinate(coordinate string) string {
	coordinate = canonicalTypeProviderCoordinate(coordinate)
	if !strings.HasPrefix(coordinate, "package:") {
		return ""
	}
	value := strings.TrimPrefix(coordinate, "package:")
	parts := strings.Split(value, "/")
	packageParts := 1
	if strings.HasPrefix(value, "@") {
		packageParts = 2
	}
	if len(parts) < packageParts {
		return ""
	}
	name := strings.Join(parts[:packageParts], "/")
	subpath := strings.Join(parts[packageParts:], "/")
	for _, suffix := range []string{"/.spec/api.d.ts", "/.spec/api.ts", "/index.d.ts", "/index.d.mts", "/index.d.cts", "/index.ts", "/index.mts", "/index.cts"} {
		subpath = strings.TrimSuffix(subpath, suffix)
	}
	subpath = strings.TrimSuffix(subpath, "/")
	if subpath == "" {
		return "package:" + name
	}
	return "package:" + name + "/" + subpath
}
