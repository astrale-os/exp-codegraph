package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func governanceLaneFixture(t *testing.T, runtimeRules ...bool) (*governanceSession, map[string]any) {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "export const value=1;")
	if len(runtimeRules) != 0 && runtimeRules[0] {
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["mutations/**/*.ts"]}`)
	}
	session := &governanceSession{root: root, parseCache: map[string]*governedFile{}, productsSession: &governanceProductsSession{Prepare: governancePrepare{Root: root, Options: json.RawMessage(`{"sourcePolicyOwnerRevision":1}`)}}}
	config, err := session.captureConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	disabled := []governanceDisabledRule{}
	contracts := []governanceImplementationContract{}
	for rule, revision := range governanceRevisions {
		if !(len(runtimeRules) != 0 && runtimeRules[0] && (rule == "QRY-CANON" || rule == "QRY-SINGLE" || rule == "QLT-DEF-IDS")) {
			disabled = append(disabled, governanceDisabledRule{rule, "fixture"})
		}
		implementation := "astrale.sdk.typescript-source"
		if rule == "QRY-CANON" || rule == "QRY-SINGLE" || rule == "QLT-DEF-IDS" {
			implementation = "astrale.sdk.codegraph"
		}
		contracts = append(contracts, governanceImplementationContract{RuleID: rule, RuleRevision: revision, Implementation: governanceImplementation{implementation, "1"}})
	}
	raw, _ := json.Marshal(map[string]any{"token": config["token"], "kind": "policy", "policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical", Disabled: disabled}, "implementationContracts": contracts})
	response, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	out := response.(map[string]any)
	if out["status"] != "generic" || session.policyLane == nil || session.parseCache != nil || session.typeDemandCache != nil || session.programGeneration != nil || session.sealedDecisions != nil {
		t.Fatalf("generic did not precede exclusive runtime lane: %#v", out)
	}
	return session, out
}


// A native protocol fixture acknowledges the ACTUAL returned frame identity.
// It supplies no Source49 verdicts and does not claim SDK parser/rule equivalence.
func governanceAcknowledgeCapturedSourceFixture(t *testing.T, session *governanceSession, response any) map[string]any {
 t.Helper()
 frame, ok := response.(map[string]any)
 if !ok || frame["status"] != "source" { t.Fatalf("expected captured source frame: %#v", response) }
 raw, err := json.Marshal(map[string]any{"kind":"source-open", "token":frame["token"],
  "generation":frame["generation"], "sourceSnapshotDigest":frame["sourceSnapshotDigest"]})
 if err != nil { t.Fatal(err) }
 opened, err := session.continueProducts(raw)
 if err != nil { t.Fatal(err) }
 if state := session.productsSession; state != nil && state.SourceProducts != nil {
  t.Fatal("source-open fixture manufactured source decisions")
 }
 return opened.(map[string]any)
}

func TestPolicyLaneJoinOwnsIndependentActualCapturesAndWholeBarrier(t *testing.T) {
	session, early := governanceLaneFixture(t)
	defer session.discardProducts()
	root := session.root
	governanceWrite(t, root, "worker/package.json", `{"version":"1.81.0"}`)
	packageBytes, _ := os.ReadFile(filepath.Join(root, "worker/package.json"))
	engine := governanceGenericEngine{Version: "1.81.0", ArtifactDigest: strings.Repeat("a", 64), PackagePath: filepath.Join(root, "worker/package.json"), PackageRevision: governanceHash(packageBytes)}
	raw, _ := json.Marshal(map[string]any{"token": early["token"], "kind": "generic-engine", "engine": engine})
	if _, err := session.continueGeneric(raw); err != nil {
		t.Fatal(err)
	}
	genericOwner := session.productsSession.Project.capture
	policyBase := map[governanceProbeKey]string{}
	for key, value := range genericOwner.probeObservations {
		policyBase[key] = value
	}
	genericOwner.probe(governanceProbeRequest{ID: "negative", Kind: "read-bytes", Path: filepath.Join(root, "missing.ignore")})
	raw, _ = json.Marshal(map[string]any{"token": early["token"], "kind": "generic", "engine": engine, "inputCertificate": session.productsSession.currentCertificate(), "generic": governanceGenericProduct{Status: "complete", Files: 1, Diagnostics: json.RawMessage(`[]`)}})
	response, err := session.continueGeneric(raw)
	if err != nil {
		t.Fatal(err)
	}
	out := governanceAcknowledgeCapturedSourceFixture(t, session, response)
	state := session.productsSession
	if out["status"] != "products" || session.policyLane != nil || state == nil || len(state.JoinedCaptures) != 1 || state.JoinedCaptures[0] != genericOwner || state.Project.capture == genericOwner {
		t.Fatalf("separate actual owners not joined: %#v", out)
	}
	if len(state.Project.capture.probeObservations) != len(policyBase) || len(genericOwner.probeObservations) != len(policyBase)+1 {
		t.Fatal("joining merged lane-specific maps")
	}
	for key, value := range policyBase {
		if state.Project.capture.probeObservations[key] != value || genericOwner.probeObservations[key] != value {
			t.Fatal("policy base lost its exact original operation fingerprint")
		}
	}
	governanceWrite(t, root, "missing.ignore", "now exists")
	response, err = session.sealProducts(state.Token, state.ProductsDigest, strings.Repeat("b", 64))
	if err != nil || response.(map[string]any)["status"] != "retry" || session.productsSession != nil {
		t.Fatalf("negative generic closure escaped final seal: %#v %v", response, err)
	}
}

func TestPolicySeedIsDetachedCurrentAuthorityAndRejectsSemanticReceipts(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	governanceWrite(t, root, "config.json", "original")
	actual := &governanceCapture{root: root, observations: map[string]governanceObservation{}}
	if _, err := actual.read(path); err != nil {
		t.Fatal(err)
	}
	seed, err := governancePolicySeed(actual)
	if err != nil {
		t.Fatal(err)
	}
	actual.byteCells[path].bytes[0] = 'X'
	actual.remember(filepath.Join(root, "other"), "read", "absent")
	if string(seed.byteCells[path].bytes) != "original" || len(seed.observations) != 1 {
		t.Fatal("actual seed aliases mutable capture")
	}
	actual.compilerAssertions = []*governanceCompilerReadAssertions{{}}
	if _, err = governancePolicySeed(actual); err == nil {
		t.Fatal("expected/semantic receipt promoted to actual seed")
	}
}

func TestPolicyLaneContradictionUsesCompleteOriginalFailureAndBytes(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	a := &governanceCapture{observations: map[string]governanceObservation{}}
	b := &governanceCapture{observations: map[string]governanceObservation{}}
	a.read(path)
	b.probe(governanceProbeRequest{ID: "failed", Kind: "read-bytes", Path: path})
	if !governanceLaneCapturesAgree(a, b) {
		t.Fatal("same full original failure contradicted")
	}
	failure := governanceProbeObservation{Status: "error", Error: &governanceProbeError{Kind: "not-found", Code: "ENOENT", Message: "different original message"}}
	b.probeObservations[governanceProbeKey{Path: path, Kind: "read-bytes"}] = governanceProbeFingerprint(failure)
	if governanceLaneCapturesAgree(a, b) {
		t.Fatal("same errno with contradictory message accepted")
	}
	governanceWrite(t, root, "source.ts", "new bytes")
	b = &governanceCapture{observations: map[string]governanceObservation{}}
	b.probe(governanceProbeRequest{ID: "positive", Kind: "read-bytes", Path: path})
	if governanceLaneCapturesAgree(a, b) {
		t.Fatal("negative/positive lanes joined")
	}
	a = &governanceCapture{observations: map[string]governanceObservation{}}
	a.read(path)
	if !governanceLaneCapturesAgree(a, b) {
		t.Fatal("same original bytes contradicted")
	}
	governanceWrite(t, root, "source.ts", "new edits")
	b = &governanceCapture{observations: map[string]governanceObservation{}}
	b.probe(governanceProbeRequest{ID: "edited", Kind: "read-bytes", Path: path})
	if governanceLaneCapturesAgree(a, b) {
		t.Fatal("mixed same-length source bytes joined")
	}
}

func TestDiscardDrainsExclusiveLaneBeforeRetiringGeneration(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "export {}")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	released := false
	project.typeRelease = func() { released = true }
	private := &governanceSession{productsSession: &governanceProductsSession{Project: project}, parseCache: map[string]*governedFile{}}
	lane := &governancePolicyLane{done: make(chan governancePolicyLaneResult, 1)}
	session := &governanceSession{policyLane: lane}
	drained := make(chan struct{})
	go func() { session.discardProducts(); close(drained) }()
	select {
	case <-drained:
		t.Fatal("discard did not drain private owner")
	case <-time.After(10 * time.Millisecond):
	}
	lane.done <- governancePolicyLaneResult{owner: private}
	select {
	case <-drained:
	case <-time.After(2 * time.Second):
		t.Fatal("discard leaked lane")
	}
	if !released || session.policyLane != nil || session.productsSession != nil || session.parseCache == nil {
		t.Fatal("drain lost exclusive ownership or lease retirement")
	}
}

func TestPolicyLaneActualCompilerOwnerRemainsPrivateDuringGenericProbes(t *testing.T) {
	session, early := governanceLaneFixture(t, true)
	defer session.discardProducts()
	genericOwner := session.productsSession.Project.capture
	policyBase := map[governanceProbeKey]string{}
	for key, value := range genericOwner.probeObservations {
		policyBase[key] = value
	}
	for index := 0; index < 40; index++ {
		raw, _ := json.Marshal(map[string]any{"token": early["token"], "requirements": []governanceProbeRequest{{ID: fmt.Sprint(index), Kind: "read-bytes", Path: filepath.Join(session.root, fmt.Sprint(index)+".ignore")}}})
		if _, err := session.captureProbes(raw); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(map[string]any{"token": early["token"], "kind": "generic-retire"})
	response, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	response = governanceAcknowledgeCapturedSourceFixture(t, session, response)
	state := session.productsSession
	if response.(map[string]any)["status"] != "generic" || state.Project.typeOwner == nil || state.Project.typeOwner.program == nil || state.Project.capture == genericOwner || len(state.Project.capture.probeObservations) != len(policyBase) {
		t.Fatalf("actual compiler authority leaked into generic actor: %#v", response)
	}
	if len(genericOwner.probeObservations) != len(policyBase)+40 || state.GenericProduct != nil || len(state.JoinedCaptures) != 0 {
		t.Fatal("retired speculative captures became report inputs")
	}
	for key, value := range policyBase {
		if state.Project.capture.probeObservations[key] != value {
			t.Fatal("retirement lost exact configuration topology authority")
		}
	}
}

func TestPolicyLaneConfigChangeAfterEarlyCompletionDeclinesPublication(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "astrale.lint.json")
	early := &governanceCapture{observations: map[string]governanceObservation{}}
	early.read(config)
	late := &governanceCapture{observations: map[string]governanceObservation{}}
	late.read(config)
	project := &governedProject{Root: root, capture: late}
	state := &governanceProductsSession{Project: project, JoinedCaptures: []*governanceCapture{early}, Token: "attempt", ProductsDigest: strings.Repeat("a", 64), Generation: "1"}
	session := &governanceSession{productsSession: state}
	governanceWrite(t, root, "astrale.lint.json", `{"disabledRules":{}}`)
	response, err := session.sealProducts(state.Token, state.ProductsDigest, strings.Repeat("b", 64))
	if err != nil || response.(map[string]any)["status"] != "retry" {
		t.Fatalf("changed early captured configuration published: %#v %v", response, err)
	}
}
