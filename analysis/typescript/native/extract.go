package main

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

const (
	projectNamespace    = "typescript.project"
	diagnosticNamespace = "typescript.diagnostic"
	sourceNamespace     = "typescript.source"
	symbolNamespace     = "typescript.symbol"
	occurrenceNamespace = "typescript.occurrence"
	bodyNamespace       = "typescript.body"
	moduleNamespace     = "astrale.typescript.module"
)

var supportedCapabilities = []string{
	projectNamespace,
	diagnosticNamespace,
	sourceNamespace,
	symbolNamespace,
	occurrenceNamespace,
	bodyNamespace,
	moduleNamespace,
}

type extractor struct {
	root       string
	universe   string
	checker    *shimchecker.Checker
	sources    map[string]sourceRecord
	symbolIDs  map[*shimast.Symbol]string
	symbolSeen map[string]symbolFactPayload
	modules    []moduleBoundary
}

func extractProgram(root, universe string, program *driver.Program, modules []moduleBoundary, telemetry *nativeTelemetry, requestID int) ([]factShard, []sourceRecord, error) {
	x, files, records := prepareExtractor(root, universe, program, modules, nil, nil, telemetry, requestID)
	var shards []factShard
	phase := time.Now()
	shards = append(shards, x.projectShard(program))
	telemetry.record(requestID, "projection.project", phase, nil)
	phase = time.Now()
	diagnostic := x.diagnosticShard(program)
	shards = append(shards, diagnostic)
	telemetry.record(requestID, "projection.diagnostics", phase, map[string]any{"facts": len(diagnostic.Facts)})
	phase = time.Now()
	moduleShards, err := x.moduleShards(program)
	if err != nil {
		return nil, nil, err
	}
	shards = append(shards, moduleShards...)
	telemetry.record(requestID, "projection.modules", phase, map[string]any{"shards": len(moduleShards)})
	shards = append(shards, x.sourceShards(files, nil, telemetry, requestID)...)
	sort.Slice(shards, func(i, j int) bool { return shards[i].Key < shards[j].Key })
	return shards, records, nil
}

// prepareExtractor installs a complete source identity table while hashing only
// the selected sources when prior records are available. Semantic extraction
// can therefore resolve declarations outside a private edit without re-reading
// or retaining any unaffected fact payload.
func prepareExtractor(
	root, universe string,
	program *driver.Program,
	modules []moduleBoundary,
	prior map[string]sourceRecord,
	selected map[string]bool,
	telemetry *nativeTelemetry,
	requestID int,
) (*extractor, []*shimast.SourceFile, []sourceRecord) {
	x := &extractor{
		root: root, universe: universe, checker: program.Checker,
		sources: map[string]sourceRecord{}, symbolIDs: map[*shimast.Symbol]string{},
		symbolSeen: map[string]symbolFactPayload{}, modules: modules,
	}
	files := program.SourceFiles()
	sort.Slice(files, func(i, j int) bool { return files[i].FileName() < files[j].FileName() })
	phase := time.Now()
	for _, file := range files {
		path, owned := x.ownedPath(file.FileName())
		if !owned {
			continue
		}
		if record, exists := prior[file.FileName()]; exists && selected != nil && !selected[file.FileName()] {
			x.sources[file.FileName()] = record
			continue
		}
		source := deriveID("source", "typescript:"+universe, map[string]any{"path": path})
		digest := hashText(file.Text())
		x.sources[file.FileName()] = sourceRecord{
			Physical: file.FileName(), Path: path, Source: source, TextDigest: digest,
			Revision: deriveID("source-revision", source, map[string]any{"digest": digest}),
		}
	}
	telemetry.record(requestID, "projection.source-inventory", phase, map[string]any{"programSources": len(files), "ownedSources": len(x.sources)})
	var records []sourceRecord
	for _, file := range files {
		record, ok := x.sources[file.FileName()]
		if !ok {
			continue
		}
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Path < records[j].Path })
	return x, files, records
}

// sourceShards projects the source-owned namespaces for selected physical
// files. A nil selection denotes the complete owned compiler universe.
func (x *extractor) sourceShards(
	files []*shimast.SourceFile,
	selected map[string]bool,
	telemetry *nativeTelemetry,
	requestID int,
) []factShard {
	var shards []factShard
	phase := time.Now()
	selectedCount := 0
	for _, file := range files {
		if selected != nil && !selected[file.FileName()] {
			continue
		}
		record, ok := x.sources[file.FileName()]
		if !ok {
			continue
		}
		selectedCount++
		shards = append(shards, x.sourceShard(file, record))
		x.discoverSymbols(file)
	}
	telemetry.record(requestID, "projection.sources-and-symbol-discovery", phase, map[string]any{"sources": selectedCount})
	phase = time.Now()
	for _, file := range files {
		if selected != nil && !selected[file.FileName()] {
			continue
		}
		record, ok := x.sources[file.FileName()]
		if !ok {
			continue
		}
		if shard := x.symbolShard(file, record); len(shard.Facts) != 0 {
			shards = append(shards, shard)
		}
	}
	telemetry.record(requestID, "projection.symbols", phase, nil)
	phase = time.Now()
	for _, file := range files {
		if selected != nil && !selected[file.FileName()] {
			continue
		}
		record, ok := x.sources[file.FileName()]
		if !ok {
			continue
		}
		if shard := x.occurrenceShard(file, record); len(shard.Facts) != 0 {
			shards = append(shards, shard)
		}
	}
	telemetry.record(requestID, "projection.occurrences", phase, nil)
	phase = time.Now()
	bodyShards := 0
	for _, file := range files {
		if selected != nil && !selected[file.FileName()] {
			continue
		}
		record, ok := x.sources[file.FileName()]
		if !ok {
			continue
		}
		bodies := x.bodyShards(file, record)
		bodyShards += len(bodies)
		shards = append(shards, bodies...)
	}
	telemetry.record(requestID, "projection.bodies", phase, map[string]any{"shards": bodyShards})
	sort.Slice(shards, func(i, j int) bool { return shards[i].Key < shards[j].Key })
	return shards
}

func (x *extractor) projectShard(program *driver.Program) factShard {
	configuration := []string{program.ParsedConfig.ConfigName()}
	configuration = append(configuration, program.ParsedConfig.ExtendedSourceFiles()...)
	for index, path := range configuration {
		configuration[index], _ = x.ownedPath(path)
	}
	references := append([]string{}, program.ParsedConfig.ResolvedProjectReferencePaths()...)
	for index, path := range references {
		references[index], _ = x.ownedPath(path)
	}
	payload := projectFactPayload{
		Universe:           x.universe,
		ConfigurationFiles: sortedUnique(configuration),
		ProjectReferences:  sortedUnique(references),
	}
	entry := x.newFact(projectNamespace, "typescript-project", x.universe, payload, nil, complete())
	return finishShard(projectNamespace, x.universe, complete(), []fact{entry})
}

func (x *extractor) diagnosticShard(program *driver.Program) factShard {
	diagnostics := program.Diagnostics()
	facts := make([]fact, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		severity := "error"
		if diagnostic.Severity == driver.SeverityWarning {
			severity = "warning"
		}
		file := ""
		var evidence []sourceSpan
		var diagnosticSpan *sourceSpan
		if diagnostic.File != "" {
			file, _ = x.ownedPath(diagnostic.File)
			if record, exists := x.sources[diagnostic.File]; exists && diagnostic.Start != nil {
				end := *diagnostic.Start + 1
				if diagnostic.Length != nil && *diagnostic.Length > 0 {
					end = *diagnostic.Start + *diagnostic.Length
				}
				span := sourceSpan{Source: record.Source, Revision: record.Revision, Start: *diagnostic.Start, End: end}
				diagnosticSpan = &span
				evidence = []sourceSpan{span}
			}
		}
		payload := diagnosticFactPayload{
			Code: diagnostic.Code, Severity: severity, Message: diagnostic.Message,
			File: file, Span: diagnosticSpan,
		}
		subject := x.universe
		if diagnosticSpan != nil {
			subject = diagnosticSpan.Source
		}
		facts = append(facts, x.newFact(
			diagnosticNamespace, "compiler-diagnostic", subject, payload, evidence, complete(),
		))
	}
	return finishShard(diagnosticNamespace, x.universe, complete(), facts)
}

func (x *extractor) sourceShard(file *shimast.SourceFile, record sourceRecord) factShard {
	payload := sourceFactPayload{
		Source: record.Source, Revision: record.Revision, TextDigest: record.TextDigest, LogicalPath: record.Path,
		Declaration: file.IsDeclarationFile, ProjectOwned: true,
	}
	entry := x.newFact(sourceNamespace, "source", record.Source, payload, nil, complete())
	return finishShard(sourceNamespace, record.Source, complete(), []fact{entry})
}

func (x *extractor) discoverSymbols(file *shimast.SourceFile) {
	walkFile(file, func(node *shimast.Node) bool {
		symbol := unalias(x.checker, node.Symbol())
		if symbol == nil || len(symbol.Declarations) == 0 {
			return true
		}
		_ = x.symbolID(symbol)
		return true
	})
}

func (x *extractor) symbolShard(file *shimast.SourceFile, record sourceRecord) factShard {
	var facts []fact
	for id, payload := range x.symbolSeen {
		if len(payload.Declarations) == 0 || payload.Declarations[0].Source != record.Source {
			continue
		}
		facts = append(facts, x.newFact(
			symbolNamespace, "symbol", id, payload, payload.Declarations, complete(),
		))
	}
	return finishShard(symbolNamespace, record.Source, complete(), facts)
}

func (x *extractor) occurrenceShard(file *shimast.SourceFile, record sourceRecord) factShard {
	var facts []fact
	walkFile(file, func(node *shimast.Node) bool {
		kind, reference := occurrenceKind(node)
		if kind == "" {
			return true
		}
		span := x.span(file, node)
		occurrence := x.occurrenceID(span, kind)
		target := ""
		if reference != nil {
			target = x.resolveSymbol(reference)
		}
		payload := occurrenceFactPayload{Occurrence: occurrence, Kind: kind, Span: span, Target: target}
		facts = append(facts, x.newFact(
			occurrenceNamespace, kind, occurrence, payload, []sourceSpan{span}, complete(),
		))
		return true
	})
	return finishShard(occurrenceNamespace, record.Source, complete(), facts)
}

func (x *extractor) newFact(
	namespace, kind, subject string,
	payload any,
	evidence []sourceSpan,
	completion completeness,
) fact {
	if evidence == nil {
		evidence = []sourceSpan{}
	}
	pass := deriveID("pass", "astrale.analysis.typescript.native", map[string]any{
		"namespace": namespace, "version": passVersion,
	})
	id := deriveID("fact", namespace, map[string]any{
		"kind": kind, "subject": subject, "payload": payload, "evidence": evidence,
	})
	return fact{
		ID: id, Namespace: namespace, SchemaVersion: 1, Kind: kind, Subject: subject,
		Completeness: completion,
		Provenance:   provenance{Pass: pass, PassVersion: passVersion, Evidence: evidence, Inputs: []string{}},
		Payload:      payload,
	}
}

func finishShard(namespace, owner string, completion completeness, facts []fact) factShard {
	sort.Slice(facts, func(i, j int) bool { return facts[i].ID < facts[j].ID })
	shard := factShard{
		Key:       deriveID("fact-shard-key", namespace, map[string]any{"owner": owner}),
		Namespace: namespace, SchemaVersion: 1, Completion: completion, Facts: facts,
	}
	shard.Digest = shardDigest(shard)
	return shard
}

func (x *extractor) symbolID(symbol *shimast.Symbol) string {
	symbol = unalias(x.checker, symbol)
	if symbol == nil {
		return ""
	}
	if id := x.symbolIDs[symbol]; id != "" {
		return id
	}
	declaration := declarationNode(symbol)
	if declaration == nil {
		return ""
	}
	file := shimast.GetSourceFileOfNode(declaration)
	if file == nil {
		return ""
	}
	path, owned := x.ownedPath(file.FileName())
	name := stableSymbolName(symbol)
	if name == "" {
		name = "<anonymous>"
	}
	lexical := lexicalNames(declaration, symbol)
	identityKey := stableJSON(map[string]any{
		"name": name, "syntax": declaration.KindString(), "lexical": lexical,
	})
	generationScoped := name == "<anonymous>" || x.identityCollisions(file, identityKey) > 1
	input := map[string]any{
		"path": path, "name": name, "syntax": declaration.KindString(), "lexical": lexical,
	}
	if generationScoped {
		input["start"] = declaration.Pos()
		input["end"] = declaration.End()
		if record, ok := x.sources[file.FileName()]; ok {
			input["revision"] = record.Revision
		}
	}
	if !owned {
		input["external"] = true
	}
	id := deriveID("symbol", "typescript:"+x.universe, input)
	x.symbolIDs[symbol] = id
	if owned {
		spans := make([]sourceSpan, 0, len(symbol.Declarations))
		for _, candidate := range symbol.Declarations {
			candidateFile := shimast.GetSourceFileOfNode(candidate)
			if candidateFile != nil {
				if _, ok := x.sources[candidateFile.FileName()]; !ok {
					continue
				}
				spans = append(spans, x.span(candidateFile, candidate))
			}
		}
		sort.Slice(spans, func(i, j int) bool {
			if spans[i].Source == spans[j].Source {
				return spans[i].Start < spans[j].Start
			}
			return spans[i].Source < spans[j].Source
		})
		x.symbolSeen[id] = symbolFactPayload{
			Symbol: id, Name: name, Declarations: spans, GenerationScoped: generationScoped,
		}
	}
	return id
}

func (x *extractor) identityCollisions(file *shimast.SourceFile, identityKey string) int {
	count := 0
	seen := map[*shimast.Symbol]bool{}
	walkFile(file, func(node *shimast.Node) bool {
		symbol := unalias(x.checker, node.Symbol())
		if symbol == nil || seen[symbol] {
			return true
		}
		declaration := declarationNode(symbol)
		if declaration == nil || shimast.GetSourceFileOfNode(declaration) != file {
			return true
		}
		seen[symbol] = true
		name := stableSymbolName(symbol)
		if name == "" {
			name = "<anonymous>"
		}
		candidate := stableJSON(map[string]any{
			"name": name, "syntax": declaration.KindString(),
			"lexical": lexicalNames(declaration, symbol),
		})
		if candidate == identityKey {
			count++
		}
		return true
	})
	return count
}

func lexicalNames(declaration *shimast.Node, own *shimast.Symbol) []string {
	values := []string{}
	seen := map[*shimast.Symbol]bool{own: true}
	for parent := declaration.Parent; parent != nil; parent = parent.Parent {
		// Source-file module symbols are named with the compiler host's absolute
		// path. The portable source path is already an explicit symbol-identity
		// input, so retaining that implementation detail would rename every
		// declaration when an identical project moves to another checkout.
		if parent.Kind == shimast.KindSourceFile {
			break
		}
		symbol := parent.Symbol()
		if symbol == nil || seen[symbol] {
			continue
		}
		name := stableSymbolName(symbol)
		if name == "" {
			continue
		}
		seen[symbol] = true
		values = append(values, name)
	}
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
	return values
}

// TypeScript-Go encodes ECMAScript private names with a process-local numeric
// prefix in Symbol.Name. That checker implementation detail changes between a
// cold program and an incrementally rebuilt program, so it must never enter a
// portable identity or payload. The authored private identifier is stable and
// remains unambiguous when combined with the lexical owner chain.
func stableSymbolName(symbol *shimast.Symbol) string {
	if symbol == nil {
		return ""
	}
	declaration := declarationNode(symbol)
	if declaration != nil && declaration.Name() != nil && declaration.Name().Kind == shimast.KindPrivateIdentifier {
		if name := nodeText(shimast.GetSourceFileOfNode(declaration), declaration.Name()); name != "" {
			return name
		}
	}
	return symbol.Name
}

func (x *extractor) resolveSymbol(node *shimast.Node) string {
	if node == nil {
		return ""
	}
	return x.symbolID(x.checker.GetSymbolAtLocation(node))
}

func (x *extractor) occurrenceID(span sourceSpan, kind string) string {
	return deriveID("occurrence", "typescript:"+x.universe, map[string]any{
		"source": span.Source, "revision": span.Revision,
		"start": span.Start, "end": span.End, "kind": kind,
	})
}

func (x *extractor) span(file *shimast.SourceFile, node *shimast.Node) sourceSpan {
	record := x.sources[file.FileName()]
	start := shimscanner.SkipTrivia(file.Text(), node.Pos())
	end := node.End()
	if end <= start {
		end = start + 1
	}
	return sourceSpan{Source: record.Source, Revision: record.Revision, Start: start, End: end}
}

func (x *extractor) ownedPath(path string) (string, bool) {
	relative, err := filepath.Rel(x.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "external:" + filepath.Base(path), false
	}
	relative = filepath.ToSlash(relative)
	return relative, !strings.Contains(relative, "/node_modules/") && !strings.HasSuffix(relative, ".d.ts")
}

func occurrenceKind(node *shimast.Node) (string, *shimast.Node) {
	switch node.Kind {
	case shimast.KindImportDeclaration, shimast.KindImportEqualsDeclaration, shimast.KindImportSpecifier:
		return "import", node
	case shimast.KindExportDeclaration, shimast.KindExportAssignment, shimast.KindExportSpecifier:
		return "export", node
	case shimast.KindCallExpression:
		if call := node.AsCallExpression(); call != nil {
			return "call", call.Expression
		}
	case shimast.KindNewExpression:
		if call := node.AsNewExpression(); call != nil {
			return "construction", call.Expression
		}
	case shimast.KindJsxOpeningElement:
		if jsx := node.AsJsxOpeningElement(); jsx != nil {
			return "render", jsx.TagName
		}
	case shimast.KindJsxSelfClosingElement:
		if jsx := node.AsJsxSelfClosingElement(); jsx != nil {
			return "render", jsx.TagName
		}
	case shimast.KindPropertyAccessExpression, shimast.KindElementAccessExpression:
		return "access", node
	}
	return "", nil
}

func unalias(checker *shimchecker.Checker, symbol *shimast.Symbol) *shimast.Symbol {
	if symbol != nil && symbol.Flags&shimast.SymbolFlagsAlias != 0 {
		if aliased := shimchecker.Checker_getAliasedSymbol(checker, symbol); aliased != nil {
			return aliased
		}
	}
	return symbol
}

func declarationNode(symbol *shimast.Symbol) *shimast.Node {
	if symbol == nil {
		return nil
	}
	for _, declaration := range symbol.Declarations {
		if file := shimast.GetSourceFileOfNode(declaration); file != nil && !file.IsDeclarationFile && declaration.Body() != nil {
			return declaration
		}
	}
	for _, declaration := range symbol.Declarations {
		if file := shimast.GetSourceFileOfNode(declaration); file != nil && !file.IsDeclarationFile {
			return declaration
		}
	}
	if len(symbol.Declarations) != 0 {
		return symbol.Declarations[0]
	}
	return nil
}

func complete() completeness { return completeness{Kind: "complete"} }

func partial(code, message string, effective map[string]any) completeness {
	return completeness{Kind: "partial", Reasons: []any{map[string]any{
		"code": code, "message": message, "effective": effective,
	}}}
}

func walkFile(file *shimast.SourceFile, visit func(*shimast.Node) bool) {
	if file == nil || file.Statements == nil {
		return
	}
	for _, statement := range file.Statements.Nodes {
		walk(statement, visit)
	}
}

func walk(node *shimast.Node, visit func(*shimast.Node) bool) {
	if node == nil || !visit(node) {
		return
	}
	node.ForEachChild(func(child *shimast.Node) bool {
		walk(child, visit)
		return false
	})
}

func nodeText(file *shimast.SourceFile, node *shimast.Node) string {
	if file == nil || node == nil {
		return ""
	}
	text := file.Text()
	start := shimscanner.SkipTrivia(text, node.Pos())
	end := node.End()
	if start < 0 || end > len(text) || start >= end {
		return ""
	}
	return strings.TrimSpace(text[start:end])
}

func extractionError(format string, arguments ...any) error {
	return fmt.Errorf("native TypeScript extraction: "+format, arguments...)
}
