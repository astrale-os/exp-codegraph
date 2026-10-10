package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Initialize private ownership through the caller-contract decoder, then use
// actual configuration/policy capture, continuations and the uncached seal.
func sourceReplayBegin(t *testing.T, session *governanceSession, prepare map[string]any, contracts []map[string]any, disabled []governanceDisabledRule) map[string]any {
	t.Helper()
	session.discardProducts()
	raw, _ := json.Marshal(prepare)
	var input governancePrepare
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	offered, err := governanceCallerContracts(input)
	if err != nil {
		t.Fatal(err)
	}
	session.productsSession = &governanceProductsSession{Prepare: input, Contracts: offered}
	configuration, err := session.captureConfiguration(input.Root)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(map[string]any{"kind": "policy", "token": configuration["token"],
		"implementationContracts": contracts,
		"policy":                  governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical", Disabled: disabled}})
	value, err := session.continueProductsOwned(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	return value.(map[string]any)
}

func sourceReplayComplete(t *testing.T, session *governanceSession, frame map[string]any) map[string]any {
	t.Helper()
	if frame["status"] == "source" {
		raw, _ := json.Marshal(map[string]any{"kind": "source-open", "token": frame["token"],
			"generation": frame["generation"], "sourceSnapshotDigest": frame["sourceSnapshotDigest"]})
		value, err := session.continueProducts(raw)
		if err != nil {
			t.Fatal(err)
		}
		frame = value.(map[string]any)
	}
	if frame["status"] == "source-projection" {
		state := session.productsSession
		decisions := []map[string]any{}
		for _, contract := range state.Contracts {
			if _, disabled := state.Project.Disabled[contract.RuleID]; disabled {
				continue
			}
			decisions = append(decisions, map[string]any{"id": contract.RuleID,
				"decision": map[string]any{"status": "pass", "findings": []any{}}})
		}
		raw, _ := json.Marshal(map[string]any{"kind": "source-complete", "token": frame["token"],
			"generation": frame["generation"], "sourceSnapshotDigest": frame["sourceSnapshotDigest"], "decisions": decisions})
		value, err := session.continueProducts(raw)
		if err != nil {
			t.Fatal(err)
		}
		frame = value.(map[string]any)
	}
	if frame["status"] != "products" {
		t.Fatal("source products did not complete", frame)
	}
	return frame
}

func sourceReplaySeal(t *testing.T, session *governanceSession, products map[string]any, status string) {
	t.Helper()
	value, err := session.sealProducts(products["token"].(string), products["productsDigest"].(string), governanceHash([]byte("source replay report")))
	if err != nil || value.(map[string]any)["status"] != status {
		t.Fatal("source replay seal", value, err)
	}
}

func TestWholeSourceOwnerSealsAndProposesNoopProducts(t *testing.T) {
	for _, scenario := range []string{"opaque-three", "legacy-52", "modern-50", "zero", "all-disabled"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export const value = 1\n")
			contracts := callerContracts(t, scenario != "legacy-52")
			if scenario == "opaque-three" {
				contracts = []map[string]any{}
				for _, id := range []string{"caller.query", "caller.single", "caller.definitions"} {
					contracts = append(contracts, map[string]any{"ruleId": id, "ruleRevision": governanceHash([]byte(id)),
						"requiredFacts": []string{"semantic-source"}, "implementation": map[string]any{"id": "caller.semantic.reducer", "version": "3"}})
				}
			}
			if scenario == "zero" {
				contracts = []map[string]any{}
			}
			disabled := []governanceDisabledRule{}
			if scenario == "all-disabled" {
				for _, contract := range contracts {
					disabled = append(disabled, governanceDisabledRule{contract["ruleId"].(string), "caller configuration"})
				}
			}
			prepare := callerPrepare(root, contracts, scenario != "legacy-52")
			session := &governanceSession{root: root}
			t.Cleanup(session.discardProducts)
			first := sourceReplayComplete(t, session, sourceReplayBegin(t, session, prepare, contracts, disabled))
			if session.productsSession.SourceProducts == nil || len(session.productsSession.RuntimeReady) != 0 {
				t.Fatal("whole source completion lost [] authority or invented native semantic outcomes")
			}
			sourceReplaySeal(t, session, first, "committed")
			if session.sealedDecisions == nil {
				t.Fatal("completed whole source authority was not retained")
			}
			next := sourceReplayBegin(t, session, prepare, contracts, disabled)
			if next["status"] != "products" || session.productsSession.ReplayExpected == nil || session.productsSession.sourceBody != nil {
				t.Fatal("noop did not propose sealed whole source products", next)
			}
			if first["productsJSON"] != next["productsJSON"] || session.productsSession.Project.stats.CompilerPrograms != 0 {
				t.Fatal("noop changed products or opened a compiler")
			}
			sourceReplaySeal(t, session, next, "committed")
		})
	}
}

func TestWholeSourceReplayRetainsUncachedCompilerInputBarrier(t *testing.T) {
	for _, kind := range []string{"type", "import", "external"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "import {value} from 'fixture'; export const result = value;\n")
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"include":["index.ts"]}`)
			governanceWrite(t, root, "node_modules/fixture/package.json", `{"name":"fixture","types":"index.d.ts"}`)
			governanceWrite(t, root, "node_modules/fixture/index.d.ts", `export declare const value: 'before';`)
			path := filepath.Join(root, "node_modules/fixture/index.d.ts")
			replacement := `export declare const value: 'after!';`
			if kind == "import" {
				path = filepath.Join(root, "node_modules/fixture/package.json")
				replacement = `{"name":"fixture","types":"other.d.ts"}`
			}
			if kind == "external" {
				path = filepath.Join(t.TempDir(), "external.json")
				if err := os.WriteFile(path, []byte(`{"value":"before"}`), 0600); err != nil {
					t.Fatal(err)
				}
				replacement = `{"value":"after!"}`
			}
			contracts := callerContracts(t, true)
			prepare := callerPrepare(root, contracts, true)
			session := &governanceSession{root: root}
			t.Cleanup(session.discardProducts)
			frame := sourceReplayBegin(t, session, prepare, contracts, nil)
			state := session.productsSession
			governanceSourceObservationFixture(t, session)
			input := governanceSemanticRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: state.Project.GovernanceDigest}
			raw, _ := json.Marshal(input)
			opened, err := session.openSemanticProjection(raw)
			if err != nil {
				t.Fatal(err)
			}
			input.Lease = opened.(map[string]any)["lease"].(string)
			semanticProjectionRefresh(t, session, input, []string{}, []string{})
			if kind == "external" {
				if answer := liveInputObserve(t, session, "read", path); answer.Status != "known" {
					t.Fatal("external fixture did not own an actual captured read", answer)
				}
			}
			first := sourceReplayComplete(t, session, map[string]any{"status": "source-projection", "token": frame["token"], "generation": state.Generation, "sourceSnapshotDigest": state.Project.GovernanceDigest})
			sourceReplaySeal(t, session, first, "committed")
			proposal := sourceReplayBegin(t, session, prepare, contracts, nil)
			if proposal["status"] != "products" || session.productsSession.ReplayExpected == nil {
				t.Fatal("compiler-input fixture did not replay", proposal)
			}
			if err := os.WriteFile(path, []byte(replacement), 0600); err != nil {
				t.Fatal(err)
			}
			sourceReplaySeal(t, session, proposal, "retry")
			if session.sealedDecisions != nil {
				t.Fatal("failed original barrier retained stale source decisions")
			}
			fresh := sourceReplayBegin(t, session, prepare, contracts, nil)
			if fresh["status"] != "source" || session.productsSession.ReplayExpected != nil {
				t.Fatal("changed input did not select fresh ownership", fresh)
			}
			sourceReplaySeal(t, session, sourceReplayComplete(t, session, fresh), "committed")
		})
	}
}

func TestWholeSourceReplayReobservesCanonicalLeafMeaning(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "index.ts", "export const value = 1\n")
	contracts := callerContracts(t, true)
	prepare := callerPrepare(root, contracts, true)
	session := &governanceSession{root: root}
	t.Cleanup(session.discardProducts)
	frame := sourceReplayBegin(t, session, prepare, contracts, nil)
	state := session.productsSession
	governanceSourceObservationFixture(t, session)
	// A real installed canonical callback records its obligation before answering.
	governanceSharedProject(state.Project).LocaleOrder([]string{"z", "a"})
	leaf := state.Requirements[0]
	before := governanceIntrinsicAnswer{ID: leaf.ID, Kind: leaf.Kind, Groups: [][]int{{1}, {0}}}
	raw, _ := json.Marshal(map[string]any{"kind": "intrinsics", "token": state.Token, "answers": []governanceIntrinsicAnswer{before}})
	value, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	frame = value.(map[string]any)
	first := sourceReplayComplete(t, session, frame)
	sourceReplaySeal(t, session, first, "committed")
	next := sourceReplayBegin(t, session, prepare, contracts, nil)
	state = session.productsSession
	if next["status"] != "intrinsics" || state.ReplayExpected == nil || !reflect.DeepEqual(state.Requirements, []governanceIntrinsic{leaf}) {
		t.Fatal("sealed proposal skipped its original canonical leaf", next)
	}
	after := before
	after.Groups = [][]int{{0}, {1}}
	raw, _ = json.Marshal(map[string]any{"kind": "intrinsics", "token": state.Token, "answers": []governanceIntrinsicAnswer{after}})
	value, err = session.continueProducts(raw)
	if err != nil || value.(map[string]any)["status"] != "source" || state.ReplayExpected != nil || state.SourceProducts != nil || session.sealedDecisions != nil {
		t.Fatal("changed canonical leaf retained stale source products", value, err)
	}
	sourceReplaySeal(t, session, sourceReplayComplete(t, session, value.(map[string]any)), "committed")
}

func TestWholeSourceReplayKeysStillOwnCurrentAuthority(t *testing.T) {
	for _, changed := range []string{"source", "catalog", "contract", "options", "policy"} {
		t.Run(changed, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export const value = 1\n")
			contracts := callerContracts(t, true)
			prepare := callerPrepare(root, contracts, true)
			session := &governanceSession{root: root}
			t.Cleanup(session.discardProducts)
			first := sourceReplayComplete(t, session, sourceReplayBegin(t, session, prepare, contracts, nil))
			sourceReplaySeal(t, session, first, "committed")
			disabled := []governanceDisabledRule{}
			switch changed {
			case "source":
				governanceWrite(t, root, "index.ts", "export const value = 2\n")
			case "catalog":
				revisions := prepare["ruleRevisions"].([]map[string]string)
				revisions[len(revisions)-1]["revision"] = governanceHash([]byte("new catalog-only meaning"))
			case "contract":
				contracts[0]["implementation"].(map[string]any)["version"] = "current-caller-version"
			case "options":
				prepare["options"].(map[string]any)["debugPhaseCounters"] = true
			case "policy":
				disabled = append(disabled, governanceDisabledRule{contracts[0]["ruleId"].(string), "current policy"})
			}
			next := sourceReplayBegin(t, session, prepare, contracts, disabled)
			if next["status"] != "source" || session.productsSession.ReplayExpected != nil || session.productsSession.SourceProducts != nil {
				t.Fatal("changed current authority reused stale products", changed, next)
			}
			sourceReplaySeal(t, session, sourceReplayComplete(t, session, next), "committed")
		})
	}
}

func TestWholeSourcePartialCompletionCannotBecomeSealedProposal(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "index.ts", "export const value = 1\n")
	contracts := callerContracts(t, true)
	prepare := callerPrepare(root, contracts, true)
	session := &governanceSession{root: root}
	t.Cleanup(session.discardProducts)
	sourceReplayBegin(t, session, prepare, contracts, nil)
	governanceSourceObservationFixture(t, session)
	state := session.productsSession
	raw, _ := json.Marshal(map[string]any{"kind": "source-complete", "token": state.Token, "generation": state.Generation,
		"sourceSnapshotDigest": state.Project.GovernanceDigest, "decisions": []any{}})
	if _, err := session.continueProducts(raw); err == nil || state.SourceProducts != nil || state.ProductsDigest != "" {
		t.Fatal("partial source completion was admitted")
	}
	session.retainSealedDecisions(state)
	if session.sealedDecisions != nil {
		t.Fatal("partial source completion was cached")
	}
	// [] is complete only at the successful products frontier, not merely because
	// a caller supplied an empty slice while the capture is still pending.
	state.SourceProducts = []governanceRuleProduct{}
	session.retainSealedDecisions(state)
	if session.sealedDecisions != nil {
		t.Fatal("unfinished empty source authority was cached")
	}
	state.SourceProducts = nil
	state.Project.familyResidual = []string{"actual incomplete observation"}
	result, err := session.evaluateProducts()
	if err != nil || result.(map[string]any)["status"] != "partial" || session.productsSession != nil || session.sealedDecisions != nil {
		t.Fatal("partial report escaped retirement", result, err)
	}
}

func TestSourceOwner2StillRequiresNativeRuntimeCompletion(t *testing.T) {
	session := sourceContractSession(t, map[string]bool{"IMP-STATIC": true}, nil)
	state := session.productsSession
	frame, err := session.evaluateProducts()
	if err != nil {
		t.Fatal(err)
	}
	products := sourceReplayComplete(t, session, frame.(map[string]any))
	if len(state.RuntimeReady) != 0 {
		t.Fatal("disabled native semantic fixtures unexpectedly ran")
	}
	sourceReplaySeal(t, session, products, "committed")
	if session.sealedDecisions != nil {
		t.Fatal("owner2 retained without its original native runtime completion")
	}
}
