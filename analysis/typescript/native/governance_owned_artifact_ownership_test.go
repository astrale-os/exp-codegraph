package main

import (
	"os"
	"sync"
	"testing"
)

func TestOwnedArtifactFreshBytesAfterPreservedTimeRewrite(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	lease, err := governanceAcquireOwnedArtifact(raw, ownedArtifactTestStore(t))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	if !lease.verify() {
		t.Fatal("initial current bytes rejected")
	}
	original := lease.fileInfo
	rewrite := func(data []byte) {
		t.Helper()
		if err := os.Chmod(lease.path, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(lease.path, data, 0500); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(lease.path, original.ModTime(), original.ModTime()); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(lease.path, 0500); err != nil {
			t.Fatal(err)
		}
		current, err := os.Lstat(lease.path)
		if err != nil || !os.SameFile(original, current) || current.Size() != original.Size() || !current.ModTime().Equal(original.ModTime()) {
			t.Fatal("fixture did not preserve every file metadata guard")
		}
	}
	altered := append([]byte(nil), raw...)
	altered[len(altered)-1] ^= 1
	rewrite(altered)
	if lease.verify() {
		t.Fatal("old successful bytes authorized same-inode same-length restored-time corruption")
	}
	if valid, _ := (&governanceCapture{ownedGenericArtifact: lease}).Verify(); valid {
		t.Fatal("corrupt current artifact sealed capture")
	}
	rewrite(raw)
	if !lease.verify() {
		t.Fatal("restored bytes could not pass a new fresh read")
	}
	// Retained bytes remain correct, but a failed current descriptor read cannot authorize them.
	if err := lease.file.Close(); err != nil {
		t.Fatal(err)
	}
	if lease.verify() {
		t.Fatal("failed read accepted stale previous successful bytes")
	}
	lease.close()
	if lease.verify() {
		t.Fatal("closed lease remained authoritative")
	}
}

func TestOwnedArtifactCloseDoesNotRetireAnotherLease(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	store := ownedArtifactTestStore(t)
	first, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer first.close()
	second, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer second.close()
	start := make(chan struct{})
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for j := 0; j < 4; j++ {
				first.verify()
				if !second.verify() {
					t.Error("independent live lease lost fresh byte authority")
				}
			}
		}()
	}
	workers.Add(1)
	go func() { defer workers.Done(); <-start; first.close() }()
	close(start)
	workers.Wait()
	if first.verify() || !second.verify() {
		t.Fatal("close/verification lifetime crossed lease ownership")
	}
	first.close()
}
