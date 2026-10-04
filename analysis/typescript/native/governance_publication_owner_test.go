package main

import (
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func publicationCapture() *governanceCapture {
	return &governanceCapture{observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
}
func TestPublicationCompilerOperationsShareOneFreshOwner(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "before")
	captures := []*governanceCapture{publicationCapture(), publicationCapture(), publicationCapture()}
	kinds := []compilerInputKind{inputFile, inputDirectory, inputMetadata, inputEnumeration, inputRealpath}
	for _, capture := range captures {
		assertions := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{path: {"before", true}}, barrierObservations: map[compilerInputKey]string{}}
		for _, kind := range kinds {
			key := compilerInputKey{path, kind}
			value := observeCompilerInput(capture.compiler.disk, key)
			assertions.barrierObservations[key] = value
			capture.compiler.observed[key] = value
		}
		capture.compilerAssertions = []*governanceCompilerReadAssertions{assertions}
	}
	world := &governanceBarrierReads{}
	plan := governanceCompilePublication(captures)
	if !plan.consistent { t.Fatal("coherent captures have contradictory publication guards") }
	if valid, err := plan.verify(world); !valid || err != nil {
		t.Fatalf("original guard failed %v %v", valid, err)
	}
	if len(world.compilerWorld.cells) != 6 {
		t.Fatalf("fresh compiler operations=%d, expected six", len(world.compilerWorld.cells))
	}
	if len(world.reads) != 1 {
		t.Fatalf("raw os.ReadFile calls=%d", len(world.reads))
	}
	if world.compilerReplay(captures[0].compiler.disk) != world.compilerReplay(captures[1].compiler.disk) {
		t.Fatal("same original constructed contract has multiple replay owners")
	}
	for _, cell := range world.compilerWorld.cells {
		if cell.physical == nil && cell.observation != "absent" {
			t.Fatal("original physical result not retained")
		}
	}
	if ok, _ := governanceVerifyPublication(captures); !ok {
		t.Fatal("complete equivalent original obligations failed")
	}
}
func TestPublicationCompilerNegativeAndSameStatReadRemainFresh(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "missing.ts")
	capture := publicationCapture()
	assertions := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{path: {"", false}}, barrierObservations: map[compilerInputKey]string{}}
	for _, kind := range []compilerInputKind{inputFile, inputDirectory, inputMetadata, inputEnumeration, inputRealpath} {
		key := compilerInputKey{path, kind}
		assertions.barrierObservations[key] = observeCompilerInput(capture.compiler.disk, key)
	}
	capture.compilerAssertions = []*governanceCompilerReadAssertions{assertions}
	if ok, _ := capture.Verify(); !ok {
		t.Fatal("original negative lookup changed")
	}
	governanceWrite(t, root, "missing.ts", "before")
	if ok, _ := capture.Verify(); ok {
		t.Fatal("negative lookup hid new source")
	}
	current := publicationCapture()
	current.compiler.ReadFile(path)
	expected := governanceExpectedCapture(current)
	if ok, _ := expected.Verify(); !ok {
		t.Fatal("original authored read failed")
	}
	info, _ := os.Stat(path)
	governanceWrite(t, root, "missing.ts", "after!")
	os.Chtimes(path, info.ModTime(), info.ModTime())
	if ok, _ := expected.Verify(); ok {
		t.Fatal("same-stat bytes or previous barrier authorized edit")
	}
}
func TestPublicationCompilerAliasesAndCustomDelegatesDoNotJoin(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	alias := filepath.Join(root, "alias.ts")
	governanceWrite(t, root, "source.ts", "same")
	if err := os.Symlink(path, alias); err != nil {
		t.Fatal(err)
	}
	world := &governanceBarrierReads{}
	disk := newAuthoredCompilerDisk()
	original := world.compilerReplay(disk)
	for _, p := range []string{path, alias} {
		original.observeActual(compilerInputKey{p, inputFile})
		original.readActual(p)
	}
	if len(original.cells) != 4 || len(world.reads) != 2 {
		t.Fatal("equal target merged distinct logical path operation")
	}
	custom := &publicationReadWitness{FS: disk}
	if world.compilerReplay(custom) == world.compilerReplay(custom) || world.compilerReplay(custom) == original {
		t.Fatal("custom FS borrowed original OS owner")
	}
	disk.decoder = custom
	if governanceOriginalCompilerBarrierOwner(disk) || world.compilerReplay(disk) == original {
		t.Fatal("changed decoder kept original operation contract")
	}
}

type publicationReadWitness struct {
	vfs.FS
	mu    sync.Mutex
	calls int
}

func (disk *publicationReadWitness) ReadFile(path string) (string, bool) {
	disk.mu.Lock()
	disk.calls++
	disk.mu.Unlock()
	return disk.FS.ReadFile(path)
}
func TestPublicationContradictionRejectsBeforeAnyFilesystemCall(t *testing.T) {
	// A private witness is deliberately excluded from original compiler quotient.
	// Conflicting governed obligations still close the publication before this
	// custom receipt can run; it cannot be used as a public source authority.
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "before")
	witness := &publicationReadWitness{FS: newAuthoredCompilerDisk()}
	first := publicationCapture()
	first.compiler.disk = witness
	first.compilerAssertions = []*governanceCompilerReadAssertions{{barrierReads: map[string]compilerRawRead{path: {"before", true}}}}
	first.remember(path, "read", "present:first")
	second := publicationCapture()
	second.remember(path, "read", "present:second")
	if ok, err := governanceVerifyPublication([]*governanceCapture{first, second}); ok || err != nil {
		t.Fatal("contradiction published")
	}
	if witness.calls != 0 {
		t.Fatal("contradiction performed filesystem I/O")
	}
	raw1, raw2 := publicationCapture(), publicationCapture()
	raw1.compilerAssertions = []*governanceCompilerReadAssertions{{barrierReads: map[string]compilerRawRead{path: {"before", true}}}}
	raw2.compilerAssertions = []*governanceCompilerReadAssertions{{barrierReads: map[string]compilerRawRead{path: {"different", true}}}}
	if governanceCompilePublication([]*governanceCapture{raw1, raw2}).consistent {
		t.Fatal("contradictory original raw results accepted")
	}
}
func TestPublicationOriginalFailureOrderRetiresOnlyReachedLease(t *testing.T) {
	root := t.TempDir()
	one, two := filepath.Join(root, "one.ts"), filepath.Join(root, "two.ts")
	governanceWrite(t, root, "one.ts", "current")
	governanceWrite(t, root, "two.ts", "later")
	cache := &governanceTypeDemandCache{entries: map[governanceTypeDemandKey]governanceTypeDemandEntry{}}
	k1, k2 := governanceTypeDemandKey{path: one}, governanceTypeDemandKey{path: two}
	cache.entries[k1] = governanceTypeDemandEntry{}
	cache.entries[k2] = governanceTypeDemandEntry{}
	first, second := publicationCapture(), publicationCapture()
	first.typeCacheLeases = []*governanceTypeCacheLease{newGovernanceTypeCacheLease(cache, k1, &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{one: {"stale", true}}})}
	witness := &publicationReadWitness{FS: second.compiler.disk}
	second.compiler.disk = witness
	second.typeCacheLeases = []*governanceTypeCacheLease{newGovernanceTypeCacheLease(cache, k2, &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{two: {"later", true}}})}
	if ok, _ := governanceVerifyPublication([]*governanceCapture{first, second}); ok {
		t.Fatal("stale first lease accepted")
	}
	if _, seen := cache.entries[k1]; seen {
		t.Fatal("failed original lease retained")
	}
	if _, seen := cache.entries[k2]; !seen || witness.calls != 0 {
		t.Fatal("failure reordered or later lease retired")
	}
}
func TestPublicationCompilerFreshCellsJoinConcurrentConsumers(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "before")
	world := (&governanceBarrierReads{}).compilerReplay(newAuthoredCompilerDisk())
	var group sync.WaitGroup
	for range 24 {
		group.Add(1)
		go func() {
			defer group.Done()
			if value := world.readActual(path); value != (compilerRawRead{"before", true}) {
				t.Error("different raw current result")
			}
			if world.observeActual(compilerInputKey{path, inputFile}) != "present" {
				t.Error("different current lookup")
			}
		}()
	}
	group.Wait()
	if len(world.cells) != 2 {
		t.Fatal("concurrent consumers duplicated original operation")
	}
	// A fresh publication has a distinct lifetime and does not borrow these cells.
	governanceWrite(t, root, "source.ts", "after!")
	next := (&governanceBarrierReads{}).compilerReplay(newAuthoredCompilerDisk())
	if next == world || next.readActual(path).text != "after!" {
		t.Fatal("cross-barrier actual reuse")
	}
}
