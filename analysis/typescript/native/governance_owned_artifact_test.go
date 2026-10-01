package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func ownedArtifactTestStore(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(func() {
		filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err == nil && d.IsDir() {
				os.Chmod(path, 0700)
			}
			return nil
		})
	})
	return filepath.Join(root, "capsules")
}
func ownedArtifactTestBytes(t *testing.T) []byte {
	t.Helper()
	if *ownedArtifactFixture == "" {
		t.Skip("requires exact qualified original1.81 fixture")
	}
	raw, err := os.ReadFile(*ownedArtifactFixture)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != governanceOwnedArtifactLength || governanceHash(raw) != governanceOwnedArtifactSHA {
		t.Fatal("fixture differs")
	}
	return raw
}
func TestOwnedArtifactReusesInodeWithFreshPhysicalProcesses(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	first, err := governanceNewOwnedProcessWithin(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	info := first.artifact.fileInfo
	instance, pid := first.instance, first.cmd.Process.Pid
	first.input.Close()
	select {
	case <-first.done:
	case <-time.After(5 * time.Second):
		first.close()
		t.Fatal("fresh process did not finish")
	}
	second, err := governanceNewOwnedProcessWithin(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer second.close()
	if !os.SameFile(info, second.artifact.fileInfo) || second.instance == instance || second.cmd.Process.Pid == pid {
		t.Fatal("artifact inode or physical instance ownership differs")
	}
	if first.artifact.verify() || !second.artifact.verify() {
		t.Fatal("lease lifetime leaked across physical processes")
	}
	second.close()
	<-second.done
}
func TestOwnedArtifactWriteRenamePermissionsAndRecovery(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	for _, mode := range []string{"write", "rename-identical", "permissions", "capsule-permissions"} {
		t.Run(mode, func(t *testing.T) {
			store := ownedArtifactTestStore(t)
			lease, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.close()
			original := lease.fileInfo
			path := lease.path
			switch mode {
			case "write":
				os.Chmod(path, 0700)
				altered := append([]byte(nil), raw...)
				altered[len(altered)-1] ^= 1
				if err = os.WriteFile(path, altered, 0500); err != nil {
					t.Fatal(err)
				}
				os.Chmod(path, 0500)
			case "rename-identical":
				directory := filepath.Dir(path)
				os.Chmod(directory, 0700)
				os.Rename(path, path+".old")
				if err = os.WriteFile(path, raw, 0500); err != nil {
					t.Fatal(err)
				}
				os.Chmod(directory, 0500)
			case "permissions":
				os.Chmod(path, 0700)
			case "capsule-permissions":
				os.Chmod(filepath.Dir(path), 0700)
			}
			if lease.verify() {
				t.Fatal("changed executable lease accepted")
			}
			capture := &governanceCapture{ownedGenericArtifact: lease}
			if valid, _ := capture.Verify(); valid {
				t.Fatal("changed artifact sealed actual capture")
			}
			recovered, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.close()
			if !recovered.verify() {
				t.Fatal("artifact recovery did not qualify actual bytes")
			}
			if mode != "rename-identical" && os.SameFile(original, recovered.fileInfo) {
				t.Fatal("corrupted inode revived")
			}
			if lease.verify() {
				t.Fatal("old lease adopted recovered capsule")
			}
		})
	}
	altered := append([]byte(nil), raw...)
	altered[0] ^= 1
	if _, err := governanceAcquireOwnedArtifact(altered, filepath.Join(t.TempDir(), "bad-source")); err == nil {
		t.Fatal("expected digest substituted for corrupt actual source")
	}
}
func TestOwnedArtifactAtomicPublishAndPrivateLeaseBytes(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	leases := make([]*governanceOwnedArtifactLease, 6)
	errs := make([]error, 6)
	var group sync.WaitGroup
	for i := range leases {
		group.Add(1)
		go func() { defer group.Done(); leases[i], errs[i] = governanceAcquireOwnedArtifact(raw, store) }()
	}
	group.Wait()
	for i, l := range leases {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		defer l.close()
		if !l.verify() || !os.SameFile(leases[0].fileInfo, l.fileInfo) {
			t.Fatal("concurrent publication did not join one exact immutable inode")
		}
	}
	raw[0] ^= 1
	for _, l := range leases {
		if !l.verify() {
			t.Fatal("caller changed private immutable artifact expected bytes")
		}
	}
}

func TestOwnedArtifactRetirementDoesNotFollowForeignSymlink(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	if err := os.MkdirAll(store, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := t.TempDir()
	sentinel := filepath.Join(foreign, "sentinel")
	if err := os.WriteFile(sentinel, []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(foreign, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(foreign, 0700) })
	before, err := os.Stat(foreign)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(foreign, filepath.Join(store, governanceOwnedArtifactSHA)); err != nil {
		t.Fatal(err)
	}
	lease, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	after, err := os.Stat(foreign)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(sentinel)
	if err != nil || string(actual) != "foreign" || before.Mode() != after.Mode() || !os.SameFile(before, after) {
		t.Fatal("retirement mutated foreign symlink target")
	}
	if !lease.verify() {
		t.Fatal("foreign capsule was not safely replaced")
	}
}
