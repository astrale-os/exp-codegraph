package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Exercise the two real producer owners together. The native join consumes the
// actual Rust empty diagnostic array and membership; this is not a replacement
// for SDK normalization or exported complete-report qualification.
func TestPolicyLaneOwnedOriginalJournalRetainsIndependentFreshGuards(t *testing.T) {
	artifact := ownedArtifactTestBytes(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(filepath.Dir(executable), governanceOwnedArtifactName)
	if _, err := os.Lstat(artifactPath); !os.IsNotExist(err) {
		t.Fatal("private test executable already has an owned sidecar")
	}
	if err := os.WriteFile(artifactPath, artifact, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(artifactPath) })
	store := filepath.Join(filepath.Dir(executable), ".owned-artifacts-v1")
	t.Cleanup(func() {
		filepath.WalkDir(store, func(path string, entry os.DirEntry, err error) error {
			if err == nil && entry.IsDir() {
				os.Chmod(path, 0700)
			}
			return nil
		})
		os.RemoveAll(store)
	})
	session, early := governanceLaneFixture(t, true)
	session.ownedSignals = governanceNewOwnedSessionSignals()
	t.Cleanup(func() { session.discardProducts(); session.ownedSignals.stop() })
	packagePath := filepath.Join(t.TempDir(), "package.json")
	packageBytes := []byte(`{"version":"1.81.0"}`)
	if err := os.WriteFile(packagePath, packageBytes, 0600); err != nil {
		t.Fatal(err)
	}
	engine := governanceGenericEngine{Version: "1.81.0", ArtifactDigest: governanceOwnedArtifactSHA, PackagePath: packagePath, PackageRevision: governanceHash(packageBytes)}
	raw, _ := json.Marshal(map[string]any{"token": early["token"], "kind": "generic-engine", "engine": engine})
	if _, err := session.continueGeneric(raw); err != nil {
		t.Fatal(err)
	}
	genericCapture := session.productsSession.Project.capture
	raw, _ = json.Marshal(map[string]any{"token": early["token"], "configPath": filepath.Join(session.root, ".oxlintrc.json"), "config": map[string]any{"categories": map[string]string{"correctness": "off"}}, "commandIgnorePatterns": []string{}})
	actual, err := session.captureOwnedGeneric(raw)
	if err != nil {
		t.Fatal(err)
	}
	closed := actual.(map[string]any)
	if closed["status"] != "owned-generic" || genericCapture.ownedGenericOwner == nil || len(genericCapture.ownedGenericProducerTrace) == 0 || session.genericProducer == nil {
		t.Fatal("real original Rust producer did not close its current journal")
	}
	var membership struct {
		Paths []string `json:"paths"`
	}
	var lint struct {
		Output struct {
			Diagnostics json.RawMessage `json:"diagnostics"`
		} `json:"output"`
	}
	if err := json.Unmarshal(closed["membership"].(json.RawMessage), &membership); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(closed["lint"].(json.RawMessage), &lint); err != nil {
		t.Fatal(err)
	}
	var diagnostics []json.RawMessage
	if err := json.Unmarshal(lint.Output.Diagnostics, &diagnostics); err != nil || len(diagnostics) != 0 || len(membership.Paths) == 0 {
		t.Fatal("fixture must use actual nonempty membership and empty original diagnostics")
	}
	raw, _ = json.Marshal(map[string]any{"token": early["token"], "kind": "generic", "engine": engine, "inputCertificate": closed["inputCertificate"], "generic": governanceGenericProduct{Status: "complete", Files: len(membership.Paths), Diagnostics: lint.Output.Diagnostics}})
	if _, err := session.continueGeneric(raw); err != nil {
		t.Fatal(err)
	}
	state := session.productsSession
	if state == nil || state.Project.typeOwner == nil || state.Project.typeOwner.program == nil || state.Project.capture == genericCapture || len(state.JoinedCaptures) != 1 || state.JoinedCaptures[0] != genericCapture {
		t.Fatal("joining lost the real compiler or original Rust journal owner")
	}
	valid, err := genericCapture.Verify()
	if err != nil || !valid {
		t.Fatalf("unchanged actual original journal failed fresh guards: %v %v", valid, err)
	}
	// A worker-owned directory participates in final publication even though it
	// was absent from the separate compiler/source-policy capture.
	governanceWrite(t, session.root, ".gitignore", "changed-after-owned-close\n")
	result, err := session.sealProducts(state.Token, state.ProductsDigest, strings.Repeat("b", 64))
	if err != nil || result.(map[string]any)["status"] != "retry" || session.productsSession != nil {
		t.Fatalf("changed real owned journal escaped joined final seal: %#v %v", result, err)
	}
}
