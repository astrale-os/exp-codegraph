package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"astrale-typespec-v2-native-analysis/sourcepolicy"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
)

type regularityTestFS struct {
	vfs.FS
	info   vfs.FileInfo
	exists bool
	stats  atomic.Int64
}

func (fs *regularityTestFS) Stat(string) vfs.FileInfo {
	fs.stats.Add(1)
	return fs.info
}
func (fs *regularityTestFS) FileExists(string) bool { return fs.exists }

type regularityTestInfo struct {
	vfs.FileInfo
	mode     os.FileMode
	size     int64
	modified time.Time
}

func (info regularityTestInfo) Mode() os.FileMode  { return info.mode }
func (info regularityTestInfo) IsDir() bool       { return info.mode.IsDir() }
func (info regularityTestInfo) Size() int64       { return info.size }
func (info regularityTestInfo) ModTime() time.Time { return info.modified }

func regularityCapture(fs vfs.FS) *governanceCapture {
	return &governanceCapture{observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(fs)}
}

func TestCompilerRegularitySharesCapturedAndFreshStat(t *testing.T) {
	info := regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(1, 0)}
	disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: info, exists: true}
	fs := regularityCapture(disk).compiler
	var workers sync.WaitGroup
	for index := 0; index < 32; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			if index%2 == 0 {
				if fs.regularity("source") != "regular" {
					t.Error("regularity lost")
				}
			} else if inputStat(fs.Stat("source")) != inputStat(info) {
				t.Error("full Stat changed")
			}
		}(index)
	}
	workers.Wait()
	if disk.stats.Load() != 1 {
		t.Fatal("capture duplicated physical Stat", disk.stats.Load())
	}
	if fs.observed[compilerInputKey{"source", inputMetadata}] != inputStat(info) {
		t.Fatal("general Stat lost its full dependency")
	}
	disk.stats.Store(0)
	world := &governanceTypeReplayWorld{disk: disk}
	for index := 0; index < 32; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			kind := inputMetadata
			if index%2 == 0 {
				kind = inputRegularity
			}
			world.observeActual(compilerInputKey{"source", kind})
		}(index)
	}
	workers.Wait()
	if disk.stats.Load() != 1 {
		t.Fatal("fresh publication duplicated physical Stat", disk.stats.Load())
	}
}

func TestCompilerRegularityRetainsNilDirectorySpecialAndCoherence(t *testing.T) {
	cases := []struct {
		name        string
		info        vfs.FileInfo
		exists      bool
		unavailable bool
		regular     bool
	}{
		{"absent", nil, false, false, false},
		{"contradictory-nil", nil, true, true, false},
		{"directory", regularityTestInfo{mode: os.ModeDir}, false, false, false},
		{"contradictory-directory", regularityTestInfo{mode: os.ModeDir}, true, true, false},
		{"special", regularityTestInfo{mode: os.ModeNamedPipe}, true, false, false},
		{"regular", regularityTestInfo{mode: 0600}, true, false, true},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: item.info, exists: item.exists}
			capture := regularityCapture(disk)
			fs := capture.compiler
			if fs.FileExists("source") {
				fs.regularity("source")
			}
			key := compilerInputKey{"source", inputFile}
			fs.mu.Lock()
			row, supported := capture.resolutionInputLocked(key, fs.operations[key], nil)
			fs.mu.Unlock()
			if !supported || (row.Unavailable != "") != item.unavailable {
				t.Fatalf("coherence changed: %#v", row)
			}
			if !item.unavailable && (row.Boolean == nil || *row.Boolean != item.regular) {
				t.Fatalf("wire membership changed: %#v", row)
			}
			if fs.observed[compilerInputKey{"source", inputMetadata}] != "" {
				t.Fatal("membership invented a general Stat dependency")
			}
			if item.exists {
				found := false
				for _, input := range governanceCompileCapturedOperations(capture).inputs {
					if input.key.kind == inputMetadata && input.before == inputStat(item.info) {
						found = true
					}
				}
				if !found {
					t.Fatal("current physical metadata publication guard missing")
				}
			}
		})
	}
}

func TestCompilerRegularityCustomStatProjectionAndFreshRawSeal(t *testing.T) {
	first := regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(1, 0)}
	disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: first, exists: true}
	capture := regularityCapture(disk)
	if capture.compiler.regularity("source") != "regular" {
		t.Fatal("regularity absent")
	}
	for _, after := range []regularityTestInfo{
		{mode: 0600, size: 4, modified: time.Unix(2, 0)},
		{mode: 0600, size: 8, modified: time.Unix(1, 0)},
		{mode: 0644, size: 4, modified: time.Unix(1, 0)},
	} {
		disk.info = after
		if observeCompilerInput(disk, compilerInputKey{"source", inputRegularity}) != "regular" {
			t.Fatal("unused stat field altered regularity")
		}
		disk.stats.Store(0)
		if valid, err := capture.Verify(); err != nil || valid {
			t.Fatalf("raw current Stat change published: %t %v", valid, err)
		}
		if disk.stats.Load() != 1 {
			t.Fatal("custom publication duplicated physical Stat", disk.stats.Load())
		}
	}
	disk.info = first
	disk.stats.Store(0)
	if valid, err := capture.Verify(); err != nil || !valid {
		t.Fatalf("unchanged custom Stat cannot publish: %t %v", valid, err)
	}
	if disk.stats.Load() != 1 {
		t.Fatal("unchanged custom publication duplicated physical Stat")
	}
}

func TestCompilerRegularityExpectedSnapshotRetainsPhysicalStat(t *testing.T) {
	for _, absent := range []bool{false, true} {
		t.Run(map[bool]string{false: "present", true: "absent"}[absent], func(t *testing.T) {
			first := regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(1, 0)}
			disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: first, exists: true}
			if absent {
				disk.info = nil
			}
			capture := regularityCapture(disk)
			capture.compiler.regularity("source")
			expected := governanceExpectedCapture(capture)
			key := compilerInputKey{"source", inputMetadata}
			if _, general := capture.compiler.observed[key]; general {
				t.Fatal("snapshot contaminated semantic receipt prefix")
			}
			if expected.compiler.observed[key] != inputStat(disk.info) {
				t.Fatal("retained expected snapshot lost physical Stat")
			}
			if expected.canonicalCertificate() != capture.canonicalCertificate() {
				t.Fatal("canonical certificate lost physical obligation")
			}
			if valid, err := expected.Verify(); err != nil || !valid {
				t.Fatalf("unchanged expected capture refused: %t %v", valid, err)
			}
			disk.info = regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(2, 0)}
			if valid, err := expected.Verify(); err != nil || valid {
				t.Fatalf("retained expected capture lost full Stat guard: %t %v", valid, err)
			}
		})
	}
}

func TestCompilerRegularityGeneralStatRecordsDependencyBeforeReturn(t *testing.T) {
	info := regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(1, 0)}
	disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: info, exists: true}
	fs := regularityCapture(disk).compiler
	// A completed physical cell alone is not a finished general Stat consumer.
	fs.stat("source")
	key := compilerInputKey{"source", inputMetadata}
	if _, consumed := fs.observed[key]; consumed {
		t.Fatal("physical capture invented Stat consumption")
	}
	if inputStat(fs.Stat("source")) != inputStat(info) || fs.observed[key] != inputStat(info) {
		t.Fatal("completed Stat consumer omitted full dependency")
	}
	if disk.stats.Load() != 1 {
		t.Fatal("general consumer reread completed physical cell")
	}
}

func regularityTypeDemand(t *testing.T, root string, cache *governanceTypeDemandCache, general bool) (*governedProject, sourcepolicy.NamesObservation) {
	t.Helper()
	project, file, node := typeDemandTestProject(t, root, cache)
	path := filepath.Join(root, "queries/independent.ts")
	project.capture.compiler.FileExists(path)
	project.capture.compiler.regularity(path)
	if general {
		project.capture.compiler.Stat(path)
	}
	value := project.typeOwner.names(file, node)
	if project.typeRelease != nil {
		project.typeRelease()
		project.typeRelease = nil
	}
	return project, value
}

func TestCompilerRegularityTypeReceiptSameBytesEditRepairAndTrueStat(t *testing.T) {
	for _, general := range []bool{false, true} {
		t.Run(map[bool]string{false: "membership", true: "general-stat"}[general], func(t *testing.T) {
			root := typeDemandFixture(t)
			cache := &governanceTypeDemandCache{}
			_, old := regularityTypeDemand(t, root, cache, general)
			path := filepath.Join(root, "queries/independent.ts")
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			var receipt *governanceTypeReceipt
			for _, entry := range cache.entries {
				receipt = entry.receipt
			}
			if receipt == nil {
				t.Fatal("original type receipt absent")
			}
			before := sharedTypeReceiptRows(receipt)
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			stamp := info.ModTime().Add(2 * time.Second)
			if err := os.Chtimes(path, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			next, names := regularityTypeDemand(t, root, cache, general)
			if !reflect.DeepEqual(old, names) {
				t.Fatal("same-byte fact changed")
			}
			if general {
				if next.stats.TypeCacheHits != 0 || next.stats.CompilerPrograms != 1 {
					t.Fatal("true full Stat dependency ignored", next.stats)
				}
				return
			}
			if next.stats.TypeCacheHits != 1 || next.stats.CompilerPrograms != 0 {
				t.Fatal("same-byte membership failed replay", next.stats)
			}
			if valid, err := next.capture.Verify(); err != nil || !valid {
				t.Fatalf("same-byte current raw publication failed: %t %v", valid, err)
			}
			governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 12345;`)
			edited, value := regularityTypeDemand(t, root, cache, false)
			if edited.stats.TypeCacheHits != 1 || !reflect.DeepEqual(value, old) {
				t.Fatal("independent size/body edit changed type replay", edited.stats)
			}
			if valid, err := edited.capture.Verify(); err != nil || !valid {
				t.Fatalf("edited current raw publication failed: %t %v", valid, err)
			}
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			repaired, value := regularityTypeDemand(t, root, cache, false)
			if repaired.stats.TypeCacheHits != 1 || repaired.stats.CompilerPrograms != 0 || !reflect.DeepEqual(value, old) {
				t.Fatal("repair failed exact cached fact", repaired.stats)
			}
			if !reflect.DeepEqual(sharedTypeReceiptRows(receipt), before) {
				t.Fatal("replay rebased or mutated old receipt")
			}
			if valid, err := repaired.capture.Verify(); err != nil || !valid {
				t.Fatalf("repair current raw publication failed: %t %v", valid, err)
			}
			stamp = stamp.Add(2 * time.Second)
			if err := os.Chtimes(path, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			if valid, err := repaired.capture.Verify(); err != nil || valid {
				t.Fatalf("mutation before seal survived: %t %v", valid, err)
			}
		})
	}
}

func TestCompilerRegularityCannotMaskNeededReferenceOrGlobalChanges(t *testing.T) {
	cases := []struct{ name, path, text string }{
		{"needed", "schema/value.ts", `export const subject={after:1};`},
		{"reference", "queries/independent.ts", `import type {subject} from '../schema/value.js'; export const independent=2;`},
		{"global", "queries/independent.ts", `const independent=2;`},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			root := typeDemandFixture(t)
			cache := &governanceTypeDemandCache{}
			regularityTypeDemand(t, root, cache, false)
			governanceWrite(t, root, item.path, item.text)
			next, actual := regularityTypeDemand(t, root, cache, false)
			if next.stats.TypeCacheHits != 0 || next.stats.CompilerPrograms != 1 {
				t.Fatal("semantic change hidden by membership", next.stats)
			}
			_, fresh := regularityTypeDemand(t, root, &governanceTypeDemandCache{}, false)
			if !reflect.DeepEqual(actual, fresh) {
				t.Fatal("new owner disagrees with uncached original")
			}
		})
	}
}

func TestCompilerRegularityFreshMembershipTransitions(t *testing.T) {
	for _, change := range []string{"absent", "directory", "special"} {
		t.Run(change, func(t *testing.T) {
			info := regularityTestInfo{mode: 0600}
			disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: info, exists: true}
			capture := regularityCapture(disk)
			capture.compiler.regularity("source")
			switch change {
			case "absent":
				disk.info = nil
			case "directory":
				disk.info = regularityTestInfo{mode: os.ModeDir}
			case "special":
				disk.info = regularityTestInfo{mode: os.ModeNamedPipe}
			}
			if observeCompilerInput(disk, compilerInputKey{"source", inputRegularity}) == "regular" {
				t.Fatal("membership transition erased")
			}
			if valid, err := capture.Verify(); err != nil || valid {
				t.Fatalf("changed membership published: %t %v", valid, err)
			}
		})
	}
}
