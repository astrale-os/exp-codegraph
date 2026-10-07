package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// The artifact owner outlives individual physical producers. Publication is a
// directory rename after complete byte verification; no process is prewarmed.
// Each process receives a lease to one actual inode and current verified bytes.
// Permissions isolate routine writers, not an adversarial same-user OS actor.
// The uncached lease checks are replay barriers, not an OS atomic-exec theorem.
type governanceOwnedArtifactLease struct {
	path          string
	file          *os.File
	fileInfo      os.FileInfo
	directoryInfo os.FileInfo
	storePath     string
	storeInfo     os.FileInfo
	ownerPath     string
	ownerInfo     os.FileInfo
	expected      []byte
	verifyBuf     []byte
	once          sync.Once
	mu            sync.Mutex
	closed        bool
}

func (l *governanceOwnedArtifactLease) close() {
	l.once.Do(func() { l.mu.Lock(); defer l.mu.Unlock(); l.closed = true; l.verifyBuf = nil; l.file.Close() })
}
func (l *governanceOwnedArtifactLease) verify() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || !l.verifyOwner() {
		return false
	}
	now, err := os.Lstat(l.path)
	if err != nil || !now.Mode().IsRegular() || now.Mode().Perm() != 0500 || !os.SameFile(now, l.fileInfo) || now.Size() != l.fileInfo.Size() || !now.ModTime().Equal(l.fileInfo.ModTime()) {
		return false
	}
	directory, err := os.Lstat(filepath.Dir(l.path))
	if err != nil || !directory.IsDir() || directory.Mode().Perm() != 0500 || !os.SameFile(directory, l.directoryInfo) {
		return false
	}
	if len(l.verifyBuf) != len(l.expected) {
		l.verifyBuf = make([]byte, len(l.expected))
	}
	raw := l.verifyBuf
	n, err := l.file.ReadAt(raw, 0)
	if n != len(raw) || (err != nil && err != io.EOF) || !bytes.Equal(raw, l.expected) {
		return false
	}
	after, err := os.Lstat(l.path)
	return err == nil && l.verifyOwner() && os.SameFile(after, l.fileInfo) && after.Mode().Perm() == 0500 && after.ModTime().Equal(l.fileInfo.ModTime()) && after.Size() == l.fileInfo.Size()
}
func (l *governanceOwnedArtifactLease) verifyOwner() bool {
	for _, entry := range []struct {
		path string
		info os.FileInfo
	}{{l.storePath, l.storeInfo}, {l.ownerPath, l.ownerInfo}} {
		current, err := os.Lstat(entry.path)
		if err != nil || !current.IsDir() || !os.SameFile(current, entry.info) || current.Mode().Perm() != entry.info.Mode().Perm() {
			return false
		}
	}
	return true
}
func governanceOpenOwnedArtifact(path string, artifact []byte) (*governanceOwnedArtifactLease, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Mode().Perm() != 0500 {
		return nil, fmt.Errorf("private owned artifact is not a read-only regular file")
	}
	directory, err := os.Lstat(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	if !directory.IsDir() || directory.Mode().Perm() != 0500 {
		return nil, fmt.Errorf("private artifact capsule is not isolated")
	}
	storePath := filepath.Dir(filepath.Dir(path))
	storeInfo, err := os.Lstat(storePath)
	if err != nil || !storeInfo.IsDir() || storeInfo.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("private artifact store is not isolated")
	}
	ownerPath := filepath.Dir(storePath)
	ownerInfo, err := os.Lstat(ownerPath)
	if err != nil || !ownerInfo.IsDir() {
		return nil, fmt.Errorf("private artifact store owner is not a directory")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	current, err := file.Stat()
	if err != nil || !os.SameFile(before, current) {
		file.Close()
		return nil, fmt.Errorf("private artifact inode changed while acquiring")
	}
	lease := &governanceOwnedArtifactLease{path: path, file: file, fileInfo: current, directoryInfo: directory, storePath: storePath, storeInfo: storeInfo, ownerPath: ownerPath, ownerInfo: ownerInfo, expected: append([]byte(nil), artifact...)}
	if !lease.verify() {
		lease.close()
		return nil, fmt.Errorf("private artifact bytes or inode differ")
	}
	return lease, nil
}
func governanceAcquireOwnedArtifact(artifact []byte, store string) (*governanceOwnedArtifactLease, error) {
	// Current actual package bytes, never expected-as-actual worker authority.
	if !governanceQualifiedOwnedArtifact(artifact) {
		return nil, fmt.Errorf("current package bytes differ from the build-qualified worker")
	}
	if err := os.MkdirAll(store, 0700); err != nil {
		return nil, err
	}
	storeInfo, err := os.Lstat(store)
	if err != nil || !storeInfo.IsDir() || storeInfo.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("private artifact store is not isolated")
	}
	capsule := filepath.Join(store, governanceOwnedArtifactSHA)
	path := filepath.Join(capsule, governanceOwnedArtifactName)
	for attempt := 0; attempt < 8; attempt++ {
		if lease, err := governanceOpenOwnedArtifact(path, artifact); err == nil {
			return lease, nil
		}
		if _, err := os.Lstat(capsule); err == nil {
			// Atomic retirement cannot affect a child already mapped from this inode.
			// Its retained lease detects the pathname change and rejects publication.
			retired, err := os.MkdirTemp(store, "retired-")
			if err != nil {
				return nil, err
			}
			os.Remove(retired)
			if err = os.Rename(capsule, retired); err == nil {
				info, inspectErr := os.Lstat(retired)
				if inspectErr == nil && info.IsDir() {
					os.Chmod(retired, 0700)
					os.RemoveAll(retired)
				} else {
					// Includes symlinks: remove this entry, never the target.
					os.Remove(retired)
				}
			}
			continue
		} else if !os.IsNotExist(err) {
			return nil, err
		}
		staging, err := os.MkdirTemp(store, "publishing-")
		if err != nil {
			return nil, err
		}
		stagedPath := filepath.Join(staging, governanceOwnedArtifactName)
		if err = os.WriteFile(stagedPath, artifact, 0500); err == nil {
			err = os.Chmod(staging, 0500)
		}
		if err == nil {
			var lease *governanceOwnedArtifactLease
			lease, err = governanceOpenOwnedArtifact(stagedPath, artifact)
			if lease != nil {
				lease.close()
			}
		}
		if err == nil {
			err = os.Rename(staging, capsule)
		}
		if err != nil {
			os.Chmod(staging, 0700)
			os.RemoveAll(staging)
			continue
		}
	}
	return nil, fmt.Errorf("private artifact publication did not converge")
}

// The immutable package supplies actual bytes. The user's runtime cache owns
// executable capsules; package directories can remain entirely read-only.
// No RPC parameter, project path or artifact descriptor chooses this store.
func governanceOwnedRuntimeArtifactStore() (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(cache) {
		return "", fmt.Errorf("user runtime cache is not absolute")
	}
	return governanceOwnedRuntimeArtifactStoreWithin(cache)
}
func governanceOwnedRuntimeArtifactStoreWithin(cache string) (string, error) {
	if !filepath.IsAbs(cache) {
		return "", fmt.Errorf("user runtime cache is not absolute")
	}
	if err := os.MkdirAll(cache, 0700); err != nil {
		return "", err
	}
	// Create only our entry, then inspect without following a foreign symlink.
	// Existing user cache roots retain their platform permissions.
	owner := filepath.Join(cache, "astrale-codegraph")
	if err := os.Mkdir(owner, 0700); err != nil && !os.IsExist(err) {
		return "", err
	}
	info, err := os.Lstat(owner)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return "", fmt.Errorf("runtime artifact namespace is not privately owned")
	}
	return filepath.Join(owner, "owned-artifacts-v1"), nil
}

type governanceOwnedCapabilityUnavailable struct{ cause error }

func (e *governanceOwnedCapabilityUnavailable) Error() string {
	return fmt.Sprintf("owned runtime artifact capability unavailable: %v", e.cause)
}
func (e *governanceOwnedCapabilityUnavailable) Unwrap() error { return e.cause }
