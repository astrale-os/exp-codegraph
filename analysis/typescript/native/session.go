package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	shimcore "github.com/microsoft/typescript-go/shim/core"
	shimtsoptions "github.com/microsoft/typescript-go/shim/tsoptions"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

type generationState struct {
	generation     analysisGeneration
	manifest       []factShardReference
	digests        map[string]string
	sourceManifest string
}

type analyzer struct {
	root         string
	config       string
	universe     string
	capabilities []string
	modules      []moduleBoundary
	session      *driver.Session
	states       map[string]generationState
	current      string
}

func newAnalyzer(root, config, universe string, capabilities []string, modules []moduleBoundary) (*analyzer, error) {
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
		session: session, states: map[string]generationState{},
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

func (a *analyzer) refresh(input request) (*factTransaction, string, error) {
	if input.Base != a.current {
		return nil, "", protocolError("BASE_STALE", "The requested base is not the resident analyzer's current private generation.")
	}
	if input.Invalidate {
		if err := a.rebuild(); err != nil {
			return nil, "", err
		}
	} else if err := a.apply(input.Changed); err != nil {
		return nil, "", err
	}

	nextUniverse, configuration, err := a.projectUniverse()
	if err != nil {
		return nil, "", err
	}
	rollover := nextUniverse != a.universe
	if rollover {
		// A universe boundary is not an incremental source delta. The first
		// generation in the new lineage is a complete transaction with no base;
		// the caller may rebase that complete snapshot when an identical portable
		// universe was materialized during an earlier configuration cycle.
		a.universe = nextUniverse
		a.states = map[string]generationState{}
		a.current = ""
	}

	shards, sources, err := extractProgram(a.root, a.universe, a.session.Program(), a.modules)
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

	sourceEntries := make([]map[string]any, 0, len(sources))
	for _, source := range sources {
		sourceEntries = append(sourceEntries, map[string]any{"path": source.Path, "revision": source.Revision})
	}
	sourceManifest := deriveID("source-manifest", "typescript:"+a.universe, map[string]any{
		"configuration": configuration,
		"sources":       sourceEntries,
	})
	manifest := make([]factShardReference, 0, len(shards))
	digests := make(map[string]string, len(shards))
	for _, shard := range shards {
		manifest = append(manifest, factShardReference{
			Key: shard.Key, Digest: shard.Digest, Namespace: shard.Namespace,
			SchemaVersion: shard.SchemaVersion, Facts: len(shard.Facts),
		})
		digests[shard.Key] = shard.Digest
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].Key < manifest[j].Key })
	baseID := input.Base
	if rollover {
		baseID = ""
	}
	base, hasBase := a.states[baseID]
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
		"universe": a.universe, "producer": producer, "sourceManifest": sourceManifest,
		"capabilities": a.capabilities, "manifest": manifest,
	})
	generation := analysisGeneration{
		ID: generationID, Sequence: sequence, Universe: a.universe, Producer: producer,
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
	transaction := &factTransaction{
		ProtocolVersion: protocolVersion, Base: baseID, Next: generation,
		Manifest: manifest, Upserts: upserts, Deletes: deletes,
	}
	a.states[generationID] = generationState{
		generation: generation, manifest: manifest, digests: digests, sourceManifest: sourceManifest,
	}
	a.current = generationID
	a.collectStates()
	return transaction, "", nil
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

func (a *analyzer) apply(changed []string) error {
	for _, path := range sortedUnique(append([]string{}, changed...)) {
		absolute, err := a.absoluteChangedPath(path)
		if err != nil {
			return err
		}
		if _, resident := a.session.SourceText(absolute); !resident {
			// New roots, deletions/renames, tsconfig changes, and files newly
			// admitted by an include glob require the compiler to rediscover the
			// project root set rather than applying a single-file overlay.
			return a.rebuild()
		}
		content, err := os.ReadFile(absolute)
		if err != nil {
			if os.IsNotExist(err) {
				return a.rebuild()
			}
			return err
		}
		// Apply itself rebuilds the resident Program when imports or references
		// change; its boolean reports reuse evidence, not failure.
		a.session.Apply(absolute, string(content))
	}
	return nil
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
