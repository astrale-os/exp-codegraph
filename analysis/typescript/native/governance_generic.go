package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
)

type governanceGenericEngine struct {
	Version         string `json:"version"`
	ArtifactDigest  string `json:"artifactDigest"`
	PackagePath     string `json:"packagePath"`
	PackageRevision string `json:"packageRevision"`
}
type governanceGenericProduct struct {
	Status      string          `json:"status"`
	Files       int             `json:"files"`
	Diagnostics json.RawMessage `json:"diagnostics"`
}

func governanceDigestValid(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
func (state *governanceProductsSession) currentCertificate() string {
	capture := state.Project.capture.certificate()
	for _, joined := range state.JoinedCaptures {
		capture = governanceHash([]byte(stableJSON([]string{capture, "joined-original-owner", joined.certificate()})))
	}
	if state.ReplayExpected != nil {
		// The proposed expected closure is a deep-owned immutable snapshot. Its
		// original certificate is computed once for that exact retained owner;
		// the actual current capture ticket still advances on every new read.
		// Re-serializing the old compiler closure at every generic probe turns
		// one frozen obligation into O(closure size × protocol waves) work.
		if state.replayCertificateOwner != state.ReplayExpected || state.replayCertificate == "" {
			state.replayCertificate = state.ReplayExpected.certificate()
			state.replayCertificateOwner = state.ReplayExpected
		}
		capture = governanceHash([]byte(stableJSON([]string{capture, "expected-sealed-decisions", state.replayCertificate})))
	}
	if state.GenericEngine == nil {
		return capture
	}
	encoded, _ := json.Marshal(struct {
		Capture string                   `json:"capture"`
		Engine  *governanceGenericEngine `json:"engine"`
	}{capture, state.GenericEngine})
	return governanceHash(encoded)
}
func (state *governanceProductsSession) genericSuspension() any {
	return map[string]any{"status": "generic", "token": state.Token, "generation": state.Generation, "root": state.Project.Root, "requestedRoot": state.Prepare.Root, "inputCertificate": state.currentCertificate(), "engine": state.GenericEngine, "speculative": state.GenericSpeculative}
}
func (session *governanceSession) continueGeneric(raw json.RawMessage) (any, error) {
	var params struct {
		Token            string                   `json:"token"`
		Kind             string                   `json:"kind"`
		Engine           governanceGenericEngine  `json:"engine"`
		InputCertificate string                   `json:"inputCertificate"`
		Generic          governanceGenericProduct `json:"generic"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	state := session.productsSession
	if state == nil || state.Project == nil || state.Token != params.Token || state.ProductsDigest != "" || !state.GenericSuspended {
		return map[string]any{"status": "retry"}, nil
	}
	switch params.Kind {
	case "generic-retire":
		if session.policyLane == nil {
			return state.genericSuspension(), nil
		}
		joined := session.takePolicyLane()
		return joined.result, joined.err
	case "generic-engine":
		engine := params.Engine
		if state.GenericEngine != nil || engine.Version == "" || !governanceDigestValid(engine.ArtifactDigest) || !governanceDigestValid(engine.PackageRevision) || !filepath.IsAbs(engine.PackagePath) {
			return nil, fmt.Errorf("invalid or repeated captured generic engine selection")
		}
		bytes, err := state.Project.capture.read(engine.PackagePath)
		if err != nil || governanceHash(bytes) != engine.PackageRevision {
			return nil, fmt.Errorf("captured generic package revision differs")
		}
		var manifest struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(bytes, &manifest) != nil || manifest.Version != engine.Version {
			return nil, fmt.Errorf("captured generic package version differs")
		}
		state.GenericEngine = &engine
		return state.genericSuspension(), nil
	case "generic":
		if state.GenericEngine == nil || *state.GenericEngine != params.Engine {
			return nil, fmt.Errorf("captured generic engine identity differs from selection")
		}
		if params.InputCertificate != state.currentCertificate() {
			return map[string]any{"status": "retry"}, nil
		}
		if params.Generic.Status != "complete" || params.Generic.Files < 0 || params.Generic.Files > 100000 || len(params.Generic.Diagnostics) > 32*1024*1024 {
			return nil, fmt.Errorf("captured generic output is incomplete or exceeds admission bounds")
		}
		var rows []json.RawMessage
		if len(params.Generic.Diagnostics) == 0 || params.Generic.Diagnostics[0] != '[' || json.Unmarshal(params.Generic.Diagnostics, &rows) != nil || len(rows) > 100000 {
			return nil, fmt.Errorf("invalid captured generic diagnostic array")
		}
		state.GenericProduct = &params.Generic
		if session.policyLane != nil {
			return session.joinPolicyLane(state)
		}
		return session.evaluateProducts()
	}
	return nil, fmt.Errorf("unsupported captured generic continuation")
}
