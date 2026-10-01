package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Exercise actual type-demand cache entries, original compiler leases and original
// barrier failure; pointer identity alone would not catch lost invalidation.
func TestHeapCacheOwnerTransferPreservesRetainedLeaseInvalidation(t *testing.T) {
	root := typeDemandFixture(t)
	session := &governanceSession{}
	heap := session.typeDemandOwner()
	first, before := testTypeDemand(t, root, heap)
	if !reflect.DeepEqual(before.Names, []string{"before"}) || len(heap.entries) == 0 {
		t.Fatal("fresh original typed cache not populated", before)
	}
	current, file, node := typeDemandTestProject(t, root, heap)
	if value := current.typeOwner.names(file, node); !reflect.DeepEqual(value, before) || len(current.capture.typeCacheLeases) != 1 {
		t.Fatal("original replay lease not retained", value)
	}
	lease := current.capture.typeCacheLeases[0]
	oldCallback := func() int { return len(first.typeOwner.project.typeDemandCache.entries) }
	private := &governanceSession{typeDemandCache: heap, productsSession: &governanceProductsSession{Project: current}}
	session.typeDemandCache = nil
	lane := &governancePolicyLane{done: make(chan governancePolicyLaneResult, 1)}
	session.policyLane = lane
	lane.done <- governancePolicyLaneResult{owner: private}
	session.takePolicyLane()
	if session.typeDemandOwner() != heap || private.typeDemandCache != nil || current.typeDemandCache != heap || lease.cache != heap || first.typeDemandCache != heap || oldCallback() == 0 {
		t.Fatal("cache ownership relocated or former actor retained its pointer")
	}
	// A late continuation still reaches this same owner through the existing AST
	// callback's project. Its original lease must invalidate the live owner's key.
	current.typeOwner.cells = nil
	if value := current.typeOwner.names(file, node); !reflect.DeepEqual(value, before) {
		t.Fatal("late canonical continuation lost original cell", value)
	}
	governanceWrite(t, root, "schema/value.ts", `export const subject={after:1};`)
	valid, err := current.capture.Verify()
	if err != nil || valid {
		t.Fatal("original late source edit escaped lease", valid, err)
	}
	for key := range lease.cacheKeys {
		if _, exists := session.typeDemandCache.entries[key]; exists {
			t.Fatal("retained original lease invalidated abandoned cache location instead of current heap owner")
		}
	}
	if oldCallback() != 0 {
		t.Fatal("old compiler callback did not observe retirement of same heap")
	}
	session.discardProducts()
}

func TestHeapCacheOwnerTwoTransfersRetireProgramAndCheckerExactlyOnce(t *testing.T) {
	root := typeDemandFixture(t)
	session := &governanceSession{}
	heap := session.typeDemandOwner()
	first, file, node := typeDemandTestProject(t, root, heap)
	first.typeOwner.names(file, node)
	release := first.typeRelease
	releases := 0
	first.typeRelease = func() { releases++; release() }
	if status := generationSessionSeal(t, session, first, "first"); status != "committed" || releases != 1 || session.programGeneration == nil {
		t.Fatal("original Program generation not sealed/released", status, releases)
	}
	originalGeneration := session.programGeneration
	originalBroker := originalGeneration.broker
	oldCallback := func() *governanceTypeDemandCache { return first.typeOwner.project.typeDemandCache }
	// Both transfers use the actual production transfer operation. No alias is
	// rebound: current project, old compiler callback and leases keep one heap.
	for turn := 0; turn < 2; turn++ {
		current, cf, cn := typeDemandTestProject(t, root, heap)
		current.typeOwner.names(cf, cn)
		current.programGeneration = originalGeneration
		private := &governanceSession{typeDemandCache: session.typeDemandCache, programGeneration: session.programGeneration, productsSession: &governanceProductsSession{Project: current}}
		session.typeDemandCache = nil
		session.programGeneration = nil
		lane := &governancePolicyLane{done: make(chan governancePolicyLaneResult, 1)}
		session.policyLane = lane
		lane.done <- governancePolicyLaneResult{owner: private}
		session.takePolicyLane()
		if session.typeDemandOwner() != heap || private.typeDemandCache != nil || oldCallback() != heap || current.typeDemandCache != heap || current.programGeneration != originalGeneration || originalGeneration.broker != originalBroker {
			t.Fatal("second transfer displaced stable owner or original metadata callback")
		}
		for _, lease := range current.capture.typeCacheLeases {
			if lease.cache != heap {
				t.Fatal("lease moved away from owning heap")
			}
		}
	}
	// A real public UpdateProgram proposal consumes the old original generation.
	governanceWrite(t, root, "schema/value.ts", `export const subject={after:1};`)
	proposed, pf, pn := typeDemandTestProject(t, root, heap)
	proposed.programGeneration = session.programGeneration
	value := proposed.typeOwner.names(pf, pn)
	if !reflect.DeepEqual(value.Names, []string{"after"}) || proposed.borrowedGeneration == nil || proposed.typeDemandCache != heap || len(heap.entries) == 0 {
		t.Fatal("real speculative generation missing stable current owner", value)
	}
	currentRelease := proposed.typeRelease
	currentReleases := 0
	proposed.typeRelease = func() { currentReleases++; currentRelease() }
	session.productsSession = &governanceProductsSession{Project: proposed, Token: "proposal", Generation: "2", ProductsDigest: strings.Repeat("a", 64)}
	governanceWrite(t, root, "schema/value.ts", `export const subject={late:1};`)
	response, err := session.sealProducts("proposal", strings.Repeat("a", 64), strings.Repeat("b", 64))
	if err != nil || response.(map[string]any)["status"] != "retry" || session.typeDemandOwner() != heap || len(heap.entries) != 0 || session.programGeneration != nil || oldCallback() != heap || currentReleases != 1 {
		t.Fatalf("retry failed exact stable owner retirement: %#v %v releases=%d", response, err, currentReleases)
	}
	session.discardProducts()
	session.discardProducts()
	if currentReleases != 1 || releases != 1 {
		t.Fatal("checker release repeated across drain/retirement")
	}
}

func TestHeapCacheOwnerOriginalStartMovesOnlyPointerBeforeGenericActorRuns(t *testing.T) {
	session, _ := governanceLaneFixture(t, true)
	session.drainPolicyLane()
	if session.productsSession == nil || session.productsSession.Project == nil {
		t.Fatal("original runtime lane did not complete")
	}
	heap := session.typeDemandOwner()
	previousProject := session.productsSession.Project
	if previousProject.typeDemandCache != heap {
		t.Fatal("project did not borrow cache heap")
	}
	oldCallback := func() *governanceTypeDemandCache { return previousProject.typeDemandCache }
	session.discardProducts()
	// The next real prepare/start performs exclusive pointer movement; the helper
	// uses the same native policy/controller paths, without any cache rebind.
	session.productsSession = &governanceProductsSession{Prepare: governancePrepare{Root: session.root}}
	config, err := session.captureConfiguration(session.root)
	if err != nil {
		t.Fatal(err)
	}
	raw := privateCachePolicyContinuation(t, config["token"])
	response, err := session.continueProducts(raw)
	if err != nil || response.(map[string]any)["status"] != "generic" || session.typeDemandCache != nil || oldCallback() != heap {
		t.Fatal("old actor retained cache access after original start", response, err)
	}
	session.drainPolicyLane()
	if session.typeDemandOwner() != heap || oldCallback() != heap || session.productsSession.Project.typeDemandCache != heap {
		t.Fatal("real start/drain changed retained callback location")
	}
	session.discardProducts()
}

func privateCachePolicyContinuation(t *testing.T, token any) []byte {
	t.Helper()
	disabled := []governanceDisabledRule{}
	contracts := []governanceImplementationContract{}
	for rule, revision := range governanceRevisions {
		disabled = append(disabled, governanceDisabledRule{rule, "fixture"})
		implementation := "astrale.sdk.typescript-source"
		if rule == "QRY-CANON" || rule == "QRY-SINGLE" || rule == "QLT-DEF-IDS" {
			implementation = "astrale.sdk.codegraph"
		}
		contracts = append(contracts, governanceImplementationContract{RuleID: rule, RuleRevision: revision, Implementation: governanceImplementation{implementation, "1"}})
	}
	raw, err := json.Marshal(map[string]any{"token": token, "kind": "policy", "policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical", Disabled: disabled}, "implementationContracts": contracts})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestHeapCacheOwnerLateLeaseRetirementDoesNotInvalidateOtherOwner(t *testing.T) {
	session := &governanceSession{}
	heap := session.typeDemandOwner()
	other := &governanceTypeDemandCache{entries: map[governanceTypeDemandKey]governanceTypeDemandEntry{}}
	key := governanceTypeDemandKey{path: filepath.Join(t.TempDir(), "source.ts")}
	heap.entries = map[governanceTypeDemandKey]governanceTypeDemandEntry{key: {}}
	other.entries[key] = governanceTypeDemandEntry{}
	lease := newGovernanceTypeCacheLease(heap, key, &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{key.path: {"before", true}}, barrierObservations: map[compilerInputKey]string{}})
	// A fresh original disk failure contradicts the positive assertion and retires
	// only the one heap named by the retained lease, including after transfers.
	if lease.verifyBarrierWorld(&governanceTypeReplayWorld{disk: newAuthoredCompilerDisk(), reads: map[string]compilerRawRead{}, observations: map[compilerInputKey]string{}}) || len(heap.entries) != 0 || len(other.entries) != 1 {
		t.Fatal("retirement crossed cache-owner identity")
	}
}
