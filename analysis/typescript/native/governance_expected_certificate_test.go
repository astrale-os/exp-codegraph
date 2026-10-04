package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFrozenExpectedCertificateRetainsChangingActualCaptureAndBarrierGuards(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "dependency.ts")
	governanceWrite(t, root, "dependency.ts", "before")
	old := &governanceCapture{observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
	old.read(path)
	old.compiler.ReadFile(path)
	expected := governanceExpectedCapture(old)
	current := &governanceCapture{observations: map[string]governanceObservation{}}
	state := &governanceProductsSession{Project: &governedProject{capture: current}, ReplayExpected: expected}
	first := state.currentCertificate()
	assertOriginalComposition := func() {
		t.Helper()
		original := governanceHash([]byte(stableJSON([]string{current.certificate(), "expected-sealed-decisions", state.ReplayExpected.certificate()})))
		if state.currentCertificate() != original {
			t.Fatal("memoized expected owner changed the original current-capture certificate")
		}
	}
	assertOriginalComposition()
	for _, name := range []string{"missing.json", "other.json", "negative.ts"} {
		current.probe(governanceProbeRequest{Kind: "metadata", Path: filepath.Join(root, name), FollowLinks: true})
		assertOriginalComposition()
	}
	if state.currentCertificate() == first {
		t.Fatal("retained expected certificate froze actual current observations")
	}
	governanceWrite(t, root, "dependency.ts", "after!")
	if valid, _ := expected.Verify(); valid {
		t.Fatal("memoized certificate authorized changed hidden producer bytes")
	}
	fresh := &governanceCapture{observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
	fresh.read(path)
	fresh.compiler.ReadFile(path)
	previous := state.currentCertificate()
	state.ReplayExpected = governanceExpectedCapture(fresh)
	assertOriginalComposition()
	if state.currentCertificate() == previous {
		t.Fatal("different immutable expected owner borrowed the old certificate")
	}
	if valid, _ := state.ReplayExpected.Verify(); !valid {
		t.Fatal("new expected owner did not recover after dependency edit")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if valid, _ := state.ReplayExpected.Verify(); valid {
		t.Fatal("retained certificate concealed disappeared producer")
	}
}
