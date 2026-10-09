package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func sourceContractSession(t *testing.T, active map[string]bool, revisions map[string]string) *governanceSession {
	t.Helper()
	session, _ := liveInputSession(t, nil)
	state := session.productsSession
	state.Project.Disabled = map[string]string{}
	for id, original := range governanceRevisions {
		revision := original
		if supplied, ok := revisions[id]; ok {
			revision = supplied
		}
		identity := "astrale.sdk.typescript-source"
		if id == "QRY-CANON" || id == "QRY-SINGLE" || id == "QLT-DEF-IDS" {
			identity = "astrale.sdk.codegraph"
		}
		state.Contracts = append(state.Contracts, governanceImplementationContract{RuleID: id,
			RuleRevision: revision, Implementation: governanceImplementation{identity, "1"}})
		state.Prepare.RuleRevisions = append(state.Prepare.RuleRevisions, governanceRevision{ID: id, Revision: revision})
		if !active[id] {
			state.Project.Disabled[id] = "ownership fixture"
		}
	}
	governanceSourceObservationFixture(t, session)
	return session
}

func TestClosedSourceRevisionBelongsToCapturedSDKContract(t *testing.T) {
	active, revisions := map[string]bool{}, map[string]string{}
	for _, id := range []string{"MUT-PLAN-REQ", "FNC-XDOM-DECLARED", "FNC-XDOM-REQ", "PRV-XDOM-REQ"} {
		active[id], revisions[id] = true, governanceHash([]byte("current SDK Domain policy:"+id))
	}
	session := sourceContractSession(t, active, revisions)
	state := session.productsSession
	ready, err := session.evaluateProducts()
	if err != nil || ready.(map[string]any)["status"] != "source-projection" {
		t.Fatal("compatible SDK source revision was rejected before its owner ran", ready, err)
	}
	decisions := []map[string]any{}
	for _, contract := range state.Contracts {
		if active[contract.RuleID] {
			decisions = append(decisions, map[string]any{"id": contract.RuleID,
				"decision": map[string]any{"status": "pass", "findings": []any{}}})
		}
	}
	raw, err := json.Marshal(map[string]any{"token": state.Token, "generation": state.Generation,
		"sourceSnapshotDigest": state.Project.GovernanceDigest, "decisions": decisions})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.completeClosedSource(raw)
	if err != nil || result.(map[string]any)["status"] != "products" {
		t.Fatal("captured SDK source decisions failed final admission", result, err)
	}
	var envelope struct {
		Products []governanceRuleProduct `json:"products"`
	}
	if err := json.Unmarshal([]byte(result.(map[string]any)["productsJSON"].(string)), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Products) != len(active) {
		t.Fatal("source revision migration changed coverage", envelope.Products)
	}
	for _, product := range envelope.Products {
		if product.RuleRevision != revisions[product.RuleID] || product.RuleRevision == governanceRevisions[product.RuleID] || product.Implementation.ID != "astrale.sdk.typescript-source" {
			t.Fatal("native registry replaced the captured SDK source contract", product)
		}
	}
	if state.Project.stats.CompilerPrograms != 0 {
		t.Fatal("source contract migration opened a semantic compiler")
	}
}

func TestNativeSemanticRevisionStillBelongsToNativeEvaluator(t *testing.T) {
	for _, id := range []string{"QRY-CANON", "QRY-SINGLE", "QLT-DEF-IDS"} {
		t.Run(id, func(t *testing.T) {
			session := sourceContractSession(t, map[string]bool{id: true}, map[string]string{id: governanceHash([]byte("unsupported native revision:" + id))})
			result, err := session.evaluateProducts()
			if err != nil || result.(map[string]any)["status"] != "partial" {
				t.Fatal("unsupported native revision was certified", result, err)
			}
			residual := strings.Join(result.(map[string]any)["residual"].([]string), "\n")
			if !strings.Contains(residual, "Native source revision authority unavailable: "+id) || session.productsSession != nil {
				t.Fatal("native revision mismatch lost partial/retirement guard", result)
			}
		})
	}
}

func TestSDKSourceRevisionRetainsContractAndCoverageAdmission(t *testing.T) {
	for _, kind := range []string{"revision", "foreign-request-revision", "duplicate-request-revision", "implementation", "version", "duplicate", "subset", "foreign-decision"} {
		t.Run(kind, func(t *testing.T) {
			session := sourceContractSession(t, map[string]bool{"IMP-STATIC": true}, nil)
			state := session.productsSession
			var selected *governanceImplementationContract
			for index := range state.Contracts {
				if state.Contracts[index].RuleID == "IMP-STATIC" {
					selected = &state.Contracts[index]
				}
			}
			switch kind {
			case "revision":
				selected.RuleRevision = "malformed"
			case "foreign-request-revision":
				selected.RuleRevision = governanceHash([]byte("another SDK catalog revision"))
			case "duplicate-request-revision":
				state.Prepare.RuleRevisions = append(state.Prepare.RuleRevisions, governanceRevision{ID: selected.RuleID, Revision: selected.RuleRevision})
			case "implementation":
				selected.Implementation.ID = "astrale.sdk.codegraph"
			case "version":
				selected.Implementation.Version = "2"
			case "duplicate":
				state.Contracts = append(state.Contracts, *selected)
			case "subset":
				state.Contracts = []governanceImplementationContract{*selected}
			case "foreign-decision":
				raw, _ := json.Marshal(map[string]any{"token": state.Token, "generation": state.Generation,
					"sourceSnapshotDigest": state.Project.GovernanceDigest, "decisions": []any{map[string]any{"id": "ROOT-FACADE", "decision": map[string]any{"status": "pass"}}}})
				if _, err := session.completeClosedSource(raw); err == nil || state.SourceProducts != nil || state.ProductsDigest != "" {
					t.Fatal("foreign SDK source decision entered owned products")
				}
				return
			}
			result, err := session.evaluateProducts()
			if kind == "subset" {
				if err != nil || result.(map[string]any)["status"] != "partial" || session.productsSession != nil {
					t.Fatal("incomplete SDK implementation inventory was certified", result, err)
				}
			} else if err == nil || state.SourceProducts != nil || state.ProductsDigest != "" {
				t.Fatal("invalid source contract weakened admission", result, err)
			}
		})
	}
}
