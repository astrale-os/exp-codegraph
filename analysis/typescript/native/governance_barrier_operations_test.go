package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGovernanceBarrierOperationVectorRetainsIndependentGuards(t *testing.T) {
	root := t.TempDir()
	capture := &governanceCapture{observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
	encodings := [][]byte{
		[]byte("before"), {0xef, 0xbb, 0xbf, 'b'}, {0xff, 'b'}, {},
		compilerObservationUTF16("before", binary.LittleEndian),
		compilerObservationUTF16("before", binary.BigEndian), {0xff, 0xfe, 'b'},
	}
	paths := []string{}
	for index, bytes := range encodings {
		path := filepath.Join(root, fmt.Sprintf("source-%d.ts", index))
		if err := os.WriteFile(path, bytes, 0600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
		if _, err := capture.read(path); err != nil {
			t.Fatal(err)
		}
		capture.compiler.ReadFile(path)
		capture.compiler.FileExists(path)
		capture.compiler.Stat(path)
		for _, kind := range []string{"read-bytes", "metadata", "canonicalize", "content-digest"} {
			capture.probe(governanceProbeRequest{Kind: kind, Path: path, FollowLinks: kind == "metadata"})
		}
	}
	missing := filepath.Join(root, "missing.ts")
	capture.read(missing)
	capture.compiler.ReadFile(missing)
	capture.compiler.FileExists(missing)
	capture.compiler.Stat(missing)
	capture.probe(governanceProbeRequest{Kind: "metadata", Path: missing, FollowLinks: true})
	if _, err := capture.directory(root); err != nil {
		t.Fatal(err)
	}
	capture.compiler.DirectoryExists(root)
	capture.compiler.GetAccessibleEntries(root)
	capture.probe(governanceProbeRequest{Kind: "directory", Path: root})
	assertSeal := func(want bool) {
		t.Helper()
		for repeat := 0; repeat < 2; repeat++ {
			valid, err := capture.Verify()
			if err != nil || valid != want {
				t.Fatalf("fresh operation-vector seal = %v, %v; want %v", valid, err, want)
			}
		}
	}
	assertSeal(true)
	for index, path := range paths {
		before, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		changed := append([]byte(nil), encodings[index]...)
		if len(changed) == 0 {
			changed = []byte("a")
		} else {
			changed[len(changed)-1] ^= 1
		}
		if err := os.WriteFile(path, changed, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
			t.Fatal(err)
		}
		assertSeal(false)
		if err := os.WriteFile(path, encodings[index], 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
			t.Fatal(err)
		}
		assertSeal(true)
	}
	if err := os.WriteFile(missing, []byte("appeared"), 0600); err != nil {
		t.Fatal(err)
	}
	assertSeal(false)
	if err := os.Remove(missing); err != nil {
		t.Fatal(err)
	}
	assertSeal(true)
}

func TestGovernanceBarrierOperationWorkersJoinBeforePublication(t *testing.T) {
	disk := newAuthoredCompilerDisk()
	gated := &compilerGatedObservationFS{FS: disk.FS, entered: make(chan struct{}, 32), release: make(chan struct{})}
	disk.FS = gated
	compiler := governanceNewCompilerInputFS(disk)
	for index := 0; index < 32; index++ {
		compiler.observed[compilerInputKey{path: fmt.Sprintf("missing-%d", index), kind: inputFile}] = "absent"
	}
	capture := &governanceCapture{compiler: compiler}
	completed := make(chan bool, 1)
	go func() { valid, _ := capture.Verify(); completed <- valid }()
	released := false
	defer func() {
		if !released {
			close(gated.release)
		}
	}()
	for index := 0; index < compilerObservationWorkers; index++ {
		select {
		case <-gated.entered:
		case <-time.After(5 * time.Second):
			t.Fatal("bounded barrier workers did not enter")
		}
	}
	select {
	case <-completed:
		t.Fatal("seal returned while original operations remained active")
	default:
	}
	close(gated.release)
	released = true
	select {
	case valid := <-completed:
		if !valid {
			t.Fatal("independent original negative guards were lost")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("seal did not join original operations")
	}
	if gated.active.Load() != 0 || gated.calls.Load() != 32 || gated.maximum.Load() > compilerObservationWorkers {
		t.Fatalf("barrier did not own bounded joined workers: active=%d calls=%d maximum=%d", gated.active.Load(), gated.calls.Load(), gated.maximum.Load())
	}
}
