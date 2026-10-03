package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	compiler "github.com/microsoft/typescript-go/shim/compiler"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"strings"
	"sync"
	"time"
)

// Values contain no compiler pointers. Raw strings, including absent reads and
// reference syntax, are compared directly; digests do not authorize replay.

type governanceTypeDemandKey struct {
	root, operation, path string
	start, end            int
}
type governanceTypeDemandValue struct {
	names           sourcepolicy.NamesObservation
	kind            sourcepolicy.KindObservation
	literalFaithful bool
}
type governanceTypeDemandEntry struct {
	value   governanceTypeDemandValue
	receipt *governanceTypeReceipt
}
type governanceTypeDemandCache struct {
	entries map[governanceTypeDemandKey]governanceTypeDemandEntry
}
type governanceTypeSource struct {
	text, references string
	options          ast.SourceFileParseOptions
	needed, ordinary bool
}
type governanceTypeReplayWorld struct {
	disk         vfs.FS
	reads        map[string]compilerRawRead
	observations map[compilerInputKey]string
	mu           sync.Mutex
	cells        map[compilerInputKey]*governanceFreshCompilerOperation
	batch        *governancePublicationWorkers
	checkedPlans map[*governanceCompilerExpectationPlan]bool
}

// Uncached replay I/O is batched once per capture; no worker touches compiler
// AST/checker state. Results are published only after every operation finishes.
func (world *governanceTypeReplayWorld) preparePlan(plan *governanceCompilerExpectationPlan) {
	paths := []string{}
	keys := []compilerInputKey{}
	for _, read := range plan.reads {
		if _, seen := world.reads[read.path]; !seen {
			paths = append(paths, read.path)
		}
	}
	for _, row := range plan.observations {
		if row.key.kind != inputRead {
			if _, seen := world.observations[row.key]; !seen {
				keys = append(keys, row.key)
			}
		}
	}
	readValues := make([]compilerRawRead, len(paths))
	values := make([]string, len(keys))
	batch := world.batch
	if batch == nil {
		batch = &governancePublicationWorkers{}
		defer batch.close()
	}
	batch.run(len(paths)+len(keys), func(index int, _ []byte) {
		if index < len(paths) {
			readValues[index] = world.readActual(paths[index])
		} else {
			values[index-len(paths)] = world.observeActual(keys[index-len(paths)])
		}
	})
	for index, path := range paths {
		world.reads[path] = readValues[index]
	}
	for index, key := range keys {
		world.observations[key] = values[index]
	}
}

// One original program owns this plain immutable source/reference base. It
// retains no compiler, AST, filesystem, project, or prior-generation pointer.
type governanceTypeReceiptBase struct {
	root    string
	sources map[string]governanceTypeSource
	forward map[string][]string
}
type governanceTypeReceipt struct {
	base     *governanceTypeReceiptBase
	demanded string
	prefix   compilerInputPrefix
}

func (receipt *governanceTypeReceipt) neededSources() map[string]bool {
	needed := map[string]bool{receipt.demanded: true}
	queue := []string{receipt.demanded}
	for path, source := range receipt.base.sources {
		if source.needed && !needed[path] {
			needed[path] = true
			queue = append(queue, path)
		}
	}
	for len(queue) > 0 {
		path := queue[0]
		queue = queue[1:]
		for _, target := range receipt.base.forward[path] {
			if !needed[target] {
				needed[target] = true
				queue = append(queue, target)
			}
		}
	}
	return needed
}

func governanceOrdinaryTypeSource(source *ast.SourceFile) bool {
	name := strings.ToLower(source.FileName())
	return len(source.Diagnostics()) == 0 && !source.IsDeclarationFile && (strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tsx")) && source.ExternalModuleIndicator != nil && !compiler.FileAffectsGlobalScope(source) && len(source.ModuleAugmentations) == 0 && !sourceHasAmbientModule(source)
}

// Keep exact resolution-affecting syntax, not merely module specifier names.
// The compiler's own referenced-file relation supplies the actual targets.
func governanceTypeReferenceSyntax(source *ast.SourceFile) string {
	parts := []string{sourceImportIdentity(source)}
	walkFile(source, func(node *ast.Node) bool {
		relevant := false
		switch node.Kind {
		case ast.KindImportDeclaration, ast.KindJSImportDeclaration, ast.KindExportDeclaration, ast.KindImportEqualsDeclaration, ast.KindImportType:
			relevant = true
		case ast.KindCallExpression:
			callee := node.AsCallExpression().Expression
			relevant = callee != nil && (callee.Kind == ast.KindImportKeyword || callee.Kind == ast.KindIdentifier && callee.Text() == "require")
		}
		if relevant {
			start := scanner.GetTokenPosOfNode(node, source, false)
			parts = append(parts, node.KindString()+":"+source.Text()[start:node.End()])
			return false
		}
		return true
	})
	return string(stableJSON(parts))
}

func (owner *governanceTypeAuthority) demandKey(operation string, file *sourcepolicy.File, node *ast.Node) governanceTypeDemandKey {
	return governanceTypeDemandKey{owner.project.Root, operation, file.Path, scanner.GetTokenPosOfNode(node, file.Source, false), node.End()}
}
func (owner *governanceTypeAuthority) lookupTypeDemand(operation string, file *sourcepolicy.File, node *ast.Node) (governanceTypeDemandValue, bool) {
	if !owner.project.capture.metadataFidelity() {
		return governanceTypeDemandValue{}, false
	}
	key := owner.demandKey(operation, file, node)
	if entry, ok := owner.cells[key]; ok && entry.literalFaithful {
		owner.project.stats.TypeCacheHits++
		return entry, true
	}
	cache := owner.project.typeDemandCache
	if cache == nil {
		return governanceTypeDemandValue{}, false
	}
	entry, ok := cache.entries[key]
	if !ok || !entry.value.literalFaithful || entry.receipt == nil {
		owner.project.stats.TypeCacheMisses++
		return governanceTypeDemandValue{}, false
	}
	started := time.Now()
	defer func() { owner.project.stats.TypeCacheReplayNanoseconds += time.Since(started).Nanoseconds() }()
	if owner.validationSeen == nil {
		owner.validationSeen = map[*governanceTypeReceipt]bool{}
		owner.validated = map[*governanceTypeReceipt]bool{}
	}
	if !owner.validationSeen[entry.receipt] {
		owner.validationSeen[entry.receipt] = true
		owner.project.capture.compilerInputs()
		replay, valid := entry.receipt.replay(owner.project)
		owner.validated[entry.receipt] = valid
		if valid {
			lease := newGovernanceTypeCacheLease(cache, key, replay)
			capture := owner.project.capture
			// Pending compiler-capsule receipts have no type-cache owner. Keep
			// those immutable assertions distinct from current cache invalidation.
			var target *governanceTypeCacheLease
			for _, candidate := range capture.typeCacheLeases {
				if candidate.cache == cache && candidate.cacheKeys != nil {
					target = candidate
					break
				}
			}
			if target == nil {
				capture.typeCacheLeases = append(capture.typeCacheLeases, lease)
			} else {
				target.cacheKeys[key] = true
				for path, value := range replay.barrierReads {
					if before, seen := target.barrierReads[path]; seen && before != value {
						capture.probeInconsistent = true
					}
					if before, seen := target.barrierReads[path]; !seen || before != value {
						target.certificateRows = nil
						target.snapshot = nil
					}
					target.barrierReads[path] = value
				}
				for key, value := range replay.barrierObservations {
					if before, seen := target.barrierObservations[key]; seen && before != value {
						capture.probeInconsistent = true
					}
					if before, seen := target.barrierObservations[key]; !seen || before != value {
						target.certificateRows = nil
						target.snapshot = nil
					}
					target.barrierObservations[key] = value
				}
			}
		}
	}
	if !owner.validated[entry.receipt] {
		owner.project.stats.TypeCacheMisses++
		return governanceTypeDemandValue{}, false
	}
	if owner.cells == nil {
		owner.cells = map[governanceTypeDemandKey]governanceTypeDemandValue{}
	}
	owner.cells[key] = entry.value
	owner.project.stats.TypeCacheHits++
	return entry.value, true
}
func (owner *governanceTypeAuthority) storeTypeDemand(operation string, file *sourcepolicy.File, node *ast.Node, value governanceTypeDemandValue) {
	if !owner.literalFidelity() {
		return
	}
	key := owner.demandKey(operation, file, node)
	cache := owner.project.typeDemandCache
	var receipt *governanceTypeReceipt
	if cache != nil && owner.program != nil && !owner.project.capture.compiler.inconsistent {
		receipt, _ = owner.captureTypeReceipt(owner.project.FilesByPath[file.Path].AbsolutePath)
	}
	// Referenced-file closure may consume more real package metadata. Commit a
	// successful cell only after that complete original prefix is faithful too.
	if !owner.literalFidelity() {
		return
	}
	value.literalFaithful = true // Program literals AND all consumed metadata.
	if owner.cells == nil {
		owner.cells = map[governanceTypeDemandKey]governanceTypeDemandValue{}
	}
	owner.cells[key] = value
	if receipt == nil {
		return
	}
	if cache.entries == nil || len(cache.entries) > 256 {
		cache.entries = map[governanceTypeDemandKey]governanceTypeDemandEntry{}
	}
	cache.entries[key] = governanceTypeDemandEntry{value, receipt}
}

func (owner *governanceTypeAuthority) captureTypeReceipt(demanded string) (*governanceTypeReceipt, bool) {
	program := owner.program.TSProgram
	demandSource := owner.program.SourceFile(demanded)
	if demandSource == nil {
		return nil, false
	}
	if !owner.literalFidelity() {
		return nil, false
	}
	if owner.typeSourceForward == nil {
		physical := map[string]string{}
		forward := map[string][]string{}
		for _, source := range program.SourceFiles() {
			physical[string(source.Path())] = source.FileName()
		}
		for _, source := range program.SourceFiles() {
			path := source.FileName()
			for _, ref := range compiler.GetReferencedFilePaths(program, source) {
				target, ok := physical[ref]
				if !ok {
					return nil, false
				}
				forward[path] = append(forward[path], target)
			}
		}
		owner.typeSourceForward = forward
	}
	if _, mapped := owner.typeSourceBase[demandSource.FileName()]; !mapped {
		return nil, false
	}
	if owner.typeReceiptBase == nil {
		owner.typeReceiptBase = &governanceTypeReceiptBase{owner.project.Root, owner.typeSourceBase, owner.typeSourceForward}
	}
	fs := owner.project.capture.compiler
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if fs.metadataLossy {
		return nil, false
	}
	return &governanceTypeReceipt{owner.typeReceiptBase, demandSource.FileName(), compilerInputPrefix{
		reads:        fs.prefix.reads[:len(fs.prefix.reads):len(fs.prefix.reads)],
		observations: fs.prefix.observations[:len(fs.prefix.observations):len(fs.prefix.observations)],
	}}, true
}

// A hit proposes private proof obligations. Only authored bytes and compiler
// operations actually observed in this capture can discharge an obligation
// here. Every remaining obligation is checked with uncached I/O at final seal.
// Expected reads are NEVER inserted into the current compiler observation map.
func (receipt *governanceTypeReceipt) replay(project *governedProject) (*governanceCompilerReadAssertions, bool) {
	if receipt.base.root != project.Root || project.capture.compiler == nil {
		return nil, false
	}
	fs := project.capture.compiler
	replay := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	changed := map[string]bool{}
	actualReads := map[string]compilerRawRead{}
	actualObservations := map[compilerInputKey]string{}
	fs.mu.Lock()
	for path, value := range fs.rawReads {
		actualReads[path] = value
	}
	for key, value := range fs.observed {
		actualObservations[key] = value
	}
	fs.mu.Unlock()
	for _, captured := range project.Files {
		actualReads[captured.AbsolutePath] = compilerRawRead{captured.Text, true}
	}
	needed := receipt.neededSources()
	for path, old := range receipt.base.sources {
		current, observed := actualReads[path]
		if !observed {
			current = compilerRawRead{old.text, true}
		}
		if !current.present {
			return nil, false
		}
		replay.barrierReads[path] = current
		if current.text == old.text {
			continue
		}
		if needed[path] || !old.ordinary {
			return nil, false
		}
		kind := core.ScriptKindTS
		if strings.HasSuffix(strings.ToLower(path), ".tsx") {
			kind = core.ScriptKindTSX
		}
		source := parser.ParseSourceFile(old.options, current.text, kind)
		if !governanceOrdinaryTypeSource(source) || governanceTypeReferenceSyntax(source) != old.references || !governanceTypeLiteralFidelity(source) {
			return nil, false
		}
		changed[path] = true
	}
	readPaths := make(map[string]bool, len(receipt.prefix.reads))
	for _, row := range receipt.prefix.reads {
		path, old := row.path, row.value
		readPaths[path] = true
		current, observed := actualReads[path]
		if !observed {
			if source, seen := replay.barrierReads[path]; seen {
				current = source
			} else {
				current = old
			}
		}
		if current != old && !changed[path] {
			return nil, false
		}
		replay.barrierReads[path] = current
	}
	for _, row := range receipt.prefix.observations {
		key, old := row.key, row.before
		if key.kind == inputRead {
			if !readPaths[key.path] {
				return nil, false
			}
			continue
		}
		current, observed := actualObservations[key]
		if !observed {
			current = old
		}
		if key.kind == inputMetadata && changed[key.path] {
			// Actual metadata for one admitted body/ID edit supersedes its old stat.
			// This is a current observation, not a guessed/deferred answer.
			current = observeCompilerInput(fs.disk, key)
			fs.remember(key.path, key.kind, current)
		} else if current != old {
			return nil, false
		}
		replay.barrierObservations[key] = current
	}
	return replay, true
}
