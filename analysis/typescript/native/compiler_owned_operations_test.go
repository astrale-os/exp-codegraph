package main

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	vfs "github.com/microsoft/typescript-go/shim/vfs"
)

type compilerOwnedCountingFS struct {
	vfs.FS
	reads atomic.Int64
}

func (fs *compilerOwnedCountingFS) ReadFile(path string) (string, bool) {
	fs.reads.Add(1)
	return fs.FS.ReadFile(path)
}

func TestOwnedCompilerReadsJoinConcurrentProducerAndRejectSameStatEdit(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	if err := os.WriteFile(path, []byte("before"), 0644); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	original := &compilerOwnedCountingFS{FS: disk}
	fs := governanceNewCompilerInputFS(original)
	var workers sync.WaitGroup
	for i := 0; i < 32; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			text, ok := fs.ReadFile(path)
			if !ok || text != "before" {
				t.Errorf("mixed captured source: %q %t", text, ok)
			}
		}()
	}
	workers.Wait()
	if original.reads.Load() != 1 {
		t.Fatalf("parallel consumers did not join one producer: %d", original.reads.Load())
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("after!"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if text, ok := fs.ReadFile(path); !ok || text != "before" {
		t.Fatal("capture replaced owned bytes after an edit")
	}
	capture := &governanceCapture{observations: map[string]governanceObservation{}, compiler: fs}
	if valid, err := capture.Verify(); err != nil || valid {
		t.Fatalf("uncached barrier accepted changed bytes: %t %v", valid, err)
	}
	fresh := governanceNewCompilerInputFS(disk)
	if text, ok := fresh.ReadFile(path); !ok || text != "after!" {
		t.Fatal("fresh owner did not recover changed source")
	}
	if valid, err := (&governanceCapture{observations: map[string]governanceObservation{}, compiler: fresh}).Verify(); err != nil || !valid {
		t.Fatalf("fresh owner could not publish: %t %v", valid, err)
	}
}

func TestOwnedCompilerMissingOperationsRemainPrivateUntilActualBarrier(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "appeared.ts")
	disk := newAuthoredCompilerDisk()
	fs := governanceNewCompilerInputFS(disk)
	if fs.FileExists(path) || fs.Stat(path) != nil {
		t.Fatal("missing source appears initially")
	}
	if _, ok := fs.ReadFile(path); ok {
		t.Fatal("missing read became present")
	}
	if err := os.WriteFile(path, []byte("export const appeared=1"), 0644); err != nil {
		t.Fatal(err)
	}
	if fs.FileExists(path) || fs.Stat(path) != nil {
		t.Fatal("negative cell was overwritten")
	}
	if _, ok := fs.ReadFile(path); ok {
		t.Fatal("negative read was overwritten")
	}
	if valid, err := (&governanceCapture{observations: map[string]governanceObservation{}, compiler: fs}).Verify(); err != nil || valid {
		t.Fatalf("appeared file discharged an old negative obligation: %t %v", valid, err)
	}
	fresh := governanceNewCompilerInputFS(disk)
	if !fresh.FileExists(path) || fresh.Stat(path) == nil {
		t.Fatal("new owner did not recover appeared file")
	}
}

func TestOwnedCompilerEnumerationConsumersCannotMutateRetainedMembership(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	if err := os.WriteFile(path, []byte("export {}"), 0644); err != nil {
		t.Fatal(err)
	}
	fs := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	first := fs.GetAccessibleEntries(root)
	if len(first.Files) != 1 || first.Files[0] != "source.ts" {
		t.Fatalf("original entries=%#v", first)
	}
	first.Files[0] = "forged.ts"
	if current := fs.GetAccessibleEntries(root); len(current.Files) != 1 || current.Files[0] != "source.ts" {
		t.Fatalf("consumer poisoned owned membership=%#v", current)
	}
	if valid, err := (&governanceCapture{observations: map[string]governanceObservation{}, compiler: fs}).Verify(); err != nil || !valid {
		t.Fatalf("untouched original membership did not seal: %t %v", valid, err)
	}
}

func TestLegacyCompilerOperationReplacementRemainsCurrent(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	disk := newAuthoredCompilerDisk()
	fs := newCompilerInputFS(disk, disk)
	if fs.FileExists(path) {
		t.Fatal("missing source appears initially")
	}
	if err := os.WriteFile(path, []byte("current"), 0644); err != nil {
		t.Fatal(err)
	}
	if !fs.FileExists(path) {
		t.Fatal("legacy explicit generations retained a negative decision cell")
	}
	if _, ok := fs.ReadFile(path); !ok {
		t.Fatal("legacy source read did not recover")
	}
}
