//go:build darwin || linux

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// The helper intentionally keeps stdin open. EOF cleanup cannot demonstrate
// that a controller relays a termination signal while owning a real worker.
func TestOwnedSignalHelper(t *testing.T) {
	mode := os.Getenv("ASTRALE_OWNED_SIGNAL_TEST_HELPER")
	if mode == "" {
		return
	}
	var producer *governanceOwnedProcess
	if mode == "managed" {
		raw := ownedArtifactTestBytes(t)
		owner := governanceNewOwnedSessionSignals()
		var err error
		producer, err = owner.start(raw)
		if err != nil {
			t.Fatal(err)
		}
		defer owner.stop()
	}
	pid := 0
	if producer != nil {
		pid = producer.cmd.Process.Pid
	}
	fmt.Printf("{\"controller\":%d,\"producer\":%d}\n", os.Getpid(), pid)
	os.Stdin.Read(make([]byte, 1))
}

// Compare the exact wait status to Go's original unmodified signal behavior,
// with a pinned original Rust process present in the owned case.
func TestOwnedSessionSignalPreservesOriginalTermination(t *testing.T) {
	ownedArtifactTestBytes(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(filepath.Dir(executable), ".owned-artifacts-v1")
	t.Cleanup(func() {
		// This capsule was created only below the helper's private test executable.
		filepath.WalkDir(store, func(path string, d os.DirEntry, err error) error {
			if err == nil && d.IsDir() {
				os.Chmod(path, 0700)
			}
			return nil
		})
		os.RemoveAll(store)
	})
	for _, sig := range []syscall.Signal{syscall.SIGTERM, syscall.SIGINT} {
		for _, mode := range []string{"baseline", "managed"} {
			t.Run(fmt.Sprintf("%s/%s", sig, mode), func(t *testing.T) {
				cmd := exec.Command(executable, "-test.run=^TestOwnedSignalHelper$", "-owned-artifact="+*ownedArtifactFixture)
				cmd.Env = append(os.Environ(), "ASTRALE_OWNED_SIGNAL_TEST_HELPER="+mode)
				input, err := cmd.StdinPipe()
				if err != nil {
					t.Fatal(err)
				}
				defer input.Close()
				output, err := cmd.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				cmd.Stderr = os.Stderr
				if err = cmd.Start(); err != nil {
					t.Fatal(err)
				}
				defer cmd.Process.Kill()
				var ready struct {
					Controller int
					Producer   int
				}
				line, err := bufio.NewReader(output).ReadBytes('\n')
				if err != nil {
					t.Fatal(err)
				}
				if err = json.Unmarshal(line, &ready); err != nil {
					t.Fatal(err)
				}
				if ready.Controller != cmd.Process.Pid || (mode == "managed" && ready.Producer == 0) {
					t.Fatal("physical process identity missing")
				}
				start := time.Now()
				if err = cmd.Process.Signal(sig); err != nil {
					t.Fatal(err)
				}
				result := make(chan error, 1)
				go func() { result <- cmd.Wait() }()
				select {
				case err = <-result:
				case <-time.After(time.Second):
					t.Fatal("termination signal swallowed while stdin was left open")
				}
				status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
				if !ok || !status.Signaled() || status.Signal() != sig {
					t.Fatalf("original termination status changed: %v %v", cmd.ProcessState, err)
				}
				if ready.Producer != 0 {
					deadline := time.Now().Add(100 * time.Millisecond)
					for syscall.Kill(ready.Producer, 0) == nil && time.Now().Before(deadline) {
						time.Sleep(time.Millisecond)
					}
					if syscall.Kill(ready.Producer, 0) == nil {
						t.Fatal("owned Rust process outlived the terminated controller")
					}
				}
				t.Logf("stdin open; original %s status preserved; controller and worker ended in %s", sig, time.Since(start))
			})
		}
	}
}

func TestOwnedSessionStopClosesAllRegisteredLifetimes(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(filepath.Dir(executable), ".owned-artifacts-v1")
	t.Cleanup(func() {
		filepath.WalkDir(store, func(path string, d os.DirEntry, err error) error {
			if err == nil && d.IsDir() {
				os.Chmod(path, 0700)
			}
			return nil
		})
		os.RemoveAll(store)
	})
	raw := ownedArtifactTestBytes(t)
	owner := governanceNewOwnedSessionSignals()
	defer owner.stop()
	first, err := owner.start(raw)
	if err != nil {
		t.Fatal(err)
	}
	// A closed producer may still be awaiting its physical process exit when a
	// new producer is launched. Both lifetimes remain owned until cmd.Wait.
	first.close()
	second, err := owner.start(raw)
	if err != nil {
		t.Fatal(err)
	}
	owner.stop()
	for _, child := range []*governanceOwnedProcess{first, second} {
		select {
		case <-child.done:
		case <-time.After(time.Second):
			t.Fatal("registered physical producer survived session shutdown")
		}
		if child.artifact.verify() {
			t.Fatal("terminated producer lease revived")
		}
	}
	if child, err := owner.start(raw); child != nil || err == nil {
		t.Fatal("terminating session launched a new producer")
	}
	owner.stop()
}
