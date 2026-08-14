package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

// moduleShard is deliberately rooted in an explicit application-supplied
// boundary. The generic analyzer never guesses packages or TypeSpec modules
// from repository layout.
type moduleObservation struct {
	boundary   moduleBoundary
	payload    moduleFactPayload
	completion completeness
	evidence   []sourceSpan
}

func (x *extractor) moduleShards(program *driver.Program) ([]factShard, error) {
	observations := map[string]*moduleObservation{}
	currentProject := filepath.Clean(program.ParsedConfig.ConfigName())
	for _, boundary := range x.modules {
		configuredProject := filepath.Clean(filepath.Join(x.root, filepath.FromSlash(boundary.Project)))
		if configuredProject != currentProject {
			continue
		}
		observation, err := x.observeModule(program, boundary)
		if err != nil {
			return nil, err
		}
		observations[boundary.ID] = observation
	}
	if len(observations) == 0 {
		return []factShard{}, nil
	}
	x.attachCompilerDiagnostics(program.Diagnostics(), observations)
	edges, dependencyIssues := x.observeModuleDependencies(program)
	for module, issues := range dependencyIssues {
		if observation := observations[module]; observation != nil {
			observation.payload.Issues = append(observation.payload.Issues, issues...)
		}
	}
	for _, observation := range observations {
		edges = append(edges, x.publicAPIDependencies(observation.boundary, observation.payload)...)
	}
	edges = deduplicateDependencies(edges)
	for _, edge := range edges {
		if observation := observations[edge.SourceModule]; observation != nil {
			observation.payload.Dependencies = append(observation.payload.Dependencies, edge)
		}
		if observation := observations[edge.TargetModule]; observation != nil {
			observation.payload.InboundDependencies = append(observation.payload.InboundDependencies, edge)
		}
	}
	ids := make([]string, 0, len(observations))
	for id := range observations {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	shards := make([]factShard, 0, len(ids))
	for _, id := range ids {
		observation := observations[id]
		sortDependencies(observation.payload.Dependencies)
		sortDependencies(observation.payload.InboundDependencies)
		entry := x.newFact(moduleNamespace, "module", id, observation.payload, observation.evidence, observation.completion)
		shards = append(shards, finishShard(moduleNamespace, id, observation.completion, []fact{entry}))
	}
	return shards, nil
}

// attachCompilerDiagnostics mirrors the catalog ownership contract used by
// the Node/TypeScript oracle without treating the oracle's compiler as the
// semantic authority. Project-level diagnostics have no source and therefore
// apply to every module in the project. Source-local diagnostics are retained
// only when the source is catalog-owned and belongs to one of this project's
// configured module boundaries.
func (x *extractor) attachCompilerDiagnostics(diagnostics []driver.Diagnostic, observations map[string]*moduleObservation) {
	for _, diagnostic := range diagnostics {
		issue := map[string]any{
			"code":    fmt.Sprintf("TYPESCRIPT_%d", diagnostic.Code),
			"message": diagnostic.Message,
		}
		if diagnostic.File == "" || diagnostic.Start == nil {
			for _, observation := range observations {
				observation.payload.Issues = append(observation.payload.Issues, issue)
			}
			continue
		}
		path, catalog := x.publicSourceCoordinate(diagnostic.File)
		if !catalog {
			continue
		}
		owner := x.moduleOwner(diagnostic.File)
		if owner == nil {
			continue
		}
		observation := observations[owner.ID]
		if observation == nil {
			continue
		}
		line, column := diagnostic.Line, diagnostic.Column
		if line < 1 {
			line = 1
		}
		if column < 1 {
			column = 1
		}
		located := make(map[string]any, len(issue)+1)
		for key, value := range issue {
			located[key] = value
		}
		located["location"] = sourceLocation{File: path, Line: line, Column: column}
		observation.payload.Issues = append(observation.payload.Issues, located)
	}
}

func (x *extractor) observeModule(program *driver.Program, boundary moduleBoundary) (*moduleObservation, error) {
	entrypoint := filepath.Clean(filepath.Join(x.root, filepath.FromSlash(boundary.Entrypoint)))
	var source *shimast.SourceFile
	for _, candidate := range program.SourceFiles() {
		if filepath.Clean(candidate.FileName()) == entrypoint {
			source = candidate
			break
		}
	}
	payload := moduleFactPayload{
		Target:  moduleTargetPayload(boundary),
		Exports: []observedExportPayload{}, Declarations: []observedDeclarationPayload{},
		Dependencies: []dependencyPayload{}, InboundDependencies: []dependencyPayload{},
		DeclaredPackages: []string{}, DevelopmentPackages: []string{}, WorkspacePackages: []string{},
		ErrorCodes: []errorCodePayload{}, Files: x.moduleFiles(boundary, program.SourceFiles()), Issues: []any{},
	}
	completion := complete()
	var evidence []sourceSpan
	if source == nil {
		payload.Issues = append(payload.Issues, observationIssue(
			"MODULE_ENTRYPOINT_NOT_IN_PROJECT",
			"The configured entrypoint is not included by the TypeScript project.",
			sourceLocation{File: boundary.Entrypoint, Line: 1, Column: 1},
		))
	} else {
		if record, ok := x.sources[source.FileName()]; ok {
			evidence = []sourceSpan{{Source: record.Source, Revision: record.Revision, Start: 0, End: max(1, len(source.Text()))}}
		}
		moduleSymbol := x.checker.GetSymbolAtLocation(source.AsNode())
		if moduleSymbol == nil {
			payload.Issues = append(payload.Issues, observationIssue(
				"MODULE_ENTRYPOINT_SYMBOL_UNRESOLVED",
				"TypeScript did not expose a module symbol for the configured entrypoint.",
				x.location(source, source.AsNode()),
			))
		} else {
			partialObservation := x.collectModuleSurface(source, moduleSymbol, boundary, &payload)
			if partialObservation {
				completion = partial(
					"TYPESCRIPT_MODULE_TYPE_STRUCTURE_PARTIAL",
					"The compiler resolved the complete export set, but at least one declaration type is represented as an explicit unsupported value.",
					map[string]any{"module": boundary.ID},
				)
			}
		}
	}
	declared, development, workspace, packageIssue := packageIntent(x.root, filepath.Join(x.root, filepath.FromSlash(boundary.Root)))
	if packageIssue != nil {
		payload.Issues = append(payload.Issues, packageIssue)
	}
	payload.DeclaredPackages = declared
	payload.DevelopmentPackages = development
	payload.WorkspacePackages = workspace
	payload.ErrorCodes = x.observeErrorCodes(boundary, program.SourceFiles())
	return &moduleObservation{boundary: boundary, payload: payload, completion: completion, evidence: evidence}, nil
}

func (x *extractor) collectModuleSurface(source *shimast.SourceFile, root *shimast.Symbol, boundary moduleBoundary, payload *moduleFactPayload) bool {
	type pendingExport struct {
		path     []string
		exported *shimast.Symbol
		target   *shimast.Symbol
	}
	pending := []pendingExport{}
	var collect func(*shimast.Symbol, []string, map[*shimast.Symbol]bool)
	collect = func(module *shimast.Symbol, namespace []string, active map[*shimast.Symbol]bool) {
		if active[module] {
			payload.Issues = append(payload.Issues, observationIssue(
				"TYPESCRIPT_NAMESPACE_CYCLE",
				fmt.Sprintf("Recursive namespace export cannot be exhaustively observed: %s", strings.Join(namespace, ".")),
				x.symbolLocation(module),
			))
			return
		}
		active[module] = true
		exports := append([]*shimast.Symbol{}, shimchecker.Checker_getExportsOfModule(x.checker, module)...)
		sort.SliceStable(exports, func(i, j int) bool {
			leftTarget, rightTarget := unalias(x.checker, exports[i]), unalias(x.checker, exports[j])
			return compareExportSymbols(exports[i], leftTarget, exports[j], rightTarget) < 0
		})
		for _, exported := range exports {
			target := unalias(x.checker, exported)
			if target == nil {
				target = exported
			}
			// TypeScript exposes a declaration-less `prototype` symbol for some
			// callable/class facets. It is checker machinery, not an authored
			// module export, and must not enter the portable public surface.
			if exported.Name == "prototype" && firstDeclaration(exported) == nil && firstDeclaration(target) == nil {
				continue
			}
			path := append(append([]string{}, namespace...), exported.Name)
			if declarationKindOf(x.checker, target) == "namespace" && pureNamespace(target) {
				collect(target, path, active)
				continue
			}
			pending = append(pending, pendingExport{path: path, exported: exported, target: target})
			if hasNamespaceFacet(target) {
				collect(target, path, active)
			}
		}
		delete(active, module)
	}
	collect(root, []string{}, map[*shimast.Symbol]bool{})

	symbols := map[string]*shimast.Symbol{}
	paths := map[string][][]string{}
	for _, item := range pending {
		kind := declarationKindOf(x.checker, item.target)
		identity := x.publicSymbolIdentity(item.target)
		if identity == "" {
			identity = "ts:<synthetic>#" + percentEncode(item.target.Name)
		}
		symbols[identity] = item.target
		paths[identity] = append(paths[identity], append([]string{}, item.path...))
		payload.Exports = append(payload.Exports, observedExportPayload{
			Path: item.path, Name: item.exported.Name, Declaration: identity, Kind: kind,
			TypeOnly:     exportTypeOnly(item.exported, item.target, kind),
			SourceModule: x.exportSourceModule(item.exported),
			Location:     x.symbolLocationPreferred(item.exported, item.target),
		})
	}
	pendingSymbols := make([]string, 0, len(symbols))
	for identity := range symbols {
		pendingSymbols = append(pendingSymbols, identity)
	}
	sort.Strings(pendingSymbols)
	seen := map[string]bool{}
	partialObservation := false
	for len(pendingSymbols) != 0 {
		identity := pendingSymbols[0]
		pendingSymbols = pendingSymbols[1:]
		if seen[identity] {
			continue
		}
		seen[identity] = true
		declaration, references := x.observePublicDeclaration(symbols[identity], paths[identity])
		payload.Declarations = append(payload.Declarations, declaration)
		for _, issue := range declaration.Issues {
			if x.issueBelongsToModule(issue, boundary) {
				// The declaration fact already scopes its local issue collection. The
				// module projection is a flattened diagnostic stream, so retain the
				// stable declaration join explicitly for downstream filtering and
				// navigation instead of making consumers rediscover containment.
				payload.Issues = append(payload.Issues, attachDeclarationToIssues([]any{issue}, declaration.Identity)...)
			}
		}
		if containsUnsupportedObservation(declaration) {
			partialObservation = true
		}
		for referenceIdentity, reference := range references {
			if _, exists := symbols[referenceIdentity]; !exists {
				symbols[referenceIdentity] = reference
				pendingSymbols = append(pendingSymbols, referenceIdentity)
			}
		}
		sort.Strings(pendingSymbols)
	}
	sort.Slice(payload.Declarations, func(i, j int) bool { return payload.Declarations[i].Identity < payload.Declarations[j].Identity })
	return partialObservation
}

func (x *extractor) issueBelongsToModule(issue any, boundary moduleBoundary) bool {
	record, ok := issue.(map[string]any)
	if !ok {
		return true
	}
	location, ok := record["location"].(sourceLocation)
	if !ok || location.File == "" {
		return true
	}
	owner := x.moduleOwner(filepath.Join(x.root, filepath.FromSlash(location.File)))
	return owner == nil || owner.ID == boundary.ID
}

func compareExportSymbols(leftExport, leftTarget, rightExport, rightTarget *shimast.Symbol) int {
	left := firstDeclaration(leftExport)
	if left == nil {
		left = firstDeclaration(leftTarget)
	}
	right := firstDeclaration(rightExport)
	if right == nil {
		right = firstDeclaration(rightTarget)
	}
	if left == nil {
		if right != nil {
			return 1
		}
		return 0
	}
	if right == nil {
		return -1
	}
	leftFile, rightFile := shimast.GetSourceFileOfNode(left), shimast.GetSourceFileOfNode(right)
	if leftFile != nil && rightFile != nil && leftFile.FileName() != rightFile.FileName() {
		if leftFile.FileName() < rightFile.FileName() {
			return -1
		}
		return 1
	}
	if left.Pos() < right.Pos() {
		return -1
	}
	if left.Pos() > right.Pos() {
		return 1
	}
	return 0
}

func containsUnsupportedObservation(value any) bool {
	encoded := stableJSON(value)
	return strings.Contains(encoded, `"kind":"unsupported"`) || strings.Contains(encoded, `"code":"TYPESCRIPT_TYPE_UNSUPPORTED"`)
}

func (x *extractor) symbolWithinCatalog(symbol *shimast.Symbol) bool {
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations {
		file := shimast.GetSourceFileOfNode(declaration)
		if file == nil {
			continue
		}
		if _, catalog := x.publicSourceCoordinate(file.FileName()); catalog {
			return true
		}
	}
	return false
}

func percentEncode(value string) string {
	var output strings.Builder
	for _, character := range []byte(value) {
		if character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || strings.ContainsRune("-_.!~*'()", rune(character)) {
			output.WriteByte(character)
		} else {
			fmt.Fprintf(&output, "%%%02X", character)
		}
	}
	return output.String()
}

func declarationKindOf(checker *shimchecker.Checker, symbol *shimast.Symbol) string {
	if factorySymbol(symbol) {
		return "factory"
	}
	if symbol.Flags&shimast.SymbolFlagsClass != 0 {
		return "class"
	}
	if symbol.Flags&shimast.SymbolFlagsInterface != 0 {
		return "interface"
	}
	if symbol.Flags&shimast.SymbolFlagsModule != 0 {
		return "namespace"
	}
	if symbol.Flags&shimast.SymbolFlagsFunction != 0 {
		return "callable"
	}
	if declaration := declarationNode(symbol); declaration != nil {
		value := shimchecker.Checker_getTypeOfSymbolAtLocation(checker, symbol, declaration)
		if len(shimchecker.Checker_getSignaturesOfType(checker, value, shimchecker.SignatureKindCall)) != 0 {
			return "callable"
		}
	}
	if symbol.Flags&(shimast.SymbolFlagsTypeAlias|shimast.SymbolFlagsVariable|shimast.SymbolFlagsEnum|shimast.SymbolFlagsEnumMember) != 0 {
		return "value"
	}
	return "unsupported"
}

func factorySymbol(symbol *shimast.Symbol) bool {
	types, values := 0, 0
	for _, declaration := range symbol.Declarations {
		switch declaration.Kind {
		case shimast.KindTypeAliasDeclaration:
			types++
		case shimast.KindFunctionDeclaration, shimast.KindVariableDeclaration:
			values++
		case shimast.KindModuleDeclaration:
		default:
			return false
		}
	}
	return types == 1 && values == 1
}

func pureNamespace(symbol *shimast.Symbol) bool {
	if len(symbol.Declarations) == 0 {
		return false
	}
	for _, declaration := range symbol.Declarations {
		if declaration.Kind != shimast.KindModuleDeclaration && declaration.Kind != shimast.KindSourceFile {
			return false
		}
	}
	return true
}

func hasNamespaceFacet(symbol *shimast.Symbol) bool {
	hasModule, hasOther := false, false
	for _, declaration := range symbol.Declarations {
		if declaration.Kind == shimast.KindModuleDeclaration {
			hasModule = true
		} else {
			hasOther = true
		}
	}
	return hasModule && hasOther
}

func exportTypeOnly(exported, target *shimast.Symbol, kind string) bool {
	for _, declaration := range exported.Declarations {
		if declaration.Kind == shimast.KindExportSpecifier && declaration.AsExportSpecifier().IsTypeOnly {
			return true
		}
		if declaration.Parent != nil && declaration.Parent.Parent != nil && declaration.Parent.Parent.Kind == shimast.KindExportDeclaration && declaration.Parent.Parent.AsExportDeclaration().IsTypeOnly {
			return true
		}
		if declaration.Kind == shimast.KindExportDeclaration && declaration.AsExportDeclaration().IsTypeOnly {
			return true
		}
	}
	if kind == "factory" {
		return false
	}
	return kind == "interface" || target.Flags&shimast.SymbolFlagsTypeAlias != 0 || target.Flags&shimast.SymbolFlagsValue == 0
}

func (x *extractor) symbolLocationPreferred(primary, fallback *shimast.Symbol) sourceLocation {
	if node := firstDeclaration(primary); node != nil {
		return x.location(shimast.GetSourceFileOfNode(node), node)
	}
	return x.symbolLocation(fallback)
}

func (x *extractor) symbolLocation(symbol *shimast.Symbol) sourceLocation {
	node := firstDeclaration(symbol)
	if node == nil {
		return sourceLocation{File: ".", Line: 1, Column: 1}
	}
	return x.location(shimast.GetSourceFileOfNode(node), node)
}

func firstDeclaration(symbol *shimast.Symbol) *shimast.Node {
	if symbol == nil || len(symbol.Declarations) == 0 {
		return nil
	}
	values := append([]*shimast.Node{}, symbol.Declarations...)
	sort.Slice(values, func(i, j int) bool {
		left, right := shimast.GetSourceFileOfNode(values[i]), shimast.GetSourceFileOfNode(values[j])
		if left != nil && right != nil && left.FileName() != right.FileName() {
			return left.FileName() < right.FileName()
		}
		return values[i].Pos() < values[j].Pos()
	})
	return values[0]
}

func (x *extractor) location(file *shimast.SourceFile, node *shimast.Node) sourceLocation {
	if file == nil {
		return sourceLocation{File: ".", Line: 1, Column: 1}
	}
	start := 0
	if node != nil && node != file.AsNode() {
		start = shimscanner.SkipTrivia(file.Text(), node.Pos())
	}
	line, column := 1, 1
	for index := 0; index < start && index < len(file.Text()); index++ {
		if file.Text()[index] == '\n' {
			line++
			column = 1
		} else {
			column++
		}
	}
	path, catalog := x.publicSourceCoordinate(file.FileName())
	if catalog {
		return sourceLocation{File: path, Line: line, Column: column}
	}
	return sourceLocation{External: path, Line: line, Column: column}
}

// publicSourceCoordinate mirrors the portable V1 identity contract while
// remaining independent from source ownership. Declaration files can be
// catalog-owned identities even though they are excluded from executable
// source shards; compiler libraries and installed packages must never leak an
// absolute checkout path.
func (x *extractor) publicSourceCoordinate(path string) (string, bool) {
	absolute := filepath.Clean(path)
	normalized := filepath.ToSlash(absolute)
	if filename := typescriptLibraryFile(absolute); filename != "" {
		return "platform:typescript/" + filename, false
	}
	if index := strings.LastIndex(normalized, "/node_modules/"); index >= 0 {
		return "package:" + normalized[index+len("/node_modules/"):], false
	}
	if relative, err := filepath.Rel(x.root, absolute); err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		if relative == "" {
			return ".", true
		}
		return filepath.ToSlash(relative), true
	}
	if coordinate := workspacePackageCoordinate(x.root, absolute); coordinate != "" {
		return coordinate, false
	}
	return "external:" + filepath.Base(absolute), false
}

// TypeScript-Go exposes its embedded standard libraries through a virtual
// `bundled:/libs` path, while Node TypeScript uses `typescript/lib`. Both are
// the same logical platform provider and must yield one portable coordinate.
func typescriptLibraryFile(path string) string {
	normalized := filepath.ToSlash(filepath.Clean(path))
	parts := strings.Split(normalized, "/")
	if len(parts) == 0 {
		return ""
	}
	filename := parts[len(parts)-1]
	declaration := strings.HasPrefix(filename, "lib") &&
		(strings.HasSuffix(filename, ".d.ts") || strings.HasSuffix(filename, ".d.mts") || strings.HasSuffix(filename, ".d.cts"))
	if !declaration {
		return ""
	}
	if len(parts) >= 3 && parts[len(parts)-2] == "lib" && parts[len(parts)-3] == "typescript" {
		return filename
	}
	if strings.HasPrefix(normalized, "bundled:/libs/") || strings.Contains(normalized, "/bundled:/libs/") {
		return filename
	}
	return ""
}

func (x *extractor) declarationPackageCoordinate(file *shimast.SourceFile) string {
	if file == nil {
		return ""
	}
	if filename := typescriptLibraryFile(file.FileName()); filename != "" {
		return "package:typescript/lib/" + filename
	}
	return canonicalTypeProviderCoordinate(workspacePackageCoordinate(x.root, file.FileName()))
}

func workspacePackageCoordinate(root, source string) string {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return ""
	}
	absoluteSource, err := filepath.Abs(source)
	if err != nil {
		return ""
	}
	inside := pathContains(absoluteRoot, absoluteSource)
	directory := filepath.Dir(absoluteSource)
	for {
		if inside && !pathContains(absoluteRoot, directory) {
			return ""
		}
		content, readErr := os.ReadFile(filepath.Join(directory, "package.json"))
		if readErr == nil {
			var document struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(content, &document) != nil {
				return ""
			}
			// Nested package metadata is commonly used only to select ESM/CJS
			// semantics and legitimately has no package name. It is not an
			// ownership boundary: keep walking to the nearest named manifest.
			if document.Name != "" {
				subpath, relativeErr := filepath.Rel(directory, absoluteSource)
				if relativeErr != nil || subpath == "." {
					return "package:" + document.Name
				}
				return "package:" + document.Name + "/" + filepath.ToSlash(subpath)
			}
		}
		if readErr != nil && !os.IsNotExist(readErr) {
			return ""
		}
		if inside && directory == absoluteRoot {
			return ""
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return ""
		}
		directory = parent
	}
}

func canonicalTypeProviderCoordinate(coordinate string) string {
	const prefix = "package:@types/"
	if !strings.HasPrefix(coordinate, prefix) {
		return coordinate
	}
	parts := strings.Split(strings.TrimPrefix(coordinate, prefix), "/")
	if len(parts) == 0 || parts[0] == "" {
		return coordinate
	}
	provider := parts[0]
	if separator := strings.Index(provider, "__"); separator >= 0 {
		provider = "@" + provider[:separator] + "/" + provider[separator+2:]
	}
	result := "package:" + provider
	if len(parts) > 1 {
		result += "/" + strings.Join(parts[1:], "/")
	}
	return result
}

func pathContains(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func (x *extractor) moduleFiles(boundary moduleBoundary, sources []*shimast.SourceFile) []string {
	files := []string{}
	for _, source := range sources {
		if source.IsDeclarationFile {
			continue
		}
		owner := x.moduleOwner(source.FileName())
		if owner == nil || owner.ID != boundary.ID {
			continue
		}
		if record, exists := x.sources[source.FileName()]; exists {
			files = append(files, record.Path)
		}
	}
	sort.Strings(files)
	return files
}

func observationIssue(code, message string, location sourceLocation) map[string]any {
	return map[string]any{"code": code, "message": message, "location": location}
}

func packageIntent(catalogRoot, moduleRoot string) ([]string, []string, []string, any) {
	packageFile := nearestPackageFile(moduleRoot)
	if packageFile == "" {
		return []string{}, []string{}, []string{}, nil
	}
	content, err := os.ReadFile(packageFile)
	if err != nil {
		return []string{}, []string{}, []string{}, observationIssue(
			"TYPESCRIPT_PACKAGE_INVALID", err.Error(), sourceLocation{File: portableRelative(catalogRoot, packageFile), Line: 1, Column: 1},
		)
	}
	var document struct {
		Dependencies         map[string]string `json:"dependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
		PeerDependencies     map[string]string `json:"peerDependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		return []string{}, []string{}, []string{}, observationIssue(
			"TYPESCRIPT_PACKAGE_INVALID", err.Error(), sourceLocation{File: portableRelative(catalogRoot, packageFile), Line: 1, Column: 1},
		)
	}
	declared := []string{}
	for name := range document.Dependencies {
		declared = append(declared, name)
	}
	for name := range document.OptionalDependencies {
		declared = append(declared, name)
	}
	for name := range document.PeerDependencies {
		declared = append(declared, name)
	}
	development := []string{}
	workspace := []string{}
	sections := []map[string]string{document.Dependencies, document.OptionalDependencies, document.PeerDependencies, document.DevDependencies}
	for _, section := range sections {
		for name, version := range section {
			declared = append(declared, name)
			if strings.HasPrefix(version, "workspace:") {
				workspace = append(workspace, name)
			}
		}
	}
	for name := range document.DevDependencies {
		development = append(development, name)
	}
	return sortedUnique(declared), sortedUnique(development), sortedUnique(workspace), nil
}

func nearestPackageFile(start string) string {
	current := filepath.Clean(start)
	for {
		candidate := filepath.Join(current, "package.json")
		if metadata, err := os.Stat(candidate); err == nil && !metadata.IsDir() {
			return candidate
		}
		parent := filepath.Dir(current)
		if parent == current {
			return ""
		}
		current = parent
	}
}

func portableRelative(root, target string) string {
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return filepath.ToSlash(target)
	}
	if relative == "" {
		return "."
	}
	return filepath.ToSlash(relative)
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}
