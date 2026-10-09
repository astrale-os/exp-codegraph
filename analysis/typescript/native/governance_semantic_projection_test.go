package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func semanticProjectionRecapture(t *testing.T, session *governanceSession, root string, revision int) governanceSemanticRequest {
	t.Helper()
	session.discardProducts()
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	project.capture.compilerInputs()
	state := &governanceProductsSession{Project: project, Token: fmt.Sprintf("capture-%d", revision), Generation: fmt.Sprint(revision),
		Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":3}`)}}
	session.productsSession = state
	governanceSourceObservationFixture(t, session)
	input := governanceSemanticRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: project.GovernanceDigest}
	raw, _ := json.Marshal(input)
	value, err := session.openSemanticProjection(raw)
	if err != nil {
		t.Fatal(err)
	}
	input.Lease = value.(map[string]any)["lease"].(string)
	return input
}

func semanticProjectionFixture(t *testing.T) (*governanceSession, string, governanceSemanticRequest) {
	t.Helper()
	session, root := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `import {helper} from './schema/helper';export const value=helper();`)
		governanceWrite(t, root, "schema/helper.ts", `export function helper(){return 'before'}`)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"include":["index.ts","schema/**/*.ts"]}`)
	})
	state := session.productsSession
	state.Prepare.Options = json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":3}`)
	governanceSourceObservationFixture(t, session)
	input := governanceSemanticRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: state.Project.GovernanceDigest}
	raw, _ := json.Marshal(input)
	value, err := session.openSemanticProjection(raw)
	if err != nil {
		t.Fatal(err)
	}
	input.Lease = value.(map[string]any)["lease"].(string)
	return session, root, input
}

func semanticProjectionRequest(t *testing.T, session *governanceSession, input governanceSemanticRequest, req request) (any, error) {
	t.Helper()
	input.Request = req
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	return session.requestSemanticProjection(raw)
}

func semanticProjectionRefresh(t *testing.T, session *governanceSession, input governanceSemanticRequest, paths, owners []string) *factTransaction {
	t.Helper()
	projection := session.productsSession.semanticReaders[input.Lease]
	base := projection.acknowledged.generation
	value, err := semanticProjectionRequest(t, session, input, request{ID: 1, Kind: "refresh", Base: base.ID, BaseSequence: base.Sequence,
		BodyDemand: &bodyDemandRecipe{Paths: paths, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	response := value.(map[string]any)["response"].(map[string]any)
	if response["kind"] == "unchanged" {
		return nil
	}
	transaction := response["transaction"].(*factTransaction)
	_, err = semanticProjectionRequest(t, session, input, request{ID: 2, Kind: "acknowledge", Generation: transaction.Next.ID, Sequence: transaction.Next.Sequence})
	if err != nil {
		t.Fatal(err)
	}
	return transaction
}

func TestCapturedSemanticProjectionBorrowsExactlyOneProgramAndDemandCache(t *testing.T) {
	session, _, input := semanticProjectionFixture(t)
	project := session.productsSession.Project
	thin := semanticProjectionRefresh(t, session, input, []string{}, []string{})
	program := project.typeOwner.program
	if program == nil || project.stats.CompilerPrograms != 1 {
		t.Fatal("projection did not borrow one captured compiler")
	}
	before, _ := json.Marshal(thin)
	projection := session.productsSession.semanticReaders[input.Lease]
	cache := projection.cache
	if !cache.ready || len(cache.fullBodies) != 0 {
		t.Fatal("thin acquisition materialized unrequested bodies")
	}
	selected := semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{})
	if selected == nil || selected.Base != thin.Next.ID || selected.Next.Sequence != thin.Next.Sequence+1 {
		t.Fatal("selection broke acknowledged fact lineage")
	}
	if projection.cache != cache || project.typeOwner.program != program || project.stats.CompilerPrograms != 1 {
		t.Fatal("selection created another compiler or extractor")
	}
	var helper string
	for _, body := range cache.bodies {
		if body.path == "schema/helper.ts" && body.scope == "function" {
			helper = body.owner
		}
	}
	if helper == "" || cache.fullBodies[helper].Key != "" {
		t.Fatal("unrequested helper was eagerly materialized")
	}
	expanded := semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{helper})
	if expanded == nil || cache.fullBodies[helper].Key == "" || project.typeOwner.program != program || project.stats.CompilerPrograms != 1 {
		t.Fatal("deferred owner did not reuse the captured Program")
	}
	if semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{helper}) != nil {
		t.Fatal("identical recipe republished facts")
	}
	after, _ := json.Marshal(thin)
	if string(before) != string(after) {
		t.Fatal("body expansion mutated an earlier published transaction")
	}
}

func TestCapturedSemanticProjectionRequiresOwnedPhaseAndExactStamp(t *testing.T) {
	for _, mode := range []string{"token", "generation", "digest", "lease", "revision2", "unopened", "unprojected", "complete", "retired"} {
		t.Run(mode, func(t *testing.T) {
			session, _, input := semanticProjectionFixture(t)
			state := session.productsSession
			switch mode {
			case "token":
				input.Token = "foreign"
			case "generation":
				input.Generation = "foreign"
			case "digest":
				input.SourceSnapshotDigest = strings.Repeat("a", 64)
			case "lease":
				input.Lease = "foreign"
			case "revision2":
				state.Prepare.Options = json.RawMessage(`{"sourcePolicyOwnerRevision":2}`)
			case "unopened":
				state.sourceBody.opened = false
			case "unprojected":
				state.sourceBody.projected = false
			case "complete":
				state.SourceProducts = []governanceRuleProduct{}
			case "retired":
				session.discardProducts()
			}
			owners := []string{}
			_, err := semanticProjectionRequest(t, session, input, request{ID: 1, Kind: "refresh", BodyDemand: &bodyDemandRecipe{Paths: []string{}, Owners: &owners}})
			if err == nil {
				t.Fatal("foreign or terminal reader selected a compiler owner")
			}
		})
	}
}

func TestCapturedSemanticProjectionRejectsDiscoveryRetractionAndWrongAcknowledgement(t *testing.T) {
	for _, mode := range []string{"discover", "changed", "base", "sequence", "unacknowledged", "wrong-ack", "retraction", "unknown-owner"} {
		t.Run(mode, func(t *testing.T) {
			session, _, input := semanticProjectionFixture(t)
			first := semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{})
			owners := []string{}
			req := request{ID: 3, Kind: "refresh", Base: first.Next.ID, BaseSequence: first.Next.Sequence, BodyDemand: &bodyDemandRecipe{Paths: []string{"index.ts"}, Owners: &owners}}
			switch mode {
			case "discover":
				req.Discover = true
			case "changed":
				req.Changed = []string{"index.ts"}
			case "base":
				req.Base = "foreign"
			case "sequence":
				req.BaseSequence++
			case "unacknowledged":
				session.productsSession.semanticReaders[input.Lease].pending = &pendingGeneration{}
			case "wrong-ack":
				req = request{ID: 3, Kind: "acknowledge", Generation: first.Next.ID, Sequence: first.Next.Sequence}
			case "retraction":
				req.BodyDemand.Paths = []string{}
			case "unknown-owner":
				owners = []string{"symbol:" + strings.Repeat("a", 64)}
				req.BodyDemand.Owners = &owners
			}
			_, err := semanticProjectionRequest(t, session, input, req)
			if err == nil {
				t.Fatal("invalid projection transition was admitted")
			}
		})
	}
}

func TestCapturedSemanticProjectionPinsBytesAndFinalPublicationStillRejectsEdit(t *testing.T) {
	session, root, input := semanticProjectionFixture(t)
	semanticProjectionRefresh(t, session, input, []string{}, []string{})
	project := session.productsSession.Project
	governanceWrite(t, root, "schema/helper.ts", `export function helper(){return 'edited'}`)
	transaction := semanticProjectionRefresh(t, session, input, []string{"schema/helper.ts"}, []string{})
	wire, _ := json.Marshal(transaction)
	if !strings.Contains(string(wire), "before") || strings.Contains(string(wire), "edited") {
		t.Fatal("deferred demand reread edited bytes")
	}
	if valid, err := project.capture.Verify(); valid || err != nil {
		t.Fatal("old capture admitted changed filesystem inputs", valid, err)
	}
}

func TestCapturedSemanticProjectionDisposeCannotRetargetCurrentLease(t *testing.T) {
	session, _, input := semanticProjectionFixture(t)
	old := input
	old.Token = "retired"
	if _, err := semanticProjectionRequest(t, session, old, request{ID: 1, Kind: "dispose"}); err != nil {
		t.Fatal(err)
	}
	if len(session.productsSession.semanticReaders) != 1 {
		t.Fatal("old disposer released current lease")
	}
	if _, err := semanticProjectionRequest(t, session, input, request{ID: 2, Kind: "dispose"}); err != nil {
		t.Fatal(err)
	}
	if len(session.productsSession.semanticReaders) != 0 {
		t.Fatal("live disposer retained its projection cache")
	}
	if _, err := semanticProjectionRequest(t, session, input, request{ID: 3, Kind: "dispose"}); err != nil {
		t.Fatal("dispose is not idempotent", err)
	}
}

func TestCapturedSemanticProjectionRecomputesExactLineageAcrossCaptures(t *testing.T) {
	session, root, input := semanticProjectionFixture(t)
	// The unrelated source is compiler-owned but is outside the requested body recipe.
	governanceWrite(t, root, "schema/unrelated.ts", "export const unrelated=1")
	input = semanticProjectionRecapture(t, session, root, 1)
	first := semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{})
	firstState := session.semanticPublished
	selectedKeys := map[string]bool{}
	cache := session.productsSession.semanticReaders[input.Lease].cache
	for _, body := range cache.bodies {
		if body.path == "index.ts" {
			if shard := cache.fullBodies[body.owner]; shard.Key != "" {
				selectedKeys[shard.Key] = true
			}
		}
	}
	if len(selectedKeys) == 0 {
		t.Fatal("fixture selected no body facts")
	}
	originalProgram := session.productsSession.Project.typeOwner.program
	owners := []string{}
	next := semanticProjectionRecapture(t, session, root, 2)
	value, err := semanticProjectionRequest(t, session, next, request{ID: 1, Kind: "refresh", Base: first.Next.ID, BaseSequence: first.Next.Sequence,
		BodyDemand: &bodyDemandRecipe{Paths: []string{"index.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	response := value.(map[string]any)["response"].(map[string]any)
	if response["kind"] != "unchanged" || response["generation"] != first.Next.ID {
		t.Fatalf("no-op rebuilt a different fact generation: %#v", response)
	}
	if session.productsSession.Project.typeOwner.program == originalProgram || session.productsSession.Project.stats.CompilerPrograms != 1 {
		t.Fatal("new capture retained an old compiler or opened an additional one")
	}
	if session.semanticPublished.generation.ID != firstState.generation.ID || session.semanticPublished.generation.Sequence != firstState.generation.Sequence {
		t.Fatal("no-op discarded acknowledged publication metadata")
	}
	governanceWrite(t, root, "schema/unrelated.ts", "export const unrelated=2")
	third := semanticProjectionRecapture(t, session, root, 3)
	value, err = semanticProjectionRequest(t, session, third, request{ID: 1, Kind: "refresh", Base: first.Next.ID, BaseSequence: first.Next.Sequence,
		BodyDemand: &bodyDemandRecipe{Paths: []string{"index.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	response = value.(map[string]any)["response"].(map[string]any)
	if response["kind"] != "transaction" {
		t.Fatalf("changed input did not publish new facts: %#v", response)
	}
	delta := response["transaction"].(*factTransaction)
	if delta.Base != first.Next.ID || delta.Next.Sequence != first.Next.Sequence+1 {
		t.Fatal("cross-capture delta lost its exact acknowledged base")
	}
	for _, shard := range delta.Upserts {
		if selectedKeys[shard.Key] {
			t.Fatal("unrelated edit republished selected body")
		}
	}
	// A forged old base can never adopt the producer's last acknowledged metadata.
	fourth := semanticProjectionRecapture(t, session, root, 4)
	value, err = semanticProjectionRequest(t, session, fourth, request{ID: 1, Kind: "refresh", Base: "foreign-generation", BaseSequence: 9,
		BodyDemand: &bodyDemandRecipe{Paths: []string{"index.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	rebased := value.(map[string]any)["response"].(map[string]any)["transaction"].(*factTransaction)
	if rebased.Base != "" || len(rebased.Upserts) != len(rebased.Manifest) {
		t.Fatal("unknown metadata bypassed complete baseless adoption")
	}
}

func TestCapturedSemanticAuthorityPreservesOrderedCompleteDecisionsAndBudgetErrors(t *testing.T) {
	for _, mode := range []string{"complete-52", "missing-semantic", "wrong-order", "invalid-budget"} {
		t.Run(mode, func(t *testing.T) {
			session, _ := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "mutations/index.ts", "export const value=1")
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"noLib":true,"types":[]},"include":["mutations/**/*.ts"]}`)
			})
			state := session.productsSession
			state.Prepare.Options = json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":3}`)
			state.Project.Disabled = map[string]string{}
			decisions := []any{}
			for id, revision := range governanceRevisions {
				identity := "astrale.sdk.typescript-source"
				if id == "QRY-CANON" || id == "QRY-SINGLE" || id == "QLT-DEF-IDS" {
					identity = "astrale.sdk.codegraph"
				}
				state.Contracts = append(state.Contracts, governanceImplementationContract{RuleID: id, RuleRevision: revision, Implementation: governanceImplementation{identity, "1"}})
				decisions = append(decisions, map[string]any{"id": id, "decision": map[string]any{"status": "pass"}})
			}
			if mode == "invalid-budget" {
				state.Prepare.Options = json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":3,"budgetValidation":{"kind":"invalid","field":"maximumSteps","reason":"positive-integer"}}`)
			}
			first, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			if first.(map[string]any)["semanticAuthorityRevision"] != 1 {
				t.Fatal("revision three omitted semantic authority")
			}
			opened, _ := json.Marshal(map[string]any{"token": state.Token, "kind": "source-open", "generation": state.Generation, "sourceSnapshotDigest": state.Project.GovernanceDigest})
			projection, err := session.continueProducts(opened)
			if mode == "invalid-budget" {
				if err == nil || !strings.Contains(err.Error(), "maximumSteps") || state.SourceProducts != nil {
					t.Fatal("invalid semantic budget entered SDK source ownership", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if projection.(map[string]any)["semanticAuthorityRevision"] != 1 || len(state.RuntimeReady) != 0 {
				t.Fatal("revision three ran duplicate Go SDK semantic rules")
			}
			if mode == "missing-semantic" {
				for i, contract := range state.Contracts {
					if contract.RuleID == "QRY-CANON" {
						decisions = append(decisions[:i], decisions[i+1:]...)
						break
					}
				}
			}
			if mode == "wrong-order" {
				decisions[0], decisions[1] = decisions[1], decisions[0]
			}
			raw, _ := json.Marshal(map[string]any{"token": state.Token, "kind": "source-complete", "generation": state.Generation, "sourceSnapshotDigest": state.Project.GovernanceDigest, "decisions": decisions})
			result, err := session.continueProducts(raw)
			if mode != "complete-52" {
				if err == nil || state.SourceProducts != nil || state.ProductsDigest != "" {
					t.Fatal("incomplete or unordered coverage entered ready ownership")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(state.SourceProducts) != 52 || result.(map[string]any)["status"] != "products" || len(state.RuntimeReady) != 0 {
				t.Fatal("complete source ownership did not retain all 52 decisions")
			}
		})
	}
}
