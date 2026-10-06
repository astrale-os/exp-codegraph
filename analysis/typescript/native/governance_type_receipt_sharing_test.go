package main

import (
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

// The original receipt representation is a test oracle only: copy all source
// rows, mark the original demanded/global referenced closure, then snapshot both
// actual maps under their original lock. No expected row enters a current FS.
type originalTypeReceiptSnapshot struct {
	root         string
	sources      map[string]governanceTypeSource
	reads        map[string]compilerRawRead
	observations map[compilerInputKey]string
}

func originalTypeReceiptRows(owner *governanceTypeAuthority, demanded string) originalTypeReceiptSnapshot {
	out := originalTypeReceiptSnapshot{owner.project.Root, map[string]governanceTypeSource{}, map[string]compilerRawRead{}, map[compilerInputKey]string{}}
	needed := map[string]bool{demanded: true}
	for path, source := range owner.typeSourceBase {
		out.sources[path] = source
		if source.needed {
			needed[path] = true
		}
	}
	queue := []string{}
	for path := range needed {
		queue = append(queue, path)
	}
	for len(queue) > 0 {
		path := queue[0]
		queue = queue[1:]
		for _, target := range owner.typeSourceForward[path] {
			if !needed[target] {
				needed[target] = true
				queue = append(queue, target)
			}
		}
	}
	for path, source := range out.sources {
		source.needed = needed[path]
		out.sources[path] = source
	}
	fs := owner.project.capture.compiler
	fs.mu.Lock()
	defer fs.mu.Unlock()
	for path, value := range compilerTestRawReads(fs) {
		out.reads[path] = value
	}
	for key, value := range compilerTestObservations(fs) {
		out.observations[key] = value
	}
	return out
}

func sharedTypeReceiptRows(receipt *governanceTypeReceipt) originalTypeReceiptSnapshot {
	out := originalTypeReceiptSnapshot{receipt.base.root, map[string]governanceTypeSource{}, map[string]compilerRawRead{}, map[compilerInputKey]string{}}
	needed := receipt.neededSources()
	for path, source := range receipt.base.sources {
		source.needed = needed[path]
		out.sources[path] = source
	}
	for _, row := range receipt.prefix.reads {
		out.reads[row.path] = row.value
	}
	for _, row := range receipt.prefix.observations {
		out.observations[row.key] = row.before
	}
	return out
}

func requireTypeReceipt(t *testing.T, owner *governanceTypeAuthority, path string) *governanceTypeReceipt {
	t.Helper()
	receipt, ok := owner.captureTypeReceipt(path)
	if !ok || receipt == nil {
		t.Fatal("original faithful program did not produce a receipt", path)
	}
	if actual, expected := sharedTypeReceiptRows(receipt), originalTypeReceiptRows(owner, receipt.demanded); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("shared receipt changed original snapshot: actual=%#v expected=%#v", actual, expected)
	}
	if cap(receipt.prefix.reads) != len(receipt.prefix.reads) || cap(receipt.prefix.observations) != len(receipt.prefix.observations) {
		t.Fatal("receipt can extend its owned frontier")
	}
	return receipt
}

func TestGovernanceTypeReceiptsShareOnlyOnePlainBaseAndExactEarlierFrontier(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	project, file, node := typeDemandTestProject(t, root, cache)
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
		}
	})
	value := project.typeOwner.names(file, node)
	if !value.Known || !reflect.DeepEqual(value.Names, []string{"before"}) {
		t.Fatal("original names unavailable", value)
	}
	first := requireTypeReceipt(t, project.typeOwner, project.FilesByPath[file.Path].AbsolutePath)
	before := sharedTypeReceiptRows(first)
	fs := project.capture.compiler
	late := filepath.Join(root, "late-owned.txt")
	fs.rememberRaw(late, compilerRawRead{"current raw prefix", true})
	fs.remember(late, inputRead, inputText("current raw prefix", true))
	for i := 0; i < 128; i++ {
		fs.FileExists(filepath.Join(root, "unobserved", strconv.Itoa(i)))
	}
	second := requireTypeReceipt(t, project.typeOwner, project.FilesByPath["queries/independent.ts"].AbsolutePath)
	if first.base != second.base || first.demanded == second.demanded {
		t.Fatal("same program did not share one base with distinct demands")
	}
	if !reflect.DeepEqual(sharedTypeReceiptRows(first), before) {
		t.Fatal("later first touches changed an earlier original receipt")
	}
	if _, present := before.reads[late]; present || sharedTypeReceiptRows(second).reads[late].text != "current raw prefix" {
		t.Fatal("raw first touch crossed a receipt frontier")
	}
	neededFirst, neededSecond := first.neededSources(), second.neededSources()
	dependency := project.FilesByPath["schema/value.ts"].AbsolutePath
	if !neededFirst[dependency] || neededSecond[dependency] {
		t.Fatal("shared base confused demanded dependency ownership")
	}
	oldText := first.base.sources[dependency].text
	project.FilesByPath["schema/value.ts"].Text = "consumer changed captured wrapper"
	if first.base.sources[dependency].text != oldText || !reflect.DeepEqual(sharedTypeReceiptRows(first), before) {
		t.Fatal("captured wrapper mutation changed retained plain source rows")
	}
	project.FilesByPath["schema/value.ts"].Text = oldText
}

func TestGovernanceTypeReceiptCompletedRawFixtureAndMissingRawGuard(t *testing.T) {
	root := typeDemandFixture(t)
	project, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
		}
	})
	if !project.typeOwner.names(file, node).Known {
		t.Fatal("original names unavailable")
	}
	fs := project.capture.compiler
	path := filepath.Join(root, "raw-before-observed.txt")
	// Construct a completed raw-only oracle fixture. Live compiler receipt cuts
	// follow joined readers and atomically include their read fingerprints.
	fs.rememberRaw(path, compilerRawRead{"original intermediate raw", true})
	first := requireTypeReceipt(t, project.typeOwner, project.FilesByPath[file.Path].AbsolutePath)
	rows := sharedTypeReceiptRows(first)
	if rows.reads[path] != (compilerRawRead{"original intermediate raw", true}) {
		t.Fatal("completed raw fixture value omitted")
	}
	if _, observed := rows.observations[compilerInputKey{path, inputRead}]; observed {
		t.Fatal("future observed fingerprint appeared in raw-only prefix")
	}
	fs.remember(path, inputRead, inputText("original intermediate raw", true))
	second := requireTypeReceipt(t, project.typeOwner, project.FilesByPath[file.Path].AbsolutePath)
	if !reflect.DeepEqual(sharedTypeReceiptRows(first), rows) || len(second.prefix.observations) != len(first.prefix.observations)+1 {
		t.Fatal("observed publication changed the retained intermediate prefix")
	}
	current := &governedProject{Root: root, Files: project.Files, capture: &governanceCapture{compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}}
	assertions, valid := first.replay(current)
	if !valid || assertions.barrierReads[path] != rows.reads[path] {
		t.Fatal("raw-only obligation did not survive original replay")
	}
	if _, actual := compilerTestRawReads(current.capture.compiler)[path]; actual {
		t.Fatal("expected intermediate raw value became a current observation")
	}
	missing := filepath.Join(root, "observed-without-raw.txt")
	fs.remember(missing, inputRead, inputText("never captured raw", true))
	malformed := requireTypeReceipt(t, project.typeOwner, project.FilesByPath[file.Path].AbsolutePath)
	if _, valid := malformed.replay(current); valid {
		t.Fatal("original missing-raw guard was weakened")
	}
}

func TestGovernanceTypeReceiptJournalFirstValuesConflictsAndLegacyReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.ts")
	fs := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	first := compilerRawRead{"before", true}
	fs.rememberRaw(path, first)
	fs.remember(path, inputRead, inputText(first.text, first.present))
	fs.rememberRaw(path, first)
	fs.remember(path, inputRead, inputText(first.text, first.present))
	if len(fs.prefix.reads) != 1 || len(fs.prefix.observations) != 1 || fs.inconsistent {
		t.Fatal("repeated original first value duplicated or corrupted its journal")
	}
	fs.rememberRaw(path, compilerRawRead{"after", true})
	fs.remember(path, inputRead, inputText("after", true))
	if !fs.inconsistent || compilerTestRawReads(fs)[path] != first || fs.prefix.reads[0].value != first || len(fs.prefix.reads) != 1 || len(fs.prefix.observations) != 1 {
		t.Fatal("conflicting value replaced an original first row")
	}
	if valid, err := (&governanceCapture{observations: map[string]governanceObservation{}, compiler: fs}).Verify(); err != nil || valid {
		t.Fatalf("original inconsistent owner could publish: %t %v", valid, err)
	}
	legacy := newCompilerInputFS(newAuthoredCompilerDisk(), newAuthoredCompilerDisk())
	legacy.rememberRaw(path, first)
	legacy.remember(path, inputFile, inputBool(false))
	legacy.rememberRaw(path, compilerRawRead{"current", true})
	legacy.remember(path, inputFile, inputBool(true))
	if compilerTestRawReads(legacy)[path].text != "current" || compilerTestObservations(legacy)[compilerInputKey{path, inputFile}] != inputBool(true) || legacy.inconsistent || len(legacy.prefix.reads) != 0 || len(legacy.prefix.observations) != 0 {
		t.Fatal("legacy generation replacement acquired a decision journal")
	}
}

func TestGovernanceTypeReceiptReferencedCyclesAndGlobalRootsStayDemandSpecific(t *testing.T) {
	base := &governanceTypeReceiptBase{
		sources: map[string]governanceTypeSource{"a": {}, "b": {}, "c": {}, "global": {needed: true}, "global-dependency": {}, "independent": {}},
		forward: map[string][]string{"a": {"b"}, "b": {"c"}, "c": {"a"}, "global": {"global-dependency"}},
	}
	first := (&governanceTypeReceipt{base: base, demanded: "a"}).neededSources()
	second := (&governanceTypeReceipt{base: base, demanded: "independent"}).neededSources()
	if !reflect.DeepEqual(first, map[string]bool{"a": true, "b": true, "c": true, "global": true, "global-dependency": true}) || !reflect.DeepEqual(second, map[string]bool{"independent": true, "global": true, "global-dependency": true}) {
		t.Fatal("original referenced cycle/global closure changed", first, second)
	}
	for path, source := range base.sources {
		if source.needed != (path == "global") {
			t.Fatal("demanded traversal mutated the shared global-needed base", path)
		}
	}
}

func TestGovernanceTypeReceiptOrdinaryEditReplayAndGenerationBaseIndependence(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	old, names := testTypeDemand(t, root, cache)
	if !names.Known || len(cache.entries) != 1 {
		t.Fatal("original demand absent")
	}
	var receipt *governanceTypeReceipt
	for _, entry := range cache.entries {
		receipt = entry.receipt
	}
	oldRows := sharedTypeReceiptRows(receipt)
	governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 2;`)
	warm, replayed := testTypeDemand(t, root, cache)
	if warm.stats.TypeCacheHits != 1 || warm.stats.CompilerPrograms != 0 || !reflect.DeepEqual(names, replayed) {
		t.Fatal("original independent-body replay changed", warm.stats, replayed)
	}
	if valid, err := warm.capture.Verify(); err != nil || !valid {
		t.Fatalf("current original replay did not seal: %t %v", valid, err)
	}
	fresh, freshNames := testTypeDemand(t, root, &governanceTypeDemandCache{})
	if fresh.typeOwner.typeReceiptBase == old.typeOwner.typeReceiptBase || !reflect.DeepEqual(replayed, freshNames) || !reflect.DeepEqual(sharedTypeReceiptRows(receipt), oldRows) {
		t.Fatal("new generation shared mutable old source authority")
	}
	governanceWrite(t, root, "schema/value.ts", `export const subject = { after: 1 };`)
	changed, _, _ := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	if _, valid := receipt.replay(changed); valid {
		t.Fatal("current demanded dependency edit reused the old original type")
	}
	governanceWrite(t, root, "schema/value.ts", `export const subject = { before: 1 };`)
	governanceWrite(t, root, "queries/independent.ts", `const globalSubject=1;`)
	global, _, _ := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	if _, valid := receipt.replay(global); valid {
		t.Fatal("new global source bypassed original ordinary-source guard")
	}
}

func TestGovernanceTypeReceiptRetainsOriginalMetadataFailureAndCacheEvictionBound(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	project, file, node := typeDemandTestProject(t, root, cache)
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
		}
	})
	value := project.typeOwner.names(file, node)
	if !value.Known || len(cache.entries) != 1 {
		t.Fatal("original demand absent")
	}
	var entry governanceTypeDemandEntry
	for _, stored := range cache.entries {
		entry = stored
	}
	cache.entries = map[governanceTypeDemandKey]governanceTypeDemandEntry{}
	for i := 0; i < 256; i++ {
		cache.entries[governanceTypeDemandKey{root: root, operation: "old", start: i}] = entry
	}
	project.typeOwner.storeTypeDemand("new-one", file, node, governanceTypeDemandValue{names: value})
	if len(cache.entries) != 257 {
		t.Fatal("original cache eviction occurred before its exact boundary", len(cache.entries))
	}
	project.typeOwner.storeTypeDemand("new-two", file, node, governanceTypeDemandValue{names: value})
	if len(cache.entries) != 1 {
		t.Fatal("original cache eviction boundary changed", len(cache.entries))
	}
	for _, stored := range cache.entries {
		if stored.receipt.base != entry.receipt.base {
			t.Fatal("same compiler authority constructed another source base")
		}
	}
	project.capture.compiler.certifyJSON(filepath.Join(root, "malformed.options"), "{")
	if _, valid := project.typeOwner.captureTypeReceipt(project.FilesByPath[file.Path].AbsolutePath); valid {
		t.Fatal("malformed original metadata produced a shared receipt")
	}
	before := len(cache.entries)
	project.typeOwner.storeTypeDemand("after-lossy", file, node, governanceTypeDemandValue{names: value})
	if len(cache.entries) != before {
		t.Fatal("metadata-lossy owner installed a new replayable cache entry")
	}
}
