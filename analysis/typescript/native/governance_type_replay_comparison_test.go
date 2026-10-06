package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type source59MetadataFS struct {
	vfs.FS
	statPaths []string
}

func (fs *source59MetadataFS) Stat(path string) vfs.FileInfo {
	fs.statPaths = append(fs.statPaths, path)
	return fs.FS.Stat(path)
}

func source59Prefix(fs *compilerInputFS) compilerInputPrefix {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return compilerInputPrefix{origin: fs.prefix.origin, reads: fs.prefix.reads[:len(fs.prefix.reads):len(fs.prefix.reads)], observations: fs.prefix.observations[:len(fs.prefix.observations):len(fs.prefix.observations)]}
}
func source59Project(root string) *governedProject {
	return &governedProject{Root: root, capture: &governanceCapture{compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}}
}
func source59Accept(t *testing.T, project *governedProject, cache *governanceTypeDemandCache, key governanceTypeDemandKey, receipt *governanceTypeReceipt) *governanceTypeReplayComparison {
	t.Helper()
	additions, state, valid := receipt.replayForCache(project, cache)
	if !valid {
		t.Fatal("faithful receipt refused")
	}
	project.capture.acceptTypeReplay(cache, key, additions)
	state.accept(receipt.prefix)
	return state
}

func TestSource59CommonPrefixTransfersOnlyNewRowsAndKeepsSnapshotsImmutable(t *testing.T) {
	root := t.TempDir()
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{}, forward: map[string][]string{}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	path := filepath.Join(root, "one")
	old.rememberRaw(path, compilerRawRead{"expected", true})
	old.remember(path, inputRead, inputText("expected", true))
	first := &governanceTypeReceipt{base: base, demanded: "a", prefix: source59Prefix(old)}
	before := sharedTypeReceiptRows(first)
	old.remember(filepath.Join(root, "two"), inputFile, inputBool(false))
	second := &governanceTypeReceipt{base: base, demanded: "b", prefix: source59Prefix(old)}
	project, cache := source59Project(root), &governanceTypeDemandCache{}
	firstKey, secondKey := governanceTypeDemandKey{path: "a"}, governanceTypeDemandKey{path: "b"}
	state := source59Accept(t, project, cache, firstKey, first)
	lease := project.capture.typeCacheLeases[0]
	snapshot := lease.assertions()
	additions, same, valid := second.replayForCache(project, cache)
	if !valid || same != state || len(additions.barrierReads) != 0 || len(additions.barrierObservations) != 1 {
		t.Fatal("second question repeated a common prefix or changed owner", valid, additions)
	}
	project.capture.acceptTypeReplay(cache, secondKey, additions)
	same.accept(second.prefix)
	if len(project.capture.typeCacheLeases) != 1 || !lease.cacheKeys[firstKey] || !lease.cacheKeys[secondKey] {
		t.Fatal("successful demands lost their current owner")
	}
	if len(snapshot.barrierObservations) != 0 || len(lease.assertions().barrierObservations) != 1 {
		t.Fatal("published snapshot aliases mutable additions")
	}
	if !reflect.DeepEqual(before, sharedTypeReceiptRows(first)) || len(compilerTestRawReads(project.capture.compiler)) != 0 || len(compilerTestObservations(project.capture.compiler)) != 0 {
		t.Fatal("shared expectations mutated an old receipt or became actual")
	}
}

func TestSource59LateActualContradictionAndFailedLongPrefixDoNotPromote(t *testing.T) {
	root := t.TempDir()
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	path := filepath.Join(root, "late")
	old.rememberRaw(path, compilerRawRead{"old", true})
	first := &governanceTypeReceipt{base: base, prefix: source59Prefix(old)}
	project, cache := source59Project(root), &governanceTypeDemandCache{}
	state := source59Accept(t, project, cache, governanceTypeDemandKey{path: "first"}, first)
	unused := compilerInputKey{filepath.Join(root, "unused"), inputFile}
	old.remember(unused.path, unused.kind, inputBool(false))
	long := &governanceTypeReceipt{base: base, prefix: source59Prefix(old)}
	project.capture.compiler.remember(unused.path, unused.kind, inputBool(true))
	if _, same, valid := long.replayForCache(project, cache); valid || same != state {
		t.Fatal("long contradictory guard reused")
	}
	lease := project.capture.typeCacheLeases[0]
	if _, promoted := lease.barrierObservations[unused]; promoted || state.acceptedObservations != 0 {
		t.Fatal("failed demand promoted an unused guard")
	}
	project.capture.compiler.rememberRaw(path, compilerRawRead{"actual", true})
	if _, same, valid := first.replayForCache(project, cache); valid || same != state {
		t.Fatal("later actual raw contradiction ignored")
	}
	if lease.barrierReads[path].text != "old" || project.capture.probeInconsistent {
		t.Fatal("failed demand mutated a prior lease")
	}
	// The current physical final seal still rejects the previously deferred read.
	freshSeal := &governanceCapture{compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk()), typeCacheLeases: []*governanceTypeCacheLease{lease}}
	if valid, err := governanceVerifyPublication([]*governanceCapture{freshSeal}); valid || err != nil {
		t.Fatal("deferred stale expectation sealed", err)
	}
}

func TestSource59JournalIdentityAndRawFrontiersCannotBeGuessed(t *testing.T) {
	root := t.TempDir()
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{}}
	project, cache := source59Project(root), &governanceTypeDemandCache{}
	oldA, oldB := governanceNewCompilerInputFS(newAuthoredCompilerDisk()), governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	oldA.remember("a", inputFile, inputBool(false))
	oldB.remember("b", inputFile, inputBool(false))
	a := &governanceTypeReceipt{base: base, prefix: source59Prefix(oldA)}
	b := &governanceTypeReceipt{base: base, prefix: source59Prefix(oldB)}
	_, ownerA, validA := a.replayForCache(project, cache)
	_, ownerB, validB := b.replayForCache(project, cache)
	if !validA || !validB || ownerA == ownerB {
		t.Fatal("equal frontier lengths became provenance")
	}
	oldA.rememberRaw("raw", compilerRawRead{"raw", true})
	rawOnly := &governanceTypeReceipt{base: base, prefix: source59Prefix(oldA)}
	oldA.remember("raw", inputRead, inputText("raw", true))
	complete := &governanceTypeReceipt{base: base, prefix: source59Prefix(oldA)}
	if _, _, valid := complete.replayForCache(project, cache); !valid {
		t.Fatal("complete original frontier refused")
	}
	malformed := *complete
	malformed.prefix.reads = a.prefix.reads // Same origin, genuinely shorter raw frontier.
	if _, _, valid := malformed.replayForCache(project, cache); valid {
		t.Fatal("future raw row repaired an earlier observed-only receipt")
	}
	if _, _, valid := rawOnly.replayForCache(project, cache); !valid {
		t.Fatal("raw-before-observed prefix refused after a longer question")
	}
	nilOrigin := *a
	nilOrigin.prefix.origin = nil
	_, freshA, validA := nilOrigin.replayForCache(project, cache)
	_, freshB, validB := nilOrigin.replayForCache(project, cache)
	if !validA || !validB || freshA == freshB {
		t.Fatal("unproven journal acquired shared authority")
	}
}

func TestSource59CommonSourceClassificationRetainsDemandClosureAndLateCurrentGuard(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "ordinary.ts")
	options := ast.SourceFileParseOptions{FileName: path}
	text := `export const independent = 1;`
	parsed := parser.ParseSourceFile(options, text, core.ScriptKindTS)
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{path: {text: text, references: governanceTypeReferenceSyntax(parsed), options: options, ordinary: governanceOrdinaryTypeSource(parsed)}}, forward: map[string][]string{"dependent": {path}}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	project, cache := source59Project(root), &governanceTypeDemandCache{}
	project.capture.compiler.rememberRaw(path, compilerRawRead{`export const independent = 2;`, true})
	independent := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	dependent := &governanceTypeReceipt{base: base, demanded: "dependent", prefix: independent.prefix}
	state := source59Accept(t, project, cache, governanceTypeDemandKey{path: "other"}, independent)
	if _, same, valid := dependent.replayForCache(project, cache); valid || same != state {
		t.Fatal("common positive classification erased demand-specific dependency")
	}
	// A previously unread base source is still only an expected obligation.
	lateProject := source59Project(root)
	state = source59Accept(t, lateProject, cache, governanceTypeDemandKey{path: "other"}, independent)
	lateProject.capture.compiler.rememberRaw(path, compilerRawRead{`const becomesGlobal = 1;`, true})
	if _, same, valid := independent.replayForCache(lateProject, cache); valid || same != state {
		t.Fatal("late actual global source reused an earlier positive classification")
	}
	if base.sources[path].text != text {
		t.Fatal("common classification mutated immutable source facts")
	}
}

func TestSource59ChangedMetadataRemainsFreshAndPrecedesLaterGuardFailure(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "ordinary.ts")
	options := ast.SourceFileParseOptions{FileName: path}
	text := `export const independent = 1;`
	parsed := parser.ParseSourceFile(options, text, core.ScriptKindTS)
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{path: {text: text, references: governanceTypeReferenceSyntax(parsed), options: options, ordinary: governanceOrdinaryTypeSource(parsed)}}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	old.remember(path, inputMetadata, "old-stat-is-an-expectation")
	first := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	old.remember("later-failure", inputFile, inputBool(false))
	long := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	project, cache := source59Project(root), &governanceTypeDemandCache{}
	physical := &source59MetadataFS{FS: newAuthoredCompilerDisk()}
	project.capture.compiler.disk = physical
	project.capture.compiler.rememberRaw(path, compilerRawRead{`export const independent = 2;`, true})
	state := source59Accept(t, project, cache, governanceTypeDemandKey{path: "first"}, first)
	if len(physical.statPaths) != 1 || physical.statPaths[0] != path {
		t.Fatal("first changed metadata was not physically observed")
	}
	additions, same, valid := first.replayForCache(project, cache)
	if !valid || same != state || len(physical.statPaths) != 2 || additions.barrierObservations[compilerInputKey{path, inputMetadata}] != "absent" {
		t.Fatal("second question memoized away original physical Stat", valid, physical.statPaths)
	}
	project.capture.compiler.remember("later-failure", inputFile, inputBool(true))
	if _, _, valid := long.replayForCache(project, cache); valid || len(physical.statPaths) != 3 {
		t.Fatal("later mismatch skipped earlier physical metadata", valid, physical.statPaths)
	}
	if _, promoted := project.capture.typeCacheLeases[0].barrierObservations[compilerInputKey{"later-failure", inputFile}]; promoted {
		t.Fatal("failed ordered guard entered lease")
	}
	governanceWrite(t, root, "ordinary.ts", `export const independent = 2;`)
	additions, _, valid = first.replayForCache(project, cache)
	if !valid || len(physical.statPaths) != 4 || !project.capture.compiler.inconsistent || additions.barrierObservations[compilerInputKey{path, inputMetadata}] == "absent" {
		t.Fatal("later genuine metadata conflict was hidden by comparison reuse")
	}
}

func TestSource59LateNonReadObservationRefusesWithoutPromotingAcceptedGuard(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "appeared.ts")
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	old.remember(path, inputFile, inputBool(false))
	receipt := &governanceTypeReceipt{base: base, prefix: source59Prefix(old)}
	current, original := source59Project(root), source59Project(root)
	key := governanceTypeDemandKey{path: "accepted"}
	cache := &governanceTypeDemandCache{entries: map[governanceTypeDemandKey]governanceTypeDemandEntry{key: {receipt: receipt}}}
	state := source59Accept(t, current, cache, key, receipt)
	lease := current.capture.typeCacheLeases[0]
	snapshot := lease.assertions()
	if _, valid := source59OriginalReplay(receipt, original); !valid {
		t.Fatal("original deferred negative guard refused")
	}
	if len(compilerTestObservations(current.capture.compiler)) != 0 || snapshot.barrierObservations[compilerInputKey{path, inputFile}] != inputBool(false) {
		t.Fatal("deferred guard became actual")
	}
	governanceWrite(t, root, "appeared.ts", `export const appeared = 1;`)
	for _, project := range []*governedProject{current, original} {
		if !project.capture.compiler.FileExists(path) {
			t.Fatal("genuine current file did not appear")
		}
	}
	_, validOriginal := source59OriginalReplay(receipt, original)
	_, same, validCurrent := receipt.replayForCache(current, cache)
	if validOriginal || validCurrent || same != state {
		t.Fatal("late current non-read contradiction reused an old guard", validOriginal, validCurrent)
	}
	if lease.barrierObservations[compilerInputKey{path, inputFile}] != inputBool(false) || snapshot.barrierObservations[compilerInputKey{path, inputFile}] != inputBool(false) || current.capture.probeInconsistent {
		t.Fatal("refused question rewrote accepted assertions")
	}
	if !reflect.DeepEqual(compilerTestObservations(current.capture.compiler), compilerTestObservations(original.capture.compiler)) {
		t.Fatal("current actual observation differs from scalar original")
	}
	freshSeal := &governanceCapture{compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk()), typeCacheLeases: []*governanceTypeCacheLease{lease}}
	if valid, err := governanceVerifyPublication([]*governanceCapture{freshSeal}); valid || err != nil {
		t.Fatal("previously deferred negative guard passed fresh seal", err)
	}
	if _, retained := cache.entries[key]; retained {
		t.Fatal("fresh failed guard did not invalidate its original cache key")
	}
}

func TestSource59SharedSequenceMatchesOriginalScalarAssertionsAndFailurePrefix(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "ordinary.ts")
	options := ast.SourceFileParseOptions{FileName: path}
	text := `export const independent = 1;`
	parsed := parser.ParseSourceFile(options, text, core.ScriptKindTS)
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{path: {text: text, references: governanceTypeReferenceSyntax(parsed), options: options, ordinary: governanceOrdinaryTypeSource(parsed)}}, forward: map[string][]string{"needed": {path}}}
	old := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	old.rememberRaw(path, compilerRawRead{text, true})
	old.remember(path, inputRead, inputText(text, true))
	old.remember(path, inputMetadata, "old-stat")
	first := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	old.remember("new-negative", inputFile, inputBool(false))
	long := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	needed := &governanceTypeReceipt{base: base, demanded: "needed", prefix: long.prefix}
	old.remember("never-raw", inputRead, inputText("missing", true))
	malformed := &governanceTypeReceipt{base: base, demanded: "other", prefix: source59Prefix(old)}
	current, original := source59Project(root), source59Project(root)
	currentPhysical, originalPhysical := &source59MetadataFS{FS: newAuthoredCompilerDisk()}, &source59MetadataFS{FS: newAuthoredCompilerDisk()}
	current.capture.compiler.disk, original.capture.compiler.disk = currentPhysical, originalPhysical
	for _, project := range []*governedProject{current, original} {
		project.capture.compiler.rememberRaw(path, compilerRawRead{`export const independent = 2;`, true})
	}
	cache := &governanceTypeDemandCache{}
	originalUnion := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	for index, receipt := range []*governanceTypeReceipt{first, long, needed, malformed, first} {
		want, validOriginal := source59OriginalReplay(receipt, original)
		additions, state, validCurrent := receipt.replayForCache(current, cache)
		if validOriginal != validCurrent {
			t.Fatalf("step %d validity differs: original=%t current=%t", index, validOriginal, validCurrent)
		}
		if validCurrent {
			current.capture.acceptTypeReplay(cache, governanceTypeDemandKey{start: index}, additions)
			state.accept(receipt.prefix)
			for path, value := range want.barrierReads {
				originalUnion.barrierReads[path] = value
			}
			for key, value := range want.barrierObservations {
				originalUnion.barrierObservations[key] = value
			}
			lease := current.capture.typeCacheLeases[0]
			if !reflect.DeepEqual(lease.barrierReads, originalUnion.barrierReads) || !reflect.DeepEqual(lease.barrierObservations, originalUnion.barrierObservations) {
				t.Fatalf("step %d assertion union differs", index)
			}
		}
		if !reflect.DeepEqual(currentPhysical.statPaths, originalPhysical.statPaths) || !reflect.DeepEqual(compilerTestRawReads(current.capture.compiler), compilerTestRawReads(original.capture.compiler)) || !reflect.DeepEqual(compilerTestObservations(current.capture.compiler), compilerTestObservations(original.capture.compiler)) || current.capture.compiler.inconsistent != original.capture.compiler.inconsistent {
			t.Fatalf("step %d original physical/current failure prefix differs", index)
		}
	}
}

// Exact parent97 scalar algorithm is an ephemeral test oracle, never a second
// production validation owner. Keep its physical Stat and guard order intact.
func source59OriginalReplay(receipt *governanceTypeReceipt, project *governedProject) (*governanceCompilerReadAssertions, bool) {
	if receipt.base.root != project.Root || project.capture.compiler == nil {
		return nil, false
	}
	fs := project.capture.compiler
	replay := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	changed := map[string]bool{}
	actualReads := map[string]compilerRawRead{}
	actualObservations := map[compilerInputKey]string{}
	fs.mu.Lock()
	for path, value := range compilerTestRawReads(fs) {
		actualReads[path] = value
	}
	for key, value := range compilerTestObservations(fs) {
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
