package main

import (
	"os"
	"path/filepath"
	"testing"

	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
)

type barrierDecoderWitness struct {
	shimvfs.FS
	calls int
}

func (disk *barrierDecoderWitness) ReadFile(path string) (string, bool) {
	disk.calls++
	return "second-operation-decoded-value", true
}

func TestGovernanceBarrierReadProjectionsOriginal(t *testing.T) {
	root := t.TempDir()
	cases := map[string][]byte{"empty": {}, "utf8-bom": {0xef, 0xbb, 0xbf, 'a'}, "invalid-utf8": {0xff, 0x00, 0xaa}, "utf16-le": {0xff, 0xfe, 'a', 0, 'x'}, "utf16-be": {0xfe, 0xff, 0, 'a'}, "ordinary": []byte("export const value = 1")}
	for name, bytes := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(root, name)
			if err := os.WriteFile(path, bytes, 0600); err != nil {
				t.Fatal(err)
			}
			world := &governanceBarrierReads{}
			disk := newAuthoredCompilerDisk()
			joined := world.compilerDisk(disk)
			before, present := disk.ReadFile(path)
			after, afterPresent := joined.ReadFile(path)
			if before != after || present != afterPresent {
				t.Fatalf("compiler projection differs %q/%v vs %q/%v", before, present, after, afterPresent)
			}
			for _, follow := range []bool{false, true} {
				key := governanceProbeKey{Path: path, Kind: "read-bytes", FollowLinks: follow}
				if governanceProbeFingerprint(governanceObserveProbe(key)) != governanceProbeFingerprint(governanceObserveProbeWithRead(key, world.read)) {
					t.Fatal("byte probe differs")
				}
			}
			if len(world.reads) != 1 {
				t.Fatalf("shared operations=%d", len(world.reads))
			}
		})
	}
	for _, path := range []string{filepath.Join(root, "missing"), root, filepath.Join(root, "ordinary", "child")} {
		world := &governanceBarrierReads{}
		key := governanceProbeKey{Path: path, Kind: "read-bytes"}
		if governanceProbeFingerprint(governanceObserveProbe(key)) != governanceProbeFingerprint(governanceObserveProbeWithRead(key, world.read)) {
			t.Fatalf("error projection differs: %s", path)
		}
		want, wantOK := newAuthoredCompilerDisk().ReadFile(path)
		got, gotOK := world.compilerDisk(newAuthoredCompilerDisk()).ReadFile(path)
		if want != got || wantOK != gotOK {
			t.Fatal("failed compiler projection differs")
		}
	}
}

func TestGovernanceBarrierUTF16RetainsSecondOwnerOperation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "utf16.ts")
	if err := os.WriteFile(path, []byte{0xff, 0xfe, 'a', 0}, 0600); err != nil {
		t.Fatal(err)
	}
	owner := newAuthoredCompilerDisk()
	decoder := &barrierDecoderWitness{FS: owner.decoder}
	owner.decoder = decoder
	world := &governanceBarrierReads{}
	disk := world.compilerDisk(owner)
	for range 2 {
		text, ok := disk.ReadFile(path)
		if !ok || text != "second-operation-decoded-value" {
			t.Fatal("decoder result inferred from first bytes")
		}
	}
	if decoder.calls != 1 || len(world.reads) != 1 {
		t.Fatalf("decoder=%d first=%d", decoder.calls, len(world.reads))
	}
}

func TestGovernanceBarrierCustomCompilerOwnerExcluded(t *testing.T) {
	custom := &barrierDecoderWitness{FS: newAuthoredCompilerDisk()}
	world := &governanceBarrierReads{}
	disk := world.compilerDisk(custom)
	text, ok := disk.ReadFile("custom-not-os")
	if !ok || text != "second-operation-decoded-value" || custom.calls != 1 || len(world.reads) != 0 {
		t.Fatal("custom operation joined OS owner")
	}
}

func TestGovernanceBarrierConflictingReceiptsAndFreshSeals(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.ts")
	if err := os.WriteFile(path, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	compiler := governanceNewCompilerInputFS(disk)
	capture := &governanceCapture{observations: map[string]governanceObservation{}, compiler: compiler}
	if _, err := capture.read(path); err != nil {
		t.Fatal(err)
	}
	capture.probe(governanceProbeRequest{ID: "bytes", Path: path, Kind: "read-bytes"})
	receipt := &governanceTypeReceipt{barrierReads: map[string]compilerRawRead{path: {"before", true}}}
	capture.typeReceipts = []*governanceTypeReceipt{receipt, receipt}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("equal projections failed %v %v", valid, err)
	}
	if len(compiler.rawReads) != 0 || len(compiler.observed) != 0 {
		t.Fatal("expected receipts became actual observations")
	}
	capture.typeReceipts = append(capture.typeReceipts, &governanceTypeReceipt{barrierReads: map[string]compilerRawRead{path: {"other", true}}})
	if valid, _ := capture.Verify(); valid {
		t.Fatal("conflicting expected projection accepted")
	}
	capture.typeReceipts = []*governanceTypeReceipt{receipt}
	if err := os.WriteFile(path, []byte("edited"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("fresh seal reused previous barrier read")
	}
}

func TestGovernanceBarrierSymlinkRetargetAndFileDirectory(t *testing.T) {
	root := t.TempDir()
	first, second, link := filepath.Join(root, "first"), filepath.Join(root, "second"), filepath.Join(root, "link")
	for path, bytes := range map[string]string{first: "before", second: "after"} {
		if err := os.WriteFile(path, []byte(bytes), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(first, link); err != nil {
		t.Fatal(err)
	}
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	capture.read(link)
	capture.probe(governanceProbeRequest{ID: "bytes", Path: link, Kind: "read-bytes"})
	if ok, _ := capture.Verify(); !ok {
		t.Fatal("unchanged link failed")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(second, link); err != nil {
		t.Fatal(err)
	}
	if ok, _ := capture.Verify(); ok {
		t.Fatal("retargeted bytes accepted")
	}
	if err := os.Remove(first); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(first, 0700); err != nil {
		t.Fatal(err)
	}
	world := &governanceBarrierReads{}
	key := governanceProbeKey{Path: first, Kind: "read-bytes"}
	if governanceProbeFingerprint(governanceObserveProbe(key)) != governanceProbeFingerprint(governanceObserveProbeWithRead(key, world.read)) {
		t.Fatal("file-directory error differs")
	}
}

func TestGovernanceBarrierPermissionsDanglingAndLoopErrors(t *testing.T) {
	root := t.TempDir()
	permission, dangling, loop := filepath.Join(root, "denied"), filepath.Join(root, "dangling"), filepath.Join(root, "loop")
	if err := os.WriteFile(permission, []byte("private"), 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(permission, 0600) })
	if err := os.Symlink(filepath.Join(root, "absent"), dangling); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(loop, loop); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{permission, dangling, loop} {
		world := &governanceBarrierReads{}
		key := governanceProbeKey{Path: path, Kind: "read-bytes"}
		if governanceProbeFingerprint(governanceObserveProbe(key)) != governanceProbeFingerprint(governanceObserveProbeWithRead(key, world.read)) {
			t.Fatalf("error kind/code/message differs for %s", path)
		}
		want, wantOK := newAuthoredCompilerDisk().ReadFile(path)
		got, gotOK := world.compilerDisk(newAuthoredCompilerDisk()).ReadFile(path)
		if want != got || wantOK != gotOK {
			t.Fatal("failed raw compiler projection differs")
		}
	}
}

func TestGovernanceBarrierDoesNotMergePathAliases(t *testing.T) {
	root := t.TempDir()
	path, alias := filepath.Join(root, "source"), filepath.Join(root, "alias")
	if err := os.WriteFile(path, []byte("same bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, alias); err != nil {
		t.Fatal(err)
	}
	world := &governanceBarrierReads{}
	world.read(path)
	world.read(alias)
	if len(world.reads) != 2 {
		t.Fatal("equal bytes/canonical target merged distinct operations")
	}
}
