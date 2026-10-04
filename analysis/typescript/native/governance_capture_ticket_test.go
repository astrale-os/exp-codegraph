package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCaptureOwnedBytesRemainCoherentUntilFinalUncachedBarrier(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "old")
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	old, err := capture.read(path)
	if err != nil {
		t.Fatal(err)
	}
	old[0] = 'X'
	governanceWrite(t, root, "source.ts", "new")
	retained, err := capture.read(path)
	if err != nil || string(retained) != "old" {
		t.Fatalf("retained=%q err=%v", retained, err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("same-size edit survived final raw byte barrier")
	}
	absent := filepath.Join(root, "absent.json")
	negative := &governanceCapture{observations: map[string]governanceObservation{}}
	if _, err := negative.read(absent); !os.IsNotExist(err) {
		t.Fatal("missing negative cell")
	}
	governanceWrite(t, root, "absent.json", "{}")
	if _, err := negative.read(absent); !os.IsNotExist(err) {
		t.Fatal("negative capture changed inside private generation")
	}
	if valid, _ := negative.Verify(); valid {
		t.Fatal("appeared file survived negative-cell final barrier")
	}
}
func TestPrivateCaptureTicketRevisionIsNotCanonicalHashOrCrossOwnerIdentity(t *testing.T) {
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	first := capture.semanticTicket()
	canonical := capture.canonicalCertificate()
	if first == canonical || first != capture.semanticTicket() {
		t.Fatal("ticket is not a retained private revision")
	}
	capture.remember("x", "read", "absent")
	second := capture.semanticTicket()
	if first == second {
		t.Fatal("new observation did not advance owner revision")
	}
	capture.remember("x", "read", "absent")
	if second != capture.semanticTicket() {
		t.Fatal("same immutable cell advanced revision")
	}
	other := &governanceCapture{observations: map[string]governanceObservation{}}
	other.remember("x", "read", "absent")
	if capture.canonicalCertificate() != other.canonicalCertificate() || capture.semanticTicket() == other.semanticTicket() {
		t.Fatal("private owner identity conflated with content equality")
	}
	capture.remember("x", "read", "present:conflict")
	if second == capture.semanticTicket() {
		t.Fatal("conflict did not invalidate ticket")
	}
}

func TestCapturedReadErrorRetainsFirstFailureAndFinalBarrierDetectsRecovery(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "was-directory")
	if err := os.Mkdir(path, 0755); err != nil {
		t.Fatal(err)
	}
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	if _, err := capture.read(path); err == nil {
		t.Fatal("directory read must fail")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("recovered"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := capture.read(path); err == nil {
		t.Fatal("private error cell changed before retry")
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("recovered read failure survived final barrier")
	}
}
