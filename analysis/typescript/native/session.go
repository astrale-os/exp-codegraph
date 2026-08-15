package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	shimcompiler "github.com/microsoft/typescript-go/shim/compiler"
	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimtsoptions "github.com/microsoft/typescript-go/shim/tsoptions"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

type generationState struct {
	generation     analysisGeneration
	manifest       []factShardReference
	digests        map[string]string
	sources        map[string]sourceRecord
	sourceShards   map[string][]string
	sourceManifest string
}

type refreshSelection struct {
	full  bool
	files []string
}

type pendingGeneration struct {
	state       generationState
	transaction *factTransaction
	universe    string
	rollover    bool
}

type analyzer struct {
	root                        string
	config                      string
	universe                    string
	capabilities                []string
	modules                     []moduleBoundary
	payloadCodecs               map[string]bool
	maximumSemanticPayloadBytes int
	session                     *driver.Session
	states                      map[string]generationState
	current                     string
	pendingFull                 bool
	pending                     *pendingGeneration
	telemetry                   *nativeTelemetry
}

func newAnalyzer(root, config, universe string, capabilities []string, modules []moduleBoundary, payloadCodecs map[string]bool, maximumSemanticPayloadBytes int, telemetry *nativeTelemetry) (*analyzer, error) {
	started := time.Now()
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	root = filepath.Clean(abs)
	if canonical, canonicalErr := filepath.EvalSymlinks(root); canonicalErr == nil {
		root = canonical
	}
	capabilities, err = admitCapabilities(capabilities)
	if err != nil {
		return nil, err
	}
	session, diagnostics, err := driver.NewSession(root, config, driver.LoadProgramOptions{ForceNoEmit: true})
	telemetry.record(0, "compiler.open", started, map[string]any{"configurationDiagnostics": len(diagnostics)})
	if err != nil {
		return nil, err
	}
	if len(diagnostics) != 0 {
		if session != nil {
			_ = session.Close()
		}
		return nil, fmt.Errorf("TypeScript project configuration has %d diagnostics: %s", len(diagnostics), diagnostics[0].String())
	}
	if session == nil {
		return nil, fmt.Errorf("TypeScript driver returned no resident program")
	}
	return &analyzer{
		root: root, config: config, universe: universe, capabilities: capabilities, modules: modules,
		payloadCodecs:               payloadCodecs,
		maximumSemanticPayloadBytes: maximumSemanticPayloadBytes,
		session:                     session, states: map[string]generationState{}, telemetry: telemetry,
	}, nil
}

func (a *analyzer) close() error {
	if a.session == nil {
		return nil
	}
	err := a.session.Close()
	a.session = nil
	return err
}

func (a *analyzer) refresh(input request) (transaction *factTransaction, unchanged string, err error) {
	started := time.Now()
	var before runtime.MemStats
	if a.telemetry != nil {
		runtime.ReadMemStats(&before)
	}
	defer func() {
		metrics := map[string]any{
			"changedPaths": len(input.Changed), "invalidate": input.Invalidate,
			"outcome": map[bool]string{true: "error", false: "success"}[err != nil],
		}
		if a.telemetry != nil {
			var after runtime.MemStats
			runtime.ReadMemStats(&after)
			metrics["totalAllocatedBytes"] = after.TotalAlloc - before.TotalAlloc
			metrics["allocations"] = after.Mallocs - before.Mallocs
			metrics["heapBytes"] = after.HeapAlloc
			metrics["systemBytes"] = after.Sys
		}
		a.telemetry.record(input.ID, "refresh.total", started, metrics)
	}()
	if a.pending != nil {
		if input.Base != a.current || input.Invalidate || len(input.Changed) != 0 {
			return nil, "", protocolError("COMMIT_PENDING", "A native generation is awaiting application-store acknowledgement.")
		}
		return a.pending.transaction, "", nil
	}
	adopting := a.current == "" && input.Base != ""
	if input.Base != a.current && !adopting {
		return nil, "", protocolError("BASE_STALE", "The requested base is not the resident analyzer's current private generation.")
	}
	// Callers own change discovery. Once a resident base exists, an empty
	// change set is a true no-op and must not re-walk or re-extract the complete
	// compiler universe merely to rediscover the same content-addressed shards.
	if input.Base != "" && !adopting && !input.Invalidate && len(input.Changed) == 0 && !a.pendingFull {
		return nil, input.Base, nil
	}
	compilerAdvanced := false
	defer func() {
		if err != nil && compilerAdvanced {
			// Session.Apply has already advanced the resident compiler. A retry
			// must rebuild a complete candidate instead of comparing against the
			// unpublished compiler state as though it were the committed base.
			a.pendingFull = true
		}
	}()
	selection := refreshSelection{full: input.Base == "" || adopting || a.pendingFull}
	updateStarted := time.Now()
	if input.Invalidate || a.pendingFull {
		if err := a.rebuild(); err != nil {
			return nil, "", err
		}
		compilerAdvanced = true
		selection.full = true
		a.telemetry.record(input.ID, "compiler.update", updateStarted, map[string]any{"mode": "rebuild"})
	} else {
		selection, err = a.apply(input.Changed)
		if err != nil {
			return nil, "", err
		}
		compilerAdvanced = len(input.Changed) != 0
		mode := "resident-apply"
		if selection.full {
			mode = "resident-full"
		}
		a.telemetry.record(input.ID, "compiler.update", updateStarted, map[string]any{"mode": mode})
	}

	universeStarted := time.Now()
	nextUniverse, configuration, err := a.projectUniverse()
	a.telemetry.record(input.ID, "universe.project", universeStarted, map[string]any{"configurationFiles": len(configuration)})
	if err != nil {
		return nil, "", err
	}
	rollover := nextUniverse != a.universe
	if rollover {
		// A universe boundary is not an incremental source delta. The first
		// generation in the new lineage is a complete transaction with no base;
		// the caller may rebase that complete snapshot when an identical portable
		// universe was materialized during an earlier configuration cycle.
		selection.full = true
	}
	baseID := input.Base
	if rollover {
		baseID = ""
	}
	base, hasBase := a.states[baseID]
	if !hasBase {
		selection.full = true
	}

	extractionStarted := time.Now()
	shards, sources, replaced, err := a.extract(nextUniverse, selection, base, input.ID)
	a.telemetry.record(input.ID, "projection.total", extractionStarted, map[string]any{
		"shards": len(shards), "sources": len(sources), "full": selection.full,
	})
	if err != nil {
		return nil, "", err
	}
	wanted := make(map[string]bool, len(a.capabilities))
	for _, capability := range a.capabilities {
		wanted[capability] = true
	}
	selected := shards[:0]
	for _, shard := range shards {
		if wanted[shard.Namespace] {
			selected = append(selected, shard)
		}
	}
	shards = selected
	if a.telemetry != nil {
		recordFactBytes(a.telemetry, input.ID, shards)
	}

	materializationStarted := time.Now()
	sourceEntries := make([]map[string]any, 0, len(sources))
	for _, source := range sources {
		sourceEntries = append(sourceEntries, map[string]any{"path": source.Path, "revision": source.Revision})
	}
	sourceManifest := deriveID("source-manifest", "typescript:"+nextUniverse, map[string]any{
		"configuration": configuration,
		"sources":       sourceEntries,
	})
	manifestByKey := make(map[string]factShardReference, len(base.manifest)+len(shards))
	if hasBase && !selection.full {
		for _, reference := range base.manifest {
			if !replaced[reference.Key] {
				manifestByKey[reference.Key] = reference
			}
		}
	}
	for _, shard := range shards {
		manifestByKey[shard.Key] = factShardReference{
			Key: shard.Key, Digest: shard.Digest, Namespace: shard.Namespace,
			SchemaVersion: shard.SchemaVersion, Facts: len(shard.Facts),
		}
	}
	manifest := make([]factShardReference, 0, len(manifestByKey))
	digests := make(map[string]string, len(manifestByKey))
	for _, reference := range manifestByKey {
		manifest = append(manifest, reference)
		digests[reference.Key] = reference.Digest
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].Key < manifest[j].Key })
	if hasBase && base.sourceManifest == sourceManifest && stableJSON(base.manifest) == stableJSON(manifest) {
		return nil, input.Base, nil
	}

	producer := producerIdentity{
		ID: deriveID("producer", "astrale.analysis.typescript.native", map[string]any{
			"name": "ttsc-typescript-go", "version": producerVersion,
			"protocolVersion": protocolVersion,
		}),
		Name: "ttsc-typescript-go", Version: producerVersion, ProtocolVersion: protocolVersion,
	}
	sequence := 1
	if hasBase {
		sequence = base.generation.Sequence + 1
	}
	generationID := deriveID("generation", "astrale.analysis.generation.v1", map[string]any{
		"universe": nextUniverse, "producer": producer, "sourceManifest": sourceManifest,
		"capabilities": a.capabilities, "manifest": manifest,
	})
	generation := analysisGeneration{
		ID: generationID, Sequence: sequence, Universe: nextUniverse, Producer: producer,
		SourceManifest: sourceManifest, Capabilities: a.capabilities,
	}
	upserts := make([]factShard, 0, len(shards))
	for _, shard := range shards {
		if hasBase && base.digests[shard.Key] == shard.Digest {
			continue
		}
		for index := range shard.Facts {
			shard.Facts[index].Generation = generationID
		}
		upserts = append(upserts, shard)
	}
	deletes := []string{}
	if hasBase {
		for key := range base.digests {
			if _, exists := digests[key]; !exists {
				deletes = append(deletes, key)
			}
		}
	}
	sort.Slice(upserts, func(i, j int) bool { return upserts[i].Key < upserts[j].Key })
	sort.Strings(deletes)
	transaction = &factTransaction{
		ProtocolVersion: protocolVersion, Base: baseID, Next: generation,
		Manifest: manifest, Upserts: upserts, Deletes: deletes,
	}
	state := generationState{
		generation: generation, manifest: manifest, digests: digests,
		sources: sourceRecordMap(sources), sourceShards: mergeSourceShardOwnership(base, sources, shards, selection.full),
		sourceManifest: sourceManifest,
	}
	if adopting && generationID == input.Base {
		state.generation.Sequence = input.BaseSequence
		a.install(state, nextUniverse, rollover)
		return nil, input.Base, nil
	}
	a.pending = &pendingGeneration{
		state: state, transaction: transaction, universe: nextUniverse, rollover: rollover,
	}
	a.telemetry.record(input.ID, "transaction.materialize", materializationStarted, map[string]any{
		"manifestShards": len(manifest), "upsertShards": len(upserts), "deleteShards": len(deletes),
	})
	return transaction, "", nil
}

func (a *analyzer) acknowledge(input request) error {
	if input.Generation == a.current && a.pending == nil {
		return nil
	}
	if a.pending == nil {
		return protocolError("ACK_UNEXPECTED", "No native generation is awaiting acknowledgement.")
	}
	if input.Generation != a.pending.state.generation.ID {
		return protocolError("ACK_GENERATION_MISMATCH", "The acknowledged generation is not the pending native generation.")
	}
	if input.Sequence < 1 {
		return protocolError("ACK_SEQUENCE_INVALID", "The acknowledged generation sequence must be positive.")
	}
	pending := a.pending
	pending.state.generation.Sequence = input.Sequence
	a.install(pending.state, pending.universe, pending.rollover)
	return nil
}

func (a *analyzer) install(state generationState, universe string, rollover bool) {
	if rollover || universe != a.universe {
		a.states = map[string]generationState{}
	}
	a.universe = universe
	a.states[state.generation.ID] = state
	a.current = state.generation.ID
	a.pending = nil
	a.pendingFull = false
	a.collectStates()
}

// extract produces a complete snapshot for uncertain changes and only
// replacement shards for compiler-proven private edits. Module facts remain a
// conservative global projection until their surface/dependency/diagnostic
// pieces are physically split; rebuilding them is cheap relative to body
// extraction and preserves cold equivalence without repository exceptions.
func (a *analyzer) extract(
	universe string,
	selection refreshSelection,
	base generationState,
	requestID int,
) ([]factShard, []sourceRecord, map[string]bool, error) {
	if selection.full {
		shards, sources, err := extractProgram(a.root, universe, a.session.Program(), a.modules, a.payloadCodecs, a.maximumSemanticPayloadBytes, a.telemetry, requestID)
		return shards, sources, nil, err
	}
	selected := make(map[string]bool, len(selection.files))
	for _, file := range selection.files {
		selected[file] = true
	}
	x, files, sources := prepareExtractor(
		a.root, universe, a.session.Program(), a.modules,
		a.payloadCodecs,
		a.maximumSemanticPayloadBytes,
		base.sources, selected, a.telemetry, requestID,
	)
	replaced := map[string]bool{}
	for _, reference := range base.manifest {
		switch reference.Namespace {
		case projectNamespace, diagnosticNamespace, moduleNamespace:
			replaced[reference.Key] = true
		}
	}
	for file := range selected {
		record, exists := x.sources[file]
		if !exists {
			return nil, nil, nil, fmt.Errorf("selected TypeScript source disappeared from the owned projection: %s", file)
		}
		for _, key := range base.sourceShards[record.Source] {
			replaced[key] = true
		}
	}
	phase := time.Now()
	shards := []factShard{x.projectShard(a.session.Program())}
	a.telemetry.record(requestID, "projection.project", phase, nil)
	phase = time.Now()
	diagnostic := x.diagnosticShard(a.session.Program())
	shards = append(shards, diagnostic)
	a.telemetry.record(requestID, "projection.diagnostics", phase, map[string]any{"facts": len(diagnostic.Facts)})
	phase = time.Now()
	modules, err := x.moduleShards(a.session.Program())
	if err != nil {
		return nil, nil, nil, err
	}
	shards = append(shards, modules...)
	a.telemetry.record(requestID, "projection.modules", phase, map[string]any{"shards": len(modules)})
	sourceShards, err := x.sourceShards(files, selected, a.telemetry, requestID)
	if err != nil {
		return nil, nil, nil, err
	}
	shards = append(shards, sourceShards...)
	a.telemetry.record(requestID, "facts.semantic-payloads", time.Now(), map[string]any{
		"bytes": x.semanticPayloadBytes,
	})
	if x.payloadEncodingError != nil {
		return nil, nil, nil, x.payloadEncodingError
	}
	sort.Slice(shards, func(i, j int) bool { return shards[i].Key < shards[j].Key })
	return shards, sources, replaced, nil
}

func sourceRecordMap(records []sourceRecord) map[string]sourceRecord {
	result := make(map[string]sourceRecord, len(records))
	for _, record := range records {
		result[record.Physical] = record
	}
	return result
}

func mergeSourceShardOwnership(
	base generationState,
	sources []sourceRecord,
	shards []factShard,
	full bool,
) map[string][]string {
	owners := map[string][]string{}
	if !full {
		for source, keys := range base.sourceShards {
			owners[source] = append([]string{}, keys...)
		}
	}
	known := make(map[string]bool, len(sources))
	for _, source := range sources {
		known[source.Source] = true
	}
	replacedOwners := map[string]bool{}
	for _, shard := range shards {
		if source := shardSourceOwner(shard); source != "" && known[source] {
			replacedOwners[source] = true
		}
	}
	for source := range replacedOwners {
		delete(owners, source)
	}
	for _, shard := range shards {
		if source := shardSourceOwner(shard); source != "" && known[source] {
			owners[source] = append(owners[source], shard.Key)
		}
	}
	for source := range owners {
		owners[source] = sortedUnique(owners[source])
	}
	return owners
}

func shardSourceOwner(shard factShard) string {
	if len(shard.Facts) == 0 {
		return ""
	}
	if shard.Namespace == sourceNamespace {
		return shard.Facts[0].Subject
	}
	if shard.Namespace != symbolNamespace && shard.Namespace != occurrenceNamespace && shard.Namespace != bodyNamespace {
		return ""
	}
	for _, entry := range shard.Facts {
		if len(entry.Provenance.Evidence) != 0 {
			return entry.Provenance.Evidence[0].Source
		}
	}
	return ""
}

func recordFactBytes(telemetry *nativeTelemetry, requestID int, shards []factShard) {
	started := time.Now()
	bytesByNamespace := map[string]int{}
	factsByNamespace := map[string]int{}
	bodyPhysicalFieldBytes := map[string]int{}
	for _, shard := range shards {
		for _, fact := range shard.Facts {
			bytesByNamespace[fact.Namespace] += len(stableJSON(fact))
			factsByNamespace[fact.Namespace]++
			if fact.Namespace == bodyNamespace && fact.PhysicalPayload != nil {
				addPackedBodyFieldBytes(bodyPhysicalFieldBytes, fact.PhysicalPayload)
			}
		}
	}
	telemetry.record(requestID, "facts.measure", started, map[string]any{
		"namespaces": len(bytesByNamespace),
	})
	for namespace, bytes := range bytesByNamespace {
		telemetry.record(requestID, "facts.namespace", time.Now(), map[string]any{
			"namespace": namespace, "facts": factsByNamespace[namespace], "physicalJsonBytes": bytes,
		})
	}
	fields := make([]string, 0, len(bodyPhysicalFieldBytes))
	for field := range bodyPhysicalFieldBytes {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	for _, field := range fields {
		telemetry.record(requestID, "facts.body-physical-field", time.Now(), map[string]any{
			"field": field, "bytes": bodyPhysicalFieldBytes[field],
		})
	}
}

func addPackedBodyFieldBytes(
	values map[string]int,
	payload *physicalPayloadEnvelope,
) {
	packed, ok := payload.Data.(packedBodyData)
	if !ok {
		return
	}
	fields := []struct {
		name  string
		value any
	}{
		{"constants", packed.Constants},
		{"symbols", packed.Symbols},
		{"texts", packed.Texts},
		{"parameters", packed.Parameters},
		{"occurrences", packed.Occurrences},
		{"relations", packed.Relations},
		{"blocks", packed.Blocks},
		{"edges", packed.Edges},
		{"definitions", packed.Definitions},
		{"calls", packed.Calls},
		{"summary", packed.Summary},
		{"values", packed.Values},
		{"completeness", packed.Completeness},
	}
	for _, field := range fields {
		values[field.name] += len(stableJSON(field.value))
	}
	values["envelope"] += len(stableJSON(payload))
}

func (a *analyzer) projectUniverse() (string, []map[string]any, error) {
	configs, err := parsedProjectConfigs(a.session.Program())
	if err != nil {
		return "", nil, err
	}
	configuration, err := a.configurationManifest(configs)
	if err != nil {
		return "", nil, err
	}
	roots := make([]map[string]any, 0)
	for _, parsed := range configs {
		config, err := a.portableUniversePath(parsed.ConfigName())
		if err != nil {
			return "", nil, err
		}
		for _, path := range parsed.FileNames() {
			file, err := a.portableUniversePath(path)
			if err != nil {
				return "", nil, err
			}
			roots = append(roots, map[string]any{"config": config, "file": file})
		}
	}
	sort.Slice(roots, func(i, j int) bool {
		left := roots[i]["config"].(string) + "\x00" + roots[i]["file"].(string)
		right := roots[j]["config"].(string) + "\x00" + roots[j]["file"].(string)
		return left < right
	})
	universe := deriveID("project-universe", "astrale.analysis.typescript.universe.v1", map[string]any{
		"configuration": configuration,
		"roots":         roots,
		"modules":       a.modules,
		"capabilities":  a.capabilities,
		"producer": map[string]any{
			"name": "ttsc-typescript-go", "version": producerVersion,
			"ttsc": ttscVersion, "typescriptGo": shimcore.Version(), "protocol": protocolVersion,
		},
		"platform": map[string]any{"os": runtime.GOOS, "architecture": runtime.GOARCH},
	})
	return universe, configuration, nil
}

func (a *analyzer) configurationManifest(configs []*shimtsoptions.ParsedCommandLine) ([]map[string]any, error) {
	paths := []string{}
	for _, parsed := range configs {
		paths = append(paths, parsed.ConfigName())
		paths = append(paths, parsed.ExtendedSourceFiles()...)
	}
	paths = sortedUnique(paths)
	configuration := make([]map[string]any, 0, len(paths))
	for _, path := range paths {
		if path == "" {
			continue
		}
		metadata, err := os.Stat(path)
		if err == nil && metadata.IsDir() {
			path = filepath.Join(path, "tsconfig.json")
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read TypeScript configuration %s: %w", path, err)
		}
		logical, err := a.portableUniversePath(path)
		if err != nil {
			return nil, err
		}
		configuration = append(configuration, map[string]any{
			"path":   logical,
			"digest": hashText(string(content)),
		})
	}
	sort.Slice(configuration, func(i, j int) bool {
		return configuration[i]["path"].(string) < configuration[j]["path"].(string)
	})
	return configuration, nil
}

func (a *analyzer) portableUniversePath(path string) (string, error) {
	path = filepath.Clean(path)
	if filename := typescriptLibraryFile(path); filename != "" {
		return "platform:typescript/" + filename, nil
	}
	relative, err := filepath.Rel(a.root, path)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		logical := filepath.ToSlash(relative)
		if !strings.Contains(logical, "/node_modules/") && !strings.HasPrefix(logical, "node_modules/") {
			if logical == "" {
				return ".", nil
			}
			return logical, nil
		}
	}
	if coordinate := workspacePackageCoordinate(a.root, path); coordinate != "" {
		return coordinate, nil
	}
	return "", fmt.Errorf("TypeScript universe input has no portable repository, package, or platform identity: %s", path)
}

// parsedProjectConfigs follows the same public driver seams used by ttscgraph:
// the resident root config, already-resolved project references, and a
// ParseTSConfig fallback for references not retained by the Program.
func parsedProjectConfigs(program *driver.Program) ([]*shimtsoptions.ParsedCommandLine, error) {
	if program == nil || program.ParsedConfig == nil {
		return nil, fmt.Errorf("TypeScript resident program omitted its parsed configuration")
	}
	resolved := map[string]*shimtsoptions.ParsedCommandLine{}
	for _, parsed := range program.TSProgram.GetResolvedProjectReferences() {
		if parsed != nil {
			resolved[filepath.Clean(parsed.ConfigName())] = parsed
		}
	}
	configs := []*shimtsoptions.ParsedCommandLine{}
	pending := []*shimtsoptions.ParsedCommandLine{program.ParsedConfig}
	seen := map[string]bool{}
	for len(pending) != 0 {
		parsed := pending[0]
		pending = pending[1:]
		config := filepath.Clean(parsed.ConfigName())
		if seen[config] {
			continue
		}
		seen[config] = true
		configs = append(configs, parsed)
		for _, reference := range parsed.ResolvedProjectReferencePaths() {
			reference = filepath.Clean(reference)
			child := resolved[reference]
			if child == nil {
				cwd := filepath.Dir(reference)
				var diagnostics []driver.Diagnostic
				var err error
				child, diagnostics, err = driver.ParseTSConfig(program.FS, cwd, reference, driver.DefaultHost(cwd, program.FS), nil)
				if err != nil {
					return nil, err
				}
				if child == nil {
					if len(diagnostics) == 0 {
						return nil, fmt.Errorf("TypeScript project reference was not parsed: %s", reference)
					}
					return nil, fmt.Errorf("TypeScript project reference is invalid: %s", diagnostics[0].String())
				}
				resolved[reference] = child
			}
			pending = append(pending, child)
		}
	}
	sort.Slice(configs, func(i, j int) bool { return configs[i].ConfigName() < configs[j].ConfigName() })
	return configs, nil
}

func (a *analyzer) apply(changed []string) (refreshSelection, error) {
	paths := sortedUnique(append([]string{}, changed...))
	if len(paths) == 0 {
		return refreshSelection{}, nil
	}
	if a.session.Program().HasLinkedProgramPlugins() {
		if err := a.rebuild(); err != nil {
			return refreshSelection{}, err
		}
		return refreshSelection{full: true}, nil
	}
	absolutePaths := make([]string, 0, len(paths))
	oldShapes := make(map[string]string, len(paths))
	full := false
	for _, path := range paths {
		absolute, err := a.absoluteChangedPath(path)
		if err != nil {
			return refreshSelection{}, err
		}
		if _, resident := a.session.SourceText(absolute); !resident {
			// New roots, deletions/renames, tsconfig changes, and files newly
			// admitted by an include glob require the compiler to rediscover the
			// project root set rather than applying a single-file overlay.
			if err := a.rebuild(); err != nil {
				return refreshSelection{}, err
			}
			return refreshSelection{full: true}, nil
		}
		source := a.session.Program().SourceFile(absolute)
		if source == nil || source.IsDeclarationFile || shimcompiler.FileAffectsGlobalScope(source) {
			full = true
		} else {
			shape, err := a.session.Program().DeclarationShapeDigest(source)
			if err != nil {
				return refreshSelection{}, err
			}
			oldShapes[absolute] = shape
		}
		absolutePaths = append(absolutePaths, absolute)
	}
	selected := make([]string, 0, len(absolutePaths))
	public := []string{}
	for _, absolute := range absolutePaths {
		content, err := os.ReadFile(absolute)
		if err != nil {
			if os.IsNotExist(err) {
				if err := a.rebuild(); err != nil {
					return refreshSelection{}, err
				}
				return refreshSelection{full: true}, nil
			}
			return refreshSelection{}, err
		}
		if reused := a.session.Apply(absolute, string(content)); !reused {
			full = true
		}
		updated := a.session.Program().SourceFile(absolute)
		if updated == nil {
			full = true
			continue
		}
		selected = append(selected, updated.FileName())
	}
	if full {
		return refreshSelection{full: true}, nil
	}
	for _, absolute := range absolutePaths {
		updated := a.session.Program().SourceFile(absolute)
		if updated == nil || updated.IsDeclarationFile || shimcompiler.FileAffectsGlobalScope(updated) {
			return refreshSelection{full: true}, nil
		}
		shape, err := a.session.Program().DeclarationShapeDigest(updated)
		if err != nil {
			return refreshSelection{}, err
		}
		if shape != oldShapes[absolute] {
			public = append(public, updated.FileName())
		}
	}
	if len(public) != 0 {
		selected = affectedSourceClosure(a.session.Program(), selected, public)
	}
	return refreshSelection{files: sortedUnique(selected)}, nil
}

// affectedSourceClosure expands declaration-shape changes through the exact
// reverse dependency graph retained by TypeScript. Private implementation
// edits therefore select one source, while public changes reproject every
// transitive consumer without falling back to a repository-wide walk.
func affectedSourceClosure(program *driver.Program, changed, public []string) []string {
	reverse := map[string][]string{}
	physicalByCanonical := map[string]string{}
	for _, source := range program.SourceFiles() {
		physicalByCanonical[string(source.Path())] = filepath.Clean(source.FileName())
	}
	for _, source := range program.SourceFiles() {
		owner := filepath.Clean(source.FileName())
		for _, referenced := range shimcompiler.GetReferencedFilePaths(program.TSProgram, source) {
			if target := physicalByCanonical[referenced]; target != "" {
				reverse[target] = append(reverse[target], owner)
			}
		}
	}
	selected := map[string]bool{}
	for _, path := range changed {
		selected[filepath.Clean(path)] = true
	}
	queue := sortedUnique(append([]string{}, public...))
	for len(queue) != 0 {
		path := filepath.Clean(queue[0])
		queue = queue[1:]
		if !selected[path] {
			selected[path] = true
		}
		for _, dependent := range reverse[path] {
			if !selected[dependent] {
				selected[dependent] = true
				queue = append(queue, dependent)
			}
		}
	}
	result := make([]string, 0, len(selected))
	for path := range selected {
		result = append(result, path)
	}
	sort.Strings(result)
	return result
}

func (a *analyzer) absoluteChangedPath(path string) (string, error) {
	if strings.IndexByte(path, 0) >= 0 {
		return "", protocolError("PATH_INVALID", "A changed path contains NUL.")
	}
	absolute := path
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(a.root, filepath.FromSlash(path))
	}
	absolute = filepath.Clean(absolute)
	relative, err := filepath.Rel(a.root, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", protocolError("PATH_OUTSIDE_ROOT", "A changed path escapes the project root.")
	}
	return absolute, nil
}

func (a *analyzer) rebuild() error {
	next, diagnostics, err := driver.NewSession(a.root, a.config, driver.LoadProgramOptions{ForceNoEmit: true})
	if err != nil {
		return err
	}
	if len(diagnostics) != 0 {
		if next != nil {
			_ = next.Close()
		}
		return fmt.Errorf("TypeScript project configuration has %d diagnostics: %s", len(diagnostics), diagnostics[0].String())
	}
	if next == nil {
		return fmt.Errorf("TypeScript driver returned no resident program")
	}
	previous := a.session
	a.session = next
	return previous.Close()
}

func (a *analyzer) collectStates() {
	if len(a.states) <= 16 {
		return
	}
	type candidate struct {
		id       string
		sequence int
	}
	values := make([]candidate, 0, len(a.states))
	for id, state := range a.states {
		if id != a.current {
			values = append(values, candidate{id: id, sequence: state.generation.Sequence})
		}
	}
	sort.Slice(values, func(i, j int) bool { return values[i].sequence < values[j].sequence })
	for len(a.states) > 16 && len(values) != 0 {
		delete(a.states, values[0].id)
		values = values[1:]
	}
}

func admitCapabilities(requested []string) ([]string, error) {
	if len(requested) == 0 {
		return append([]string{}, supportedCapabilities...), nil
	}
	supported := map[string]bool{}
	for _, capability := range supportedCapabilities {
		supported[capability] = true
	}
	for _, capability := range requested {
		if !supported[capability] {
			return nil, protocolError("CAPABILITY_UNSUPPORTED", fmt.Sprintf("Native capability %q is unsupported.", capability))
		}
	}
	return sortedUnique(append([]string{}, requested...)), nil
}

type nativeError struct{ code, message string }

func (e nativeError) Error() string            { return e.message }
func protocolError(code, message string) error { return nativeError{code: code, message: message} }
