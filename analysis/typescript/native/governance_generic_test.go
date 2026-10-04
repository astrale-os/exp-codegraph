package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestGovernanceGenericSelectionAndAnswerStayOnCapturedGeneration(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "export {}")
	manifest := []byte(`{"name":"oxlint","version":"1.81.0"}`)
	governanceWrite(t, root, "worker/package.json", string(manifest))
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	state := &governanceProductsSession{Project: project, Token: "token", Generation: "1", GenericSuspended: true, Prepare: governancePrepare{Root: root}}
	session := governanceSession{productsSession: state}
	engine := governanceGenericEngine{Version: "1.81.0", ArtifactDigest: strings.Repeat("a", 64), PackagePath: filepath.Join(root, "worker/package.json"), PackageRevision: governanceHash(manifest)}
	request, _ := json.Marshal(map[string]any{"token": "token", "kind": "generic-engine", "engine": engine})
	response, err := session.continueGeneric(request)
	if err != nil {
		t.Fatal(err)
	}
	echo := response.(map[string]any)
	if echo["status"] != "generic" || echo["inputCertificate"] != state.currentCertificate() || state.ProductsDigest != "" {
		t.Fatalf("engine prematurely published=%#v", echo)
	}
	certificate := state.currentCertificate()
	// Every negative read joins the same generation. An answer bound to the
	// preceding certificate cannot bypass a newly recorded observation.
	project.capture.probe(governanceProbeRequest{ID: "missing", Kind: "read-bytes", Path: filepath.Join(root, "missing.ignore")})
	answer := map[string]any{"token": "token", "kind": "generic", "engine": engine, "inputCertificate": certificate, "generic": governanceGenericProduct{Status: "complete", Files: 1, Diagnostics: json.RawMessage(`[]`)}}
	request, _ = json.Marshal(answer)
	response, err = session.continueGeneric(request)
	if err != nil || response.(map[string]any)["status"] != "retry" || state.GenericProduct != nil {
		t.Fatalf("stale generic answer accepted=%#v %v", response, err)
	}
	answer["inputCertificate"] = state.currentCertificate()
	changed := engine
	changed.ArtifactDigest = strings.Repeat("b", 64)
	answer["engine"] = changed
	request, _ = json.Marshal(answer)
	if _, err = session.continueGeneric(request); err == nil {
		t.Fatal("different worker accepted")
	}
	// Selection was a capture read, not a detached digest supplied by the caller.
	governanceWrite(t, root, "worker/package.json", `{"name":"oxlint","version":"1.79.0"}`)
	if valid, err := project.capture.Verify(); err != nil || valid {
		t.Fatalf("retargeted engine manifest sealed=%v %v", valid, err)
	}
}
