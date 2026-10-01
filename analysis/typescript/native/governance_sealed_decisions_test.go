package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOwnedSealedOutcomesPreserveUTF16EvidenceAndLocations(t *testing.T) {
	text := jsstring.FromUnits([]uint16{'i', 'd', 0xD800, 'x', 0xDC00}).WTF8()
	location := &decisionLocation{Path: "query.ts", Line: 1, Column: 2, Offset: 1, Length: 3}
	source := map[string]governanceOutcome{"rule": {Rule: "rule", Status: "fail", Findings: []governanceEvidence{{Rule: "rule", Evidence: text, Location: location}}}}
	before, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	sealed := governanceOwnedOutcomes(source)
	now := governanceOwnedOutcomes(sealed)
	after, err := json.Marshal(now)
	if err != nil || string(before) != string(after) {
		t.Fatalf("UTF16 public finding changed: %q != %q (%v)", before, after, err)
	}
	if now["rule"].Findings[0].Evidence != text {
		t.Fatal("native evidence code units were replaced")
	}
	location.Line = 99
	source["rule"].Findings[0].Evidence = "mutated"
	now["rule"].Findings[0].Location.Column = 99
	if sealed["rule"].Findings[0].Evidence != text || sealed["rule"].Findings[0].Location.Line != 1 || sealed["rule"].Findings[0].Location.Column != 2 {
		t.Fatal("sealed outcome borrowed mutable source/current location or slice")
	}
}

func TestSealedDecisionExpectedReadsAreNotCurrentObservations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "helper.ts")
	if err := os.WriteFile(path, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	old := &governanceCapture{observations: map[string]governanceObservation{}}
	if _, err := old.read(path); err != nil {
		t.Fatal(err)
	}
	expected := governanceExpectedCapture(old)
	now := &governanceCapture{observations: map[string]governanceObservation{}}
	if len(now.observations) != 0 || len(expected.observations) == 0 {
		t.Fatal("expected receipt prepopulated current reads")
	}
	if valid, err := expected.Verify(); err != nil || !valid {
		t.Fatalf("unchanged receipt: %v %v", valid, err)
	}
	// Original byte comparison, not size/stat or source membership, owns this
	// dependency even when the new capture has never read it.
	if err := os.WriteFile(path, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, err := expected.Verify(); err != nil || valid {
		t.Fatalf("same-size helper change accepted: %v %v", valid, err)
	}
	if len(now.observations) != 0 {
		t.Fatal("barrier fabricated actual reads")
	}
}

func TestExpectedDecisionSnapshotDoesNotRetainMutableObservationMaps(t *testing.T) {
	old := &governanceCapture{observations: map[string]governanceObservation{"read\x00missing": {Path: "missing", Kind: "read", Value: "absent"}}, probeObservations: map[governanceProbeKey]string{}}
	expected := governanceExpectedCapture(old)
	delete(old.observations, "read\x00missing")
	if len(expected.observations) != 1 {
		t.Fatal("expected closure borrowed mutable capture map")
	}
	if expected.byteCells != nil || expected.compiler != nil {
		t.Fatal("snapshot retained current value cells or compiler")
	}
}

func TestDecisionPrepareKeyIgnoresOnlyChangeHint(t *testing.T) {
	a := governancePrepare{Root: "/root", BasePolicyDigest: "policy", Changed: []string{"a.ts"}}
	b := a
	b.Changed = []string{"b.ts"}
	if governanceDecisionPrepareKey(a) != governanceDecisionPrepareKey(b) {
		t.Fatal("change hint became authority")
	}
	b.Options = []byte(`{"maxSteps":4}`)
	if governanceDecisionPrepareKey(a) == governanceDecisionPrepareKey(b) {
		t.Fatal("budget/options omitted from semantic key")
	}
}

func TestSealedDecisionClonesPendingAndActualRawReadClosure(t *testing.T) {
	root := t.TempDir()
	path, missing := filepath.Join(root, "helper.ts"), filepath.Join(root, "negative.ts")
	if err := os.WriteFile(path, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	inputs := newCompilerInputFS(disk, disk)
	inputs.singleCapture = true
	inputs.ReadFile(path)
	pending := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{missing: {text: "", present: false}}, barrierObservations: map[compilerInputKey]string{}}
	old := &governanceCapture{compiler: inputs, compilerAssertions: []*governanceCompilerReadAssertions{pending}}
	expected := governanceExpectedCapture(old)
	delete(pending.barrierReads, missing)
	delete(inputs.rawReads, path)
	if len(expected.compilerAssertions) != 2 || len(expected.compilerAssertions[0].barrierReads) != 1 || len(expected.compilerAssertions[1].barrierReads) != 1 {
		t.Fatal("raw closure borrowed or omitted")
	}
	if valid, err := expected.Verify(); err != nil || !valid {
		t.Fatalf("unchanged raw receipt: %v %v", valid, err)
	}
	if err := os.WriteFile(missing, []byte("appeared"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := expected.Verify(); valid {
		t.Fatal("observed absence appeared but replay accepted")
	}
	if err := os.Remove(missing); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := expected.Verify(); valid {
		t.Fatal("same-size actual raw read changed but replay accepted")
	}
}

func TestCurrentCanonicalLeafMeaningInvalidatesSealedJoins(t *testing.T) {
	before := governanceIntrinsicAnswer{ID: "leaf", Kind: "locale-sort", Groups: [][]int{{0}, {1}}}
	session := &governanceSession{sealedDecisions: &governanceSealedDecisions{}}
	state := &governanceProductsSession{ReplayAnswers: map[string]governanceIntrinsicAnswer{"leaf": before}, ReplayExpected: &governanceCapture{}, RuleReady: map[string]governanceOutcome{"source": {}}, RuntimeReady: map[string]governanceOutcome{"runtime": {}}}
	session.observeSealedLeaf(state, before)
	if state.ReplayExpected == nil {
		t.Fatal("equal current leaf invalidated immutable values")
	}
	after := before
	after.Groups = [][]int{{1}, {0}}
	session.observeSealedLeaf(state, after)
	if state.ReplayExpected != nil || state.RuleReady != nil || state.RuntimeReady != nil || session.sealedDecisions != nil {
		t.Fatal("changed canonical ordering retained stale report joins")
	}
}
