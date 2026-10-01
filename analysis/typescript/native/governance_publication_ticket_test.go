package main

import "testing"

func TestPublicationTicketNamesOwnedActualAndExpectedState(t *testing.T) {
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	initial := capture.certificate()
	if initial != capture.certificate() {
		t.Fatal("unchanged private state changed its publication ticket")
	}
	capture.remember("/captured/source", "read", "present:first")
	actual := capture.certificate()
	if actual == initial {
		t.Fatal("new actual observation retained a stale publication ticket")
	}
	capture.typeReceipts = append(capture.typeReceipts, &governanceTypeReceipt{})
	proposed := capture.certificate()
	if proposed == actual || len(capture.observations) != 1 {
		t.Fatal("private expected obligations must change the ticket without forging actual observations")
	}
	capture.remember("/captured/source", "read", "present:first")
	if proposed != capture.certificate() {
		t.Fatal("repeated immutable observation invalidated the current ticket")
	}
	capture.remember("/captured/source", "read", "present:changed")
	if capture.certificate() == proposed {
		t.Fatal("observation conflict retained an admissible ticket")
	}
	fresh := &governanceCapture{observations: map[string]governanceObservation{}}
	fresh.remember("/captured/source", "read", "present:first")
	if fresh.certificate() == actual {
		t.Fatal("different capture owners can present each other's publication ticket")
	}
}

func TestPublicationTicketRetainsReplacingCompilerMapSemantics(t *testing.T) {
	compiler := newCompilerInputFS(nil, nil)
	capture := &governanceCapture{observations: map[string]governanceObservation{}, compiler: compiler}
	compiler.remember("/captured/source", inputFile, "absent")
	before := capture.certificate()
	compiler.remember("/captured/source", inputFile, "present")
	if len(compiler.observed) != 1 || before == capture.certificate() {
		t.Fatal("legacy compiler replacement cannot use immutable observation-count admission")
	}
}
