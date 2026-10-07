package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// The artifact owner outlives individual physical producers. Publication is a
// writable-envelope rename after complete byte verification of its sealed
// payload directory; no process is prewarmed.
// Each process receives a lease to one actual inode and current verified bytes.
// Permissions isolate routine writers, not an adversarial same-user OS actor.
// The uncached lease checks are replay barriers, not an OS atomic-exec theorem.
type governanceOwnedArtifactLease struct {
	path          string
	file          *os.File
	fileInfo      os.FileInfo
	directoryInfo os.FileInfo
	envelopePath  string
	envelopeInfo  os.FileInfo
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
	}{{l.envelopePath, l.envelopeInfo}, {l.storePath, l.storeInfo}, {l.ownerPath, l.ownerInfo}} {
		current, err := os.Lstat(entry.path)
		if err != nil || !current.IsDir() || !os.SameFile(current, entry.info) || current.Mode().Perm() != entry.info.Mode().Perm() {
			return false
		}
	}
	return true
}

// This read-only inspection runs only after verification rejected the lease.
// These later observations explain a rejection, not an atomic failure cause.
func (l *governanceOwnedArtifactLease) rejectionInspection() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	details := []string{fmt.Sprintf("closed=%t", l.closed)}
	for _, entry := range []struct {
		path string
		info os.FileInfo
	}{{l.path, l.fileInfo}, {filepath.Dir(l.path), l.directoryInfo}, {l.envelopePath, l.envelopeInfo}, {l.storePath, l.storeInfo}, {l.ownerPath, l.ownerInfo}} {
		current, err := os.Lstat(entry.path)
		if err != nil {
			details = append(details, fmt.Sprintf("path=%q lstat=%v", entry.path, err))
			continue
		}
		details = append(details, fmt.Sprintf("path=%q mode=%s size=%d mtime=%s sameFile=%t expectedMode=%s expectedSize=%d expectedMtime=%s", entry.path, current.Mode(), current.Size(), current.ModTime().UTC().Format("2006-01-02T15:04:05.999999999Z"), os.SameFile(current, entry.info), entry.info.Mode(), entry.info.Size(), entry.info.ModTime().UTC().Format("2006-01-02T15:04:05.999999999Z")))
	}
	if len(l.verifyBuf) != len(l.expected) {
		l.verifyBuf = make([]byte, len(l.expected))
	}
	n, err := l.file.ReadAt(l.verifyBuf, 0)
	firstMismatch := -1
	for i := 0; i < n; i++ {
		if l.verifyBuf[i] != l.expected[i] {
			firstMismatch = i
			break
		}
	}
	if firstMismatch == -1 && n < len(l.expected) {
		firstMismatch = n
	}
	details = append(details, fmt.Sprintf("readAtCount=%d expectedCount=%d firstDifferenceOrUnreadOffset=%d", n, len(l.expected), firstMismatch))
	if err != nil {
		return fmt.Errorf("failure inspection after rejection: %s; readAt: %w", strings.Join(details, "; "), err)
	}
	return fmt.Errorf("failure inspection after rejection: %s; readAtError=<nil>", strings.Join(details, "; "))
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
	envelopePath := filepath.Dir(filepath.Dir(path))
	envelopeInfo, err := os.Lstat(envelopePath)
	if err != nil {
		return nil, fmt.Errorf("private artifact envelope lstat: %w", err)
	}
	if !envelopeInfo.IsDir() || envelopeInfo.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("private artifact envelope is not privately writable")
	}
	storePath := filepath.Dir(envelopePath)
	storeInfo, err := os.Lstat(storePath)
	if err != nil {
		return nil, fmt.Errorf("private artifact store lstat: %w", err)
	}
	if !storeInfo.IsDir() || storeInfo.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("private artifact store is not isolated")
	}
	ownerPath := filepath.Dir(storePath)
	ownerInfo, err := os.Lstat(ownerPath)
	if err != nil {
		return nil, fmt.Errorf("private artifact store owner lstat: %w", err)
	}
	if !ownerInfo.IsDir() {
		return nil, fmt.Errorf("private artifact store owner is not a directory")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	current, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("private artifact open file stat: %w", err)
	}
	if !os.SameFile(before, current) {
		file.Close()
		return nil, fmt.Errorf("private artifact inode changed while acquiring")
	}
	lease := &governanceOwnedArtifactLease{path: path, file: file, fileInfo: current, directoryInfo: directory, envelopePath: envelopePath, envelopeInfo: envelopeInfo, storePath: storePath, storeInfo: storeInfo, ownerPath: ownerPath, ownerInfo: ownerInfo, expected: append([]byte(nil), artifact...)}
	if !lease.verify() {
		inspection := lease.rejectionInspection()
		lease.close()
		return nil, fmt.Errorf("private artifact bytes or inode differ: %w", inspection)
	}
	return lease, nil
}

const governanceOwnedArtifactPayloadName = "sealed"

func governanceOwnedArtifactEnvelopePath(store string) string {
	// Old binaries own store/SHA/worker. Their private layout cannot retire this
	// namespace, even when they share the same qualified worker bytes.
	return filepath.Join(store, "envelope-v2-"+governanceOwnedArtifactSHA)
}

// Chmod only the actual directory whose identity the caller observed. Opening
// a replaced symlink may inspect its target, but cannot change that target.
func governanceUnsealOwnedArtifactDirectory(path string, expected os.FileInfo) error {
	before, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !before.IsDir() || !expected.IsDir() || !os.SameFile(before, expected) {
		return fmt.Errorf("private artifact directory identity changed before unsealing")
	}
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	current, err := directory.Stat()
	if err != nil {
		return err
	}
	if !current.IsDir() || !os.SameFile(before, current) {
		return fmt.Errorf("private artifact directory identity changed while unsealing")
	}
	return directory.Chmod(0700)
}

func governanceRemoveOwnedArtifactEnvelope(path string, expected os.FileInfo) error {
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !os.SameFile(current, expected) {
		return fmt.Errorf("private artifact envelope changed before cleanup")
	}
	if !current.IsDir() {
		return os.Remove(path) // Includes symlinks: never remove their target.
	}
	if err := governanceUnsealOwnedArtifactDirectory(path, current); err != nil {
		return err
	}
	payload := filepath.Join(path, governanceOwnedArtifactPayloadName)
	if info, err := os.Lstat(payload); err == nil && info.IsDir() {
		if err := governanceUnsealOwnedArtifactDirectory(payload, info); err != nil {
			return err
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.RemoveAll(path)
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
	envelope := governanceOwnedArtifactEnvelopePath(store)
	path := filepath.Join(envelope, governanceOwnedArtifactPayloadName, governanceOwnedArtifactName)
	var lastFailure error
	for attempt := 0; attempt < 8; attempt++ {
		// Absence precedes the open: a publisher appearing after that observation
		// is a collision to retry, not an invalid capsule to retire.
		observed, inspectErr := os.Lstat(envelope)
		if inspectErr != nil && !os.IsNotExist(inspectErr) {
			return nil, inspectErr
		}
		if lease, err := governanceOpenOwnedArtifact(path, artifact); err == nil {
			return lease, nil
		} else {
			lastFailure = fmt.Errorf("attempt %d current-open %q: %w", attempt+1, path, err)
		}
		if observed != nil {
			// Reopen after an invalid observation, then check its current identity.
			// This reduces cooperative replacement races; it is not an atomic CAS.
			if lease, err := governanceOpenOwnedArtifact(path, artifact); err == nil {
				return lease, nil
			}
			current, err := os.Lstat(envelope)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return nil, err
			}
			if !os.SameFile(observed, current) {
				continue
			}
			if current.IsDir() && current.Mode().Perm() != 0700 {
				if err := governanceUnsealOwnedArtifactDirectory(envelope, current); err != nil {
					lastFailure = fmt.Errorf("attempt %d retirement-unseal %q: %w", attempt+1, envelope, err)
					continue
				}
			}
			retired, err := os.MkdirTemp(store, "retired-")
			if err != nil {
				return nil, err
			}
			os.Remove(retired)
			if err := os.Rename(envelope, retired); err != nil {
				lastFailure = fmt.Errorf("attempt %d retirement-rename %q to %q: %w", attempt+1, envelope, retired, err)
			} else if err := governanceRemoveOwnedArtifactEnvelope(retired, current); err != nil {
				lastFailure = fmt.Errorf("attempt %d retirement-cleanup %q: %w", attempt+1, retired, err)
			}
			continue
		}
		staging, err := os.MkdirTemp(store, "publishing-")
		if err != nil {
			return nil, err
		}
		stagingInfo, err := os.Lstat(staging)
		if err != nil {
			return nil, err
		}
		payload := filepath.Join(staging, governanceOwnedArtifactPayloadName)
		stagedPath := filepath.Join(payload, governanceOwnedArtifactName)
		phase := "payload-mkdir"
		err = os.Mkdir(payload, 0700)
		if err == nil {
			phase = "write"
			err = os.WriteFile(stagedPath, artifact, 0500)
		}
		if err == nil {
			phase = "chmod"
			err = os.Chmod(payload, 0500)
		}
		if err == nil {
			phase = "staged-open"
			var lease *governanceOwnedArtifactLease
			lease, err = governanceOpenOwnedArtifact(stagedPath, artifact)
			if lease != nil {
				lease.close()
			}
		}
		if err == nil {
			phase = "rename"
			err = os.Rename(staging, envelope) // The movable outer directory stays at 0700.
		}
		if err != nil {
			lastFailure = fmt.Errorf("attempt %d %s staged=%q envelope=%q: %w", attempt+1, phase, stagedPath, envelope, err)
			governanceRemoveOwnedArtifactEnvelope(staging, stagingInfo)
			continue
		}
	}
	return nil, fmt.Errorf("private artifact publication did not converge after 8 attempts: %w", lastFailure)
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
