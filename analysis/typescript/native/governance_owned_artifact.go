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
	expected      []byte
	once          sync.Once
	mu            sync.Mutex
	closed        bool
}

func (l *governanceOwnedArtifactLease) close() {
	l.once.Do(func() { l.mu.Lock(); defer l.mu.Unlock(); l.closed = true; l.file.Close() })
}
func (l *governanceOwnedArtifactLease) verify() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
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
	raw := make([]byte, len(l.expected))
	n, err := l.file.ReadAt(raw, 0)
	if n != len(raw) || (err != nil && err != io.EOF) || !bytes.Equal(raw, l.expected) {
		return false
	}
	after, err := os.Lstat(l.path)
	return err == nil && os.SameFile(after, l.fileInfo) && after.Mode().Perm() == 0500 && after.ModTime().Equal(l.fileInfo.ModTime()) && after.Size() == l.fileInfo.Size()
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
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	current, err := file.Stat()
	if err != nil || !os.SameFile(before, current) {
		file.Close()
		return nil, fmt.Errorf("private artifact inode changed while acquiring")
	}
	lease := &governanceOwnedArtifactLease{path: path, file: file, fileInfo: current, directoryInfo: directory, expected: append([]byte(nil), artifact...)}
	if !lease.verify() {
		lease.close()
		return nil, fmt.Errorf("private artifact bytes or inode differ")
	}
	return lease, nil
}
func governanceAcquireOwnedArtifact(artifact []byte, store string) (*governanceOwnedArtifactLease, error) {
	// Current actual package bytes, never expected-as-actual worker authority.
	if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		return nil, fmt.Errorf("current package bytes differ from original qualified worker")
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
