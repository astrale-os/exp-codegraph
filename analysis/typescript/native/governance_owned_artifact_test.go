package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
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

// Exercise each publication phase with the actual qualified fixture, without
// starting Rust, so a platform failure reports its original operation error.
func TestOwnedArtifactStagedPublication(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	if err := os.MkdirAll(store, 0700); err != nil {
		t.Fatalf("store mkdir: %v", err)
	}
	staging, err := os.MkdirTemp(store, "publishing-")
	if err != nil {
		t.Fatalf("staging mkdir: %v", err)
	}
	payload := filepath.Join(staging, governanceOwnedArtifactPayloadName)
	if err := os.Mkdir(payload, 0700); err != nil {
		t.Fatalf("payload mkdir: %v", err)
	}
	stagedPath := filepath.Join(payload, governanceOwnedArtifactName)
	if err := os.WriteFile(stagedPath, raw, 0500); err != nil {
		t.Fatalf("write %q: %v", stagedPath, err)
	}
	if err := os.Chmod(payload, 0500); err != nil {
		t.Fatalf("chmod %q: %v", payload, err)
	}
	staged, err := governanceOpenOwnedArtifact(stagedPath, raw)
	if err != nil {
		t.Fatalf("staged-open %q: %v", stagedPath, err)
	}
	original, originalPayload, originalEnvelope := staged.fileInfo, staged.directoryInfo, staged.envelopeInfo
	if original.Mode().Perm() != 0500 || originalPayload.Mode().Perm() != 0500 || originalEnvelope.Mode().Perm() != 0700 {
		t.Fatal("staging did not seal the payload inside a movable envelope")
	}
	staged.close()
	capsule := governanceOwnedArtifactEnvelopePath(store)
	if err := os.Rename(staging, capsule); err != nil {
		t.Fatalf("rename %q to %q: %v", staging, capsule, err)
	}
	published, err := governanceOpenOwnedArtifact(filepath.Join(capsule, governanceOwnedArtifactPayloadName, governanceOwnedArtifactName), raw)
	if err != nil {
		t.Fatalf("published-open %q: %v", capsule, err)
	}
	defer published.close()
	if !os.SameFile(original, published.fileInfo) || !os.SameFile(originalPayload, published.directoryInfo) || !os.SameFile(originalEnvelope, published.envelopeInfo) || !published.verify() {
		t.Fatal("publication changed the verified inode or bytes")
	}
}

func TestOwnedArtifactRejectionInspection(t *testing.T) {
	// Opening is intentionally independent of the build-qualified byte gate;
	// small actual filesystem fixtures exercise the rejection diagnostic itself.
	store := ownedArtifactTestStore(t)
	capsule := filepath.Join(store, "fixture", governanceOwnedArtifactPayloadName)
	if err := os.MkdirAll(capsule, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(capsule, "worker")
	if err := os.WriteFile(path, []byte("abc"), 0500); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(capsule, 0500); err != nil {
		t.Fatal(err)
	}
	lease, err := governanceOpenOwnedArtifact(path, []byte("abx"))
	if lease != nil || err == nil {
		t.Fatal("different bytes were admitted")
	}
	for _, detail := range []string{"failure inspection after rejection", "sameFile=true", "readAtCount=3 expectedCount=3 firstDifferenceOrUnreadOffset=2", "readAtError=<nil>"} {
		if !strings.Contains(err.Error(), detail) {
			t.Fatalf("missing %q in %v", detail, err)
		}
	}
	lease, err = governanceOpenOwnedArtifact(path, []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	if err := lease.file.Close(); err != nil {
		t.Fatal(err)
	}
	if lease.verify() {
		t.Fatal("closed file was admitted")
	}
	inspection := lease.rejectionInspection()
	if !errors.Is(inspection, os.ErrClosed) || !strings.Contains(inspection.Error(), "readAtCount=0 expectedCount=3 firstDifferenceOrUnreadOffset=0") {
		t.Fatalf("original read error or count missing: %v", inspection)
	}
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
	if err = os.Symlink(foreign, governanceOwnedArtifactEnvelopePath(store)); err != nil {
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

func TestOwnedArtifactEnvelopeGuardsAndRecovery(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	for _, mode := range []string{"permissions", "symlink-to-old-envelope"} {
		t.Run(mode, func(t *testing.T) {
			store := ownedArtifactTestStore(t)
			lease, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.close()
			envelope := lease.envelopePath
			if mode == "permissions" {
				if err := os.Chmod(envelope, 0500); err != nil {
					t.Fatal(err)
				}
			} else {
				old := envelope + ".old"
				if err := os.Rename(envelope, old); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(old, envelope); err != nil {
					t.Fatal(err)
				}
				// The same payload and worker still resolve through this alias.
				current, err := os.Lstat(lease.path)
				if err != nil || !os.SameFile(current, lease.fileInfo) {
					t.Fatal("alias did not retain worker identity")
				}
				payload, err := os.Lstat(filepath.Dir(lease.path))
				if err != nil || !os.SameFile(payload, lease.directoryInfo) {
					t.Fatal("alias did not retain payload identity")
				}
			}
			if lease.verify() {
				t.Fatal("changed envelope authorized unchanged worker bytes")
			}
			if valid, _ := (&governanceCapture{ownedGenericArtifact: lease}).Verify(); valid {
				t.Fatal("changed envelope sealed capture")
			}
			recovered, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.close()
			if !recovered.verify() || lease.verify() {
				t.Fatal("recovery crossed envelope lifetime")
			}
		})
	}
}

func TestOwnedArtifactInnerSymlinkRecoveryDoesNotChangeForeignTarget(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	envelope := governanceOwnedArtifactEnvelopePath(store)
	if err := os.MkdirAll(envelope, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := t.TempDir()
	path := filepath.Join(foreign, governanceOwnedArtifactName)
	if err := os.WriteFile(path, raw, 0500); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(foreign, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(foreign, 0700) })
	before, err := os.Lstat(foreign)
	if err != nil {
		t.Fatal(err)
	}
	workerBefore, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(foreign, filepath.Join(envelope, governanceOwnedArtifactPayloadName)); err != nil {
		t.Fatal(err)
	}
	lease, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	after, err := os.Lstat(foreign)
	if err != nil || !os.SameFile(before, after) || after.Mode() != before.Mode() {
		t.Fatal("foreign payload directory changed")
	}
	workerAfter, err := os.Lstat(path)
	actual, readErr := os.ReadFile(path)
	if err != nil || readErr != nil || !os.SameFile(workerBefore, workerAfter) || workerAfter.Mode() != workerBefore.Mode() || governanceHash(actual) != governanceHash(raw) {
		t.Fatal("foreign worker changed")
	}
	if !lease.verify() {
		t.Fatal("owned replacement did not verify")
	}
}

func TestOwnedArtifactPublicationCrashStatesRecover(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	for _, state := range []string{"abandoned-staging", "published-before-acquire"} {
		t.Run(state, func(t *testing.T) {
			store := ownedArtifactTestStore(t)
			staging := filepath.Join(store, "publishing-abandoned")
			payload := filepath.Join(staging, governanceOwnedArtifactPayloadName)
			if err := os.MkdirAll(payload, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(payload, governanceOwnedArtifactName)
			if state == "abandoned-staging" {
				if err := os.WriteFile(path, []byte("incomplete"), 0500); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.WriteFile(path, raw, 0500); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(payload, 0500); err != nil {
					t.Fatal(err)
				}
				staged, err := governanceOpenOwnedArtifact(path, raw)
				if err != nil {
					t.Fatal(err)
				}
				staged.close()
				if err := os.Rename(staging, governanceOwnedArtifactEnvelopePath(store)); err != nil {
					t.Fatal(err)
				}
				path = filepath.Join(governanceOwnedArtifactEnvelopePath(store), governanceOwnedArtifactPayloadName, governanceOwnedArtifactName)
			}
			before, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			lease, err := governanceAcquireOwnedArtifact(raw, store)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.close()
			if !lease.verify() {
				t.Fatal("crash-state recovery did not verify")
			}
			if state == "published-before-acquire" && !os.SameFile(before, lease.fileInfo) {
				t.Fatal("complete published worker was replaced")
			}
			if state == "abandoned-staging" {
				actual, err := os.ReadFile(path)
				if err != nil || string(actual) != "incomplete" {
					t.Fatal("unpublished staging became source authority or was changed")
				}
			}
		})
	}
}

func TestOwnedArtifactOldFlatNamespaceCoexistsUnchanged(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	old := filepath.Join(store, governanceOwnedArtifactSHA)
	if err := os.MkdirAll(old, 0700); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(old, governanceOwnedArtifactName)
	if err := os.WriteFile(oldPath, raw, 0500); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(old, 0500); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(old)
	if err != nil {
		t.Fatal(err)
	}
	workerBefore, err := os.Lstat(oldPath)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	after, err := os.Lstat(old)
	actual, readErr := os.ReadFile(oldPath)
	workerAfter, workerErr := os.Lstat(oldPath)
	if err != nil || readErr != nil || workerErr != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || !os.SameFile(workerBefore, workerAfter) || workerBefore.Mode() != workerAfter.Mode() || governanceHash(actual) != governanceHash(raw) {
		t.Fatal("old binary namespace changed")
	}
	if lease.envelopePath == old || !lease.verify() {
		t.Fatal("new publication used old namespace")
	}
}

func TestOwnedArtifactUnsealRejectsForeignDirectoryIdentity(t *testing.T) {
	for _, kind := range []string{"replacement-directory", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := ownedArtifactTestStore(t)
			path := filepath.Join(root, "observed")
			if err := os.MkdirAll(path, 0700); err != nil {
				t.Fatal(err)
			}
			expected, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(path, path+".old"); err != nil {
				t.Fatal(err)
			}
			foreign := path
			if kind == "symlink" {
				foreign = filepath.Join(root, "foreign")
			}
			if err := os.Mkdir(foreign, 0500); err != nil {
				t.Fatal(err)
			}
			if kind == "symlink" {
				if err := os.Symlink(foreign, path); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.Lstat(foreign)
			if err != nil {
				t.Fatal(err)
			}
			if err := governanceUnsealOwnedArtifactDirectory(path, expected); err == nil {
				t.Fatal("foreign directory identity was unsealed")
			}
			after, err := os.Lstat(foreign)
			if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() {
				t.Fatal("foreign directory identity or modes changed")
			}
		})
	}
}
