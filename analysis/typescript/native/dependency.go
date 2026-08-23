package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

type dependencyReference struct {
	specifier string
	node      *shimast.Node
	kind      string
	typeOnly  bool
}

func (x *extractor) observeModuleDependencies(program *driver.Program) ([]dependencyPayload, map[string][]any) {
	edges := []dependencyPayload{}
	issues := map[string][]any{}
	for _, source := range program.SourceFiles() {
		sourceOwner := x.moduleOwner(source.FileName())
		references, unresolved := x.dependencyReferences(source)
		for _, reference := range references {
			resolved := program.TSProgram.GetResolvedModuleFromModuleSpecifier(source, reference.node)
			targetFile := ""
			if resolved != nil && resolved.IsResolved() {
				targetFile = resolved.ResolvedFileName
				if canonical, err := filepath.EvalSymlinks(targetFile); err == nil {
					targetFile = canonical
				}
			}
			targetOwner := x.moduleOwner(targetFile)
			if sourceOwner == nil && targetOwner == nil {
				continue
			}
			sourceCoordinate := workspacePackageCoordinate(x.root, source.FileName())
			targetCoordinate := workspacePackageCoordinate(x.root, targetFile)
			if ownPackageManifest(sourceCoordinate, targetCoordinate) {
				continue
			}
			sourceModule := "unowned:" + portableRelative(x.root, source.FileName())
			if sourceOwner != nil {
				sourceModule = sourceOwner.ID
			}
			targetModule := x.externalDependencyTarget(reference.specifier, targetFile, targetCoordinate)
			if targetOwner != nil {
				targetModule = targetOwner.ID
			}
			if sourceOwner != nil && targetOwner != nil && sourceOwner.ID == targetOwner.ID {
				continue
			}
			location := x.location(source, reference.node)
			targetPath := reference.specifier
			if targetFile != "" {
				targetPath, _ = x.publicSourceCoordinate(targetFile)
			}
			edge := dependencyPayload{
				SourceModule: sourceModule, TargetModule: targetModule, Kind: reference.kind,
				SourceFile: portableRelative(x.root, source.FileName()), TargetFile: targetPath,
				Occurrences: []dependencyOccurrencePayload{{
					TypeOnly: reference.typeOnly, Specifier: reference.specifier,
					Deep:     targetOwner != nil && !x.publicEntrypoint(*targetOwner, targetFile) && !declaredPackageImport(x.root, source.FileName(), reference.specifier),
					Location: location,
				}},
			}
			identifyDependency(&edge)
			edges = append(edges, edge)
		}
		for _, unresolvedReference := range unresolved {
			code, message := "TYPESCRIPT_REQUIRE_UNRESOLVED", "Computed require cannot establish its target boundary."
			if unresolvedReference.kind == "dynamic" {
				code, message = "TYPESCRIPT_DYNAMIC_IMPORT_UNRESOLVED", "Computed dynamic import cannot establish its target boundary."
			}
			owners := []string{}
			if sourceOwner != nil {
				owners = append(owners, sourceOwner.ID)
			} else {
				for _, boundary := range x.modules {
					owners = append(owners, boundary.ID)
				}
			}
			for _, owner := range sortedUnique(owners) {
				issues[owner] = append(issues[owner], observationIssue(code, message, x.location(source, unresolvedReference.node)))
			}
		}
	}
	return deduplicateDependencies(edges), issues
}

func (x *extractor) dependencyReferences(source *shimast.SourceFile) ([]dependencyReference, []struct {
	kind string
	node *shimast.Node
}) {
	references := []dependencyReference{}
	unresolved := []struct {
		kind string
		node *shimast.Node
	}{}
	add := func(node *shimast.Node, kind string, typeOnly bool) {
		if node != nil && (node.Kind == shimast.KindStringLiteral || node.Kind == shimast.KindNoSubstitutionTemplateLiteral) {
			references = append(references, dependencyReference{specifier: node.Text(), node: node, kind: kind, typeOnly: typeOnly})
		}
	}
	walkFile(source, func(node *shimast.Node) bool {
		switch node.Kind {
		case shimast.KindImportDeclaration, shimast.KindJSImportDeclaration:
			declaration := node.AsImportDeclaration()
			clause := declaration.ImportClause
			if clause == nil {
				add(declaration.ModuleSpecifier, "side-effect", false)
				break
			}
			value := clause.AsImportClause()
			if value.PhaseModifier == shimast.KindTypeKeyword {
				add(declaration.ModuleSpecifier, "type", true)
				break
			}
			runtime, typeOnly := value.Name() != nil, false
			if value.NamedBindings != nil {
				switch value.NamedBindings.Kind {
				case shimast.KindNamespaceImport:
					runtime = true
				case shimast.KindNamedImports:
					for _, element := range value.NamedBindings.AsNamedImports().Elements.Nodes {
						if element.AsImportSpecifier().IsTypeOnly {
							typeOnly = true
						} else {
							runtime = true
						}
					}
				}
			}
			if runtime {
				add(declaration.ModuleSpecifier, "runtime", false)
			}
			if typeOnly {
				add(declaration.ModuleSpecifier, "type", true)
			}
		case shimast.KindExportDeclaration:
			declaration := node.AsExportDeclaration()
			if declaration.ModuleSpecifier == nil {
				break
			}
			typeOnly := declaration.IsTypeOnly
			if !typeOnly && declaration.ExportClause != nil && declaration.ExportClause.Kind == shimast.KindNamedExports {
				elements := declaration.ExportClause.AsNamedExports().Elements.Nodes
				typeOnly = len(elements) != 0
				for _, element := range elements {
					typeOnly = typeOnly && element.AsExportSpecifier().IsTypeOnly
				}
			}
			add(declaration.ModuleSpecifier, "api", typeOnly)
		case shimast.KindImportEqualsDeclaration:
			declaration := node.AsImportEqualsDeclaration()
			if declaration.ModuleReference != nil && declaration.ModuleReference.Kind == shimast.KindExternalModuleReference {
				add(declaration.ModuleReference.AsExternalModuleReference().Expression, "runtime", false)
			}
		case shimast.KindImportType:
			argument := node.AsImportTypeNode().Argument
			if argument != nil && argument.Kind == shimast.KindLiteralType {
				add(argument.AsLiteralTypeNode().Literal, "type", true)
			}
		case shimast.KindCallExpression:
			call := node.AsCallExpression()
			if call == nil || call.Expression == nil {
				break
			}
			kind := ""
			if call.Expression.Kind == shimast.KindImportKeyword {
				kind = "dynamic"
			} else if call.Expression.Kind == shimast.KindIdentifier && call.Expression.Text() == "require" && x.moduleRequire(call.Expression) {
				kind = "require"
			}
			if kind == "" {
				break
			}
			var argument *shimast.Node
			if call.Arguments != nil && len(call.Arguments.Nodes) != 0 {
				argument = call.Arguments.Nodes[0]
			}
			if argument != nil && (argument.Kind == shimast.KindStringLiteral || argument.Kind == shimast.KindNoSubstitutionTemplateLiteral) {
				add(argument, map[bool]string{true: "dynamic", false: "runtime"}[kind == "dynamic"], false)
			} else {
				if argument == nil {
					argument = node
				}
				unresolved = append(unresolved, struct {
					kind string
					node *shimast.Node
				}{kind: kind, node: argument})
			}
		}
		return true
	})
	return references, unresolved
}

func (x *extractor) moduleRequire(identifier *shimast.Node) bool {
	symbol := x.checker.GetSymbolAtLocation(identifier)
	if symbol == nil {
		return true
	}
	for _, declaration := range symbol.Declarations {
		file := shimast.GetSourceFileOfNode(declaration)
		if file != nil && !file.IsDeclarationFile {
			return false
		}
	}
	return true
}

func (x *extractor) moduleOwner(path string) *moduleBoundary {
	if path == "" {
		return nil
	}
	absolute := filepath.Clean(path)
	var owner *moduleBoundary
	for index := range x.modules {
		boundary := &x.modules[index]
		root := filepath.Clean(filepath.Join(x.root, filepath.FromSlash(boundary.Root)))
		if pathContains(root, absolute) && (owner == nil || len(root) > len(filepath.Clean(filepath.Join(x.root, filepath.FromSlash(owner.Root))))) {
			owner = boundary
		}
	}
	return owner
}

func (x *extractor) publicEntrypoint(boundary moduleBoundary, file string) bool {
	for _, entry := range append([]string{boundary.Entrypoint}, append(append(append([]string{}, boundary.Facades...), boundary.Aliases...), boundary.Internals...)...) {
		if filepath.Clean(filepath.Join(x.root, filepath.FromSlash(entry))) == filepath.Clean(file) {
			return true
		}
	}
	return false
}

func (x *extractor) externalDependencyTarget(specifier, targetFile, coordinate string) string {
	if target := packageTarget(coordinate); target != "" {
		return target
	}
	// A physical pnpm store lives beneath the workspace root, but it remains
	// an external package provider. Only classify a compiler-resolved file as
	// unowned workspace source after package-coordinate resolution fails.
	if targetFile != "" && pathContains(x.root, targetFile) {
		return "unowned:" + portableRelative(x.root, targetFile)
	}
	if strings.HasPrefix(specifier, "node:") {
		return "platform:" + specifier
	}
	if !strings.HasPrefix(specifier, ".") && !filepath.IsAbs(specifier) {
		return "package:" + packageNameFromSpecifier(specifier)
	}
	if targetFile != "" {
		coordinate, _ := x.publicSourceCoordinate(targetFile)
		return "unowned:" + coordinate
	}
	return "unowned:" + specifier
}

func packageTarget(coordinate string) string {
	coordinate = canonicalTypeProviderCoordinate(coordinate)
	if !strings.HasPrefix(coordinate, "package:") {
		return ""
	}
	return "package:" + packageNameFromSpecifier(strings.TrimPrefix(coordinate, "package:"))
}

func packageNameFromSpecifier(specifier string) string {
	parts := strings.Split(specifier, "/")
	if strings.HasPrefix(specifier, "@") && len(parts) >= 2 {
		return strings.Join(parts[:2], "/")
	}
	if len(parts) != 0 {
		return parts[0]
	}
	return specifier
}

func ownPackageManifest(source, target string) bool {
	sourcePackage, targetPackage := packageTarget(source), packageTarget(target)
	return sourcePackage != "" && sourcePackage == targetPackage && canonicalTypeProviderCoordinate(target) == targetPackage+"/package.json"
}

func identifyDependency(edge *dependencyPayload) {
	edge.ID = deriveID("typescript-dependency", moduleNamespace, map[string]any{
		"sourceModule": edge.SourceModule,
		"targetModule": edge.TargetModule,
		"kind":         edge.Kind,
		"sourceFile":   edge.SourceFile,
		"targetFile":   edge.TargetFile,
	})
	for index := range edge.Occurrences {
		occurrence := &edge.Occurrences[index]
		publicPath := occurrence.PublicPath
		if publicPath == nil {
			publicPath = []string{}
		}
		occurrence.ID = deriveID("occurrence", moduleNamespace+":"+edge.ID, map[string]any{
			"typeOnly":    occurrence.TypeOnly,
			"specifier":   occurrence.Specifier,
			"deep":        occurrence.Deep,
			"location":    occurrence.Location,
			"declaration": occurrence.Declaration,
			"publicPath":  publicPath,
		})
	}
}

func deduplicateDependencies(values []dependencyPayload) []dependencyPayload {
	byID := map[string]*dependencyPayload{}
	for _, value := range values {
		current := byID[value.ID]
		if current == nil {
			copy := value
			copy.Occurrences = append([]dependencyOccurrencePayload{}, value.Occurrences...)
			byID[value.ID] = &copy
		} else {
			current.Occurrences = append(current.Occurrences, value.Occurrences...)
		}
	}
	result := make([]dependencyPayload, 0, len(byID))
	for _, value := range byID {
		seen := map[string]bool{}
		occurrences := value.Occurrences[:0]
		sort.Slice(value.Occurrences, func(i, j int) bool { return value.Occurrences[i].ID < value.Occurrences[j].ID })
		for _, occurrence := range value.Occurrences {
			if seen[occurrence.ID] {
				continue
			}
			seen[occurrence.ID] = true
			occurrences = append(occurrences, occurrence)
		}
		value.Occurrences = occurrences
		result = append(result, *value)
	}
	sortDependencies(result)
	return result
}

func sortDependencies(values []dependencyPayload) {
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
}

func locationSource(location sourceLocation) string {
	if location.File != "" {
		return location.File
	}
	return location.External
}

func declaredPackageImport(root, sourceFile, specifier string) bool {
	if !strings.HasPrefix(specifier, "#") || specifier == "#" {
		return false
	}
	current := filepath.Dir(sourceFile)
	for pathContains(root, current) {
		content, err := os.ReadFile(filepath.Join(current, "package.json"))
		if err == nil {
			var document struct {
				Imports map[string]any `json:"imports"`
			}
			if json.Unmarshal(content, &document) == nil {
				for key := range document.Imports {
					if packageImportMatches(key, specifier) {
						return true
					}
				}
			}
		}
		if current == root {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return false
}

func packageImportMatches(pattern, specifier string) bool {
	if pattern == specifier {
		return true
	}
	index := strings.Index(pattern, "*")
	return index >= 0 && strings.HasPrefix(specifier, pattern[:index]) && strings.HasSuffix(specifier, pattern[index+1:])
}

func (x *extractor) publicAPIDependencies(boundary moduleBoundary, exports []observedExportPayload) []dependencyPayload {
	type pendingDeclaration struct {
		identity string
		path     []string
	}
	pending := []pendingDeclaration{}
	for _, exported := range exports {
		pending = append(pending, pendingDeclaration{
			identity: exported.Declaration,
			path:     []string{exported.Declaration},
		})
	}
	visited := map[string]bool{}
	edges := []dependencyPayload{}
	for len(pending) != 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		identity := current.identity
		if visited[identity] {
			continue
		}
		visited[identity] = true
		observation, exists := x.moduleDeclarationsByIdentity[identity]
		if !exists {
			continue
		}
		declaration := observation.declaration
		// The public surface closure remains transitive after it crosses an
		// ownership boundary. Stopping at the first external declaration loses
		// both deeper owner relationships and additional occurrences that fold
		// into the same logical edge.
		for _, reference := range declaration.ReferencedDeclarations {
			path := append(append([]string{}, current.path...), reference)
			pending = append(pending, pendingDeclaration{identity: reference, path: path})
		}
		var owner *moduleBoundary
		if declaration.Location.File != "" {
			owner = x.moduleOwner(filepath.Join(x.root, filepath.FromSlash(declaration.Location.File)))
		}
		if owner != nil && owner.ID == boundary.ID {
			continue
		}
		target := x.externalAPITarget(declaration.Location)
		// Compiler-platform identity is semantic authority even when an ambient
		// declaration happens to live under @types/node (for example Uint8Array
		// compatibility augmentation). Physical provider layout must not turn a
		// platform symbol into an undeclared package dependency.
		if strings.HasPrefix(identity, "platform:") {
			target = strings.Split(identity, "#")[0]
		} else if owner != nil {
			target = owner.ID
		}
		if target == "" {
			continue
		}
		edge := dependencyPayload{
			SourceModule: boundary.ID, TargetModule: target, Kind: "api",
			SourceFile: boundary.Entrypoint, TargetFile: locationSource(declaration.Location),
			Occurrences: []dependencyOccurrencePayload{{
				TypeOnly: true, Specifier: "<public-type-closure>", Deep: false,
				Location: declaration.Location, Declaration: identity, PublicPath: current.path,
			}},
		}
		identifyDependency(&edge)
		edges = append(edges, edge)
	}
	return edges
}

func (x *extractor) externalAPITarget(location sourceLocation) string {
	coordinate := locationSource(location)
	if location.File != "" {
		if packageCoordinate := workspacePackageCoordinate(x.root, filepath.Join(x.root, filepath.FromSlash(location.File))); packageCoordinate != "" {
			coordinate = packageCoordinate
		}
	}
	coordinate = canonicalTypeProviderCoordinate(coordinate)
	if strings.HasPrefix(coordinate, "platform:") {
		return strings.Split(coordinate, "/")[0]
	}
	if strings.HasPrefix(coordinate, "package:") {
		return packageTarget(coordinate)
	}
	if coordinate != "" {
		return "unowned:" + coordinate
	}
	return ""
}

var errorCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

func (x *extractor) observeErrorCodes(boundary moduleBoundary, sources []*shimast.SourceFile) []errorCodePayload {
	codes := map[string]errorCodePayload{}
	record := func(code string, file *shimast.SourceFile, node *shimast.Node) {
		if !errorCodePattern.MatchString(code) {
			return
		}
		if _, exists := codes[code]; !exists {
			codes[code] = errorCodePayload{Code: code, Location: x.location(file, node)}
		}
	}
	orderedSources := append([]*shimast.SourceFile{}, sources...)
	sort.Slice(orderedSources, func(i, j int) bool { return orderedSources[i].FileName() < orderedSources[j].FileName() })
	for _, source := range orderedSources {
		owner := x.moduleOwner(source.FileName())
		if owner == nil || owner.ID != boundary.ID {
			continue
		}
		walkFile(source, func(node *shimast.Node) bool {
			switch node.Kind {
			case shimast.KindEnumMember:
				name := node.AsEnumMember().Name()
				if name != nil && (name.Kind == shimast.KindIdentifier || name.Kind == shimast.KindStringLiteral || name.Kind == shimast.KindNumericLiteral) {
					record(name.Text(), source, name)
				}
			case shimast.KindLiteralType:
				literal := node.AsLiteralTypeNode().Literal
				if literal != nil && literal.Kind == shimast.KindStringLiteral {
					record(literal.Text(), source, literal)
				}
			case shimast.KindPropertyAssignment:
				initializer := node.AsPropertyAssignment().Initializer
				if initializer != nil && initializer.Kind == shimast.KindStringLiteral {
					record(initializer.Text(), source, initializer)
				}
			}
			return true
		})
	}
	values := make([]errorCodePayload, 0, len(codes))
	for _, value := range codes {
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return values[i].Code < values[j].Code })
	return values
}
