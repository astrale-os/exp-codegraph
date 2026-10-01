package main

import (
	"errors"
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

func TestOwnedRuntimeStoreIsOwnedByUserCacheNotPackage(t *testing.T) {
	cache, err := os.UserCacheDir()
	if err != nil {
		t.Skip("platform user cache unavailable")
	}
	store, err := governanceOwnedRuntimeArtifactStore()
	if err != nil {
		t.Fatal(err)
	}
	if store != filepath.Join(cache, "astrale-codegraph", "owned-artifacts-v1") {
		t.Fatal("runtime store lost its platform owner")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(store) == filepath.Dir(executable) || store == filepath.Join(filepath.Dir(executable), ".owned-artifacts-v1") {
		t.Fatal("immutable package owns mutable runtime state")
	}
}

func TestOwnedUnavailableCacheCannotBecomeSourceAuthority(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	root := ownedArtifactTestStore(t)
	if err := os.WriteFile(root, []byte("occupied cache entry"), 0600); err != nil {
		t.Fatal(err)
	}
	producer, err := governanceNewOwnedProcessWithin(raw, root)
	var unavailable *governanceOwnedCapabilityUnavailable
	if producer != nil || !errors.As(err, &unavailable) {
		t.Fatalf("unavailable runtime cache was not classified: %v", err)
	}
	producer, err = governanceNewOwnedProcessWithin([]byte("forged source worker"), root)
	if producer != nil || err == nil || errors.As(err, &unavailable) {
		t.Fatal("source identity failure was silently normalized into runtime capability failure")
	}
	if actual, _ := os.ReadFile(root); string(actual) != "occupied cache entry" {
		t.Fatal("foreign store entry changed")
	}
}

func TestOwnedRuntimeNamespaceDoesNotFollowForeignEntry(t *testing.T) {
	for _, mode := range []string{"symlink", "permissions", "file"} {
		t.Run(mode, func(t *testing.T) {
			cache := t.TempDir()
			foreign := t.TempDir()
			sentinel := filepath.Join(foreign, "sentinel")
			if err := os.WriteFile(sentinel, []byte("foreign owner bytes"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(foreign, 0500); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.Chmod(foreign, 0700) })
			before, _ := os.Stat(foreign)
			namespace := filepath.Join(cache, "astrale-codegraph")
			var err error
			switch mode {
			case "symlink":
				err = os.Symlink(foreign, namespace)
			case "permissions":
				err = os.Mkdir(namespace, 0755)
			case "file":
				err = os.WriteFile(namespace, []byte("occupied"), 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = governanceOwnedRuntimeArtifactStoreWithin(cache); err == nil {
				t.Fatal("foreign runtime namespace accepted")
			}
			after, _ := os.Stat(foreign)
			actual, err := os.ReadFile(sentinel)
			if err != nil || string(actual) != "foreign owner bytes" || before.Mode() != after.Mode() || !os.SameFile(before, after) {
				t.Fatal("foreign runtime namespace target changed")
			}
		})
	}
}
func TestOwnedArtifactStoreAndOwnerRemainCurrentThroughSeal(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	for _, mode := range []string{"store-permissions", "store-rename", "store-symlink", "owner-permissions", "owner-rename"} {
		t.Run(mode, func(t *testing.T) {
			cache := ownedArtifactTestStore(t)
			owner := filepath.Join(cache, "astrale-codegraph")
			if err := os.MkdirAll(owner, 0700); err != nil {
				t.Fatal(err)
			}
			store := filepath.Join(owner, "owned-artifacts-v1")
			lease, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.close()
			switch mode {
			case "store-permissions":
				err = os.Chmod(store, 0755)
			case "store-rename":
				err = os.Rename(store, store+".old")
				if err == nil {
					err = os.Mkdir(store, 0700)
				}
			case "store-symlink":
				err = os.Rename(store, store+".old")
				if err == nil {
					err = os.Symlink(store+".old", store)
				}
			case "owner-permissions":
				err = os.Chmod(owner, 0755)
			case "owner-rename":
				err = os.Rename(owner, owner+".old")
				if err == nil {
					err = os.Mkdir(owner, 0700)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if lease.verify() {
				t.Fatal("changed runtime owner sealed artifact")
			}
			capture := &governanceCapture{ownedGenericArtifact: lease}
			if valid, _ := capture.Verify(); valid {
				t.Fatal("changed runtime owner published capture")
			}
		})
	}
}
