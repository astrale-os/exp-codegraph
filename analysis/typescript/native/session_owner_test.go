package main

import (
	"errors"
	"fmt"
	"runtime"
	"testing"
	"weak"
)

func TestNativeGenerationOwnerPublication(t *testing.T) {
	a := &analyzer{}
	a.install(ownerFixtureState(1))
	base := a.acknowledged.generation.ID
	pending := ownerFixtureState(2)
	a.pending = &pendingGeneration{state: pending, transaction: &factTransaction{
		ProtocolVersion: protocolVersion, Base: base, Next: pending.generation,
		Manifest: pending.manifest, Upserts: []factShard{}, Deletes: []string{},
	}}
	a.pendingFull = true
	transaction := a.pending.transaction
	encoded := stableJSON(transaction)
	for _, input := range []request{
		{Base: "generation:old"},
		{Base: base, Invalidate: true},
		{Base: base, Changes: []sourceChange{{Path: "owner.ts", Kind: "change"}}},
	} {
		_, _, err := a.refresh(input)
		assertOwnerError(t, err, "COMMIT_PENDING")
	}
	for range 2 {
		replayed, unchanged, err := a.refresh(request{Base: base})
		if err != nil || unchanged != "" || replayed != transaction || stableJSON(replayed) != encoded {
			t.Fatal("a rejected publication did not replay the exact pending transaction")
		}
	}
	assertOwnerError(t, a.acknowledge(request{Generation: base, Sequence: 1}), "ACK_GENERATION_MISMATCH")
	assertOwnerError(t, a.acknowledge(request{Generation: pending.generation.ID}), "ACK_SEQUENCE_INVALID")
	if a.acknowledged.generation.ID != base || a.pending.transaction != transaction || !a.pendingFull {
		t.Fatal("rejected acknowledgement changed the committed base or pending recovery")
	}
	if err := a.acknowledge(request{Generation: pending.generation.ID, Sequence: 19}); err != nil {
		t.Fatal(err)
	}
	if a.acknowledged.generation.Sequence != 19 || a.pending != nil || a.pendingFull || stableJSON(transaction) != encoded {
		t.Fatal("publication did not install the store-owned sequence without mutating its replay")
	}
	if err := a.acknowledge(request{Generation: pending.generation.ID, Sequence: 19}); err != nil {
		t.Fatal("acknowledgement was not idempotent:", err)
	}
	assertOwnerError(t, a.acknowledge(request{Generation: base, Sequence: 1}), "ACK_UNEXPECTED")
	_, _, err := a.refresh(request{Base: base})
	assertOwnerError(t, err, "BASE_STALE")
	_, unchanged, err := a.refresh(request{Base: pending.generation.ID})
	if err != nil || unchanged != pending.generation.ID {
		t.Fatal("the installed generation did not remain the sole refresh base")
	}
}

func TestNativeGenerationOwnerReleasesAcknowledgedHistory(t *testing.T) {
	a := &analyzer{}
	current := stageOwnerFixture(a, 1)
	acknowledgeOwnerFixture(t, a)
	for sequence := 2; sequence <= 24; sequence++ {
		next := stageOwnerFixture(a, sequence)
		runtime.GC()
		if !current.alive() || !next.alive() {
			t.Fatal("an unacknowledged transaction released its base or pending evidence")
		}
		acknowledgeOwnerFixture(t, a)
		awaitOwnerRelease(t, current, a)
		if !next.alive() {
			t.Fatal("publication released the new acknowledged evidence")
		}
		current = next
	}
	// Closing also relinquishes an outstanding candidate. Keep the analyzer
	// itself alive to prove ownership release, independently of process exit.
	pending := stageOwnerFixture(a, 25)
	if err := a.close(); err != nil {
		t.Fatal(err)
	}
	awaitOwnerRelease(t, current, a)
	awaitOwnerRelease(t, pending, a)
}

func TestNativeGenerationOwnerPreservesIndependentCallableProofs(t *testing.T) {
	a := &analyzer{}
	base := ownerFixtureState(1)
	base.callableReads = mergeCallableReads(callableReadIndex{}, map[string][]callableRead{
		"consumer.ts": {{dependencies: []string{"before.ts"}, observation: callableObservation{target: "same-target"}}},
	})
	a.install(base)
	candidate := ownerFixtureState(2)
	candidate.callableReads = mergeCallableReads(a.acknowledged.callableReads, map[string][]callableRead{
		"consumer.ts": {{dependencies: []string{"after.ts"}, observation: callableObservation{target: "same-target"}}},
	})
	a.pending = &pendingGeneration{state: candidate}
	if !a.acknowledged.callableReads.dependents["before.ts"]["consumer.ts"] ||
		a.acknowledged.callableReads.dependents["after.ts"]["consumer.ts"] ||
		!candidate.callableReads.dependents["after.ts"]["consumer.ts"] ||
		candidate.callableReads.dependents["before.ts"]["consumer.ts"] {
		t.Fatal("building a candidate changed the acknowledged dependency proof")
	}
	acknowledgeOwnerFixture(t, a)
	if !a.acknowledged.callableReads.dependents["after.ts"]["consumer.ts"] ||
		a.acknowledged.callableReads.dependents["before.ts"]["consumer.ts"] {
		t.Fatal("acknowledgement did not transfer the new dependency proof")
	}
}

func TestNativeGenerationOwnerUniverseTransfer(t *testing.T) {
	a := &analyzer{}
	a.install(ownerFixtureState(1))
	first := a.universe
	next := ownerFixtureState(2)
	next.generation.Universe = "project-universe:other"
	a.pending = &pendingGeneration{state: next}
	if a.universe != first {
		t.Fatal("an unpublished rollover changed the active universe")
	}
	acknowledgeOwnerFixture(t, a)
	if a.universe != next.generation.Universe {
		t.Fatal("the acknowledged rollover did not transfer its universe")
	}
	restored := ownerFixtureState(1)
	a.pending = &pendingGeneration{state: restored}
	if err := a.acknowledge(request{Generation: restored.generation.ID, Sequence: 37}); err != nil {
		t.Fatal(err)
	}
	if a.universe != first || a.acknowledged.generation.Sequence != 37 {
		t.Fatal("restored universe did not adopt the client store's sequence")
	}
}

type ownerWeakEvidence struct {
	manifest weak.Pointer[factShardReference]
	origin   weak.Pointer[callTargetOrigin]
}

func (e ownerWeakEvidence) alive() bool {
	return e.manifest.Value() != nil && e.origin.Value() != nil
}

func stageOwnerFixture(a *analyzer, sequence int) ownerWeakEvidence {
	state := ownerFixtureState(sequence)
	a.pending = &pendingGeneration{state: state, transaction: &factTransaction{
		Base: a.acknowledged.generation.ID, Next: state.generation, Manifest: state.manifest,
	}}
	return ownerWeakEvidence{
		manifest: weak.Make(&state.manifest[0]),
		origin:   weak.Make(state.callableReads.owners["owner.ts"][0].observation.origin),
	}
}

func ownerFixtureState(sequence int) generationState {
	identity := fmt.Sprintf("generation:%d", sequence)
	origin := &callTargetOrigin{Package: "fixture", File: "owner.ts", Path: []string{identity}}
	return generationState{
		generation: analysisGeneration{ID: identity, Universe: "project-universe:fixture", Sequence: sequence},
		manifest:   []factShardReference{{Key: "fact-shard-key:fixture", Digest: identity, canonical: make([]byte, 1024)}},
		digests:    map[string]string{"fact-shard-key:fixture": identity},
		callableReads: mergeCallableReads(callableReadIndex{}, map[string][]callableRead{
			"owner.ts": {{dependencies: []string{"dependency.ts"}, observation: callableObservation{origin: origin}}},
		}),
	}
}

func acknowledgeOwnerFixture(t *testing.T, a *analyzer) {
	t.Helper()
	if err := a.acknowledge(request{Generation: a.pending.state.generation.ID, Sequence: a.pending.state.generation.Sequence}); err != nil {
		t.Fatal(err)
	}
}

func awaitOwnerRelease(t *testing.T, evidence ownerWeakEvidence, a *analyzer) {
	t.Helper()
	for range 10 {
		runtime.GC()
		if evidence.manifest.Value() == nil && evidence.origin.Value() == nil {
			runtime.KeepAlive(a)
			return
		}
		runtime.Gosched()
	}
	runtime.KeepAlive(a)
	t.Fatal("inaccessible generation evidence remained reachable from the live analyzer")
}

func assertOwnerError(t *testing.T, err error, code string) {
	t.Helper()
	var native nativeError
	if !errors.As(err, &native) || native.code != code {
		t.Fatalf("expected %s, received %v", code, err)
	}
}
