package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestBodyDemandExplicitOwnersReuseCapturedInventoryAndRetireMembership(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	var events bytes.Buffer
	writer := bufio.NewWriter(&events)
	a.telemetry = &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	empty := []string{}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	assertDemandMatchesFull(t, initial, oracle)
	if !demandPayload(t, initial).Observed {
		t.Fatal("explicit owner recipe lost its observed materialization contract")
	}
	original := stableJSON(initial)
	cache := a.demandCache
	catalogue := cache.snapshot
	missing := ""
	for _, owner := range demandPayload(t, initial).Owners {
		if owner.Materialized != (owner.Path == "entry.ts") {
			t.Fatal("explicit empty owners performed a static closure")
		}
		if !owner.Materialized && missing == "" {
			missing = owner.Owner
		}
	}
	if missing == "" {
		t.Fatal("fixture lacks an omitted dependency")
	}
	empty = append(empty, missing)
	if len(*a.pending.state.bodyDemand.Owners) != 0 {
		t.Fatal("caller mutated an unpublished recipe")
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	events.Reset()
	owners := []string{missing}
	expanded, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	if a.demandCache != cache || cache.snapshot != catalogue {
		t.Fatal("recipe-only expansion recaptured the global inventory")
	}
	assertDemandMatchesFull(t, expanded, oracle)
	for _, owner := range demandPayload(t, expanded).Owners {
		if owner.Materialized != (owner.Path == "entry.ts" || owner.Owner == missing) {
			t.Fatal("explicit owner recipe expanded unrelated dependencies")
		}
	}
	if stableJSON(initial) != original {
		t.Fatal("expansion mutated an already published transaction")
	}
	writer.Flush()
	if bytes.Contains(events.Bytes(), []byte(`"phase":"projection.source-inventory"`)) || !bytes.Contains(events.Bytes(), []byte(`"phase":"projection.demand-cache"`)) {
		t.Fatal("recipe-only expansion rehashed sources or failed to reuse its capture")
	}
	cold := openBodyDemandAnalyzer(t, root)
	defer cold.close()
	fresh, _, err := cold.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Next.ID != expanded.Next.ID {
		t.Fatal("cache expansion differs from a fresh compiler with the same exact recipe")
	}
	if err := a.acknowledge(request{Generation: expanded.Next.ID, Sequence: 2}); err != nil {
		t.Fatal(err)
	}
	noOwners := []string{}
	shrunk, _, err := a.refresh(request{ID: 3, Base: expanded.Next.ID, BaseSequence: 2, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &noOwners}})
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range demandPayload(t, shrunk).Owners {
		if owner.Materialized && owner.Owner == missing {
			t.Fatal("cached body leaked into shrunken publication membership")
		}
	}
	if len(shrunk.Deletes) == 0 {
		t.Fatal("shrinking did not retire its former body shard")
	}
	if err := a.acknowledge(request{Generation: shrunk.Next.ID, Sequence: 3}); err != nil {
		t.Fatal(err)
	}
	// Omission remains the original conservative contract, distinct from [].
	conservative, _, err := a.refresh(request{ID: 4, Base: shrunk.Next.ID, BaseSequence: 3, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}}})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	if demandPayload(t, conservative).Observed {
		t.Fatal("omitted owner recipe changed its conservative H11 contract")
	}
	for _, owner := range demandPayload(t, conservative).Owners {
		if owner.Materialized && owner.Path != "entry.ts" {
			count++
		}
	}
	if count == 0 {
		t.Fatal("explicit empty owner recipe collapsed into omitted conservative semantics")
	}
}

func TestBodyDemandCaptureRetiresOnRealEditAndAcceptsVanishedOwner(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	initial, _, err := a.refresh(request{ID: 1, Discover: true, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	cache := a.demandCache
	owners := []string{}
	for _, owner := range demandPayload(t, initial).Owners {
		if owner.Path == "shared.ts" && owner.Scope == "function" {
			owners = append(owners, owner.Owner)
		}
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shared.ts"), []byte("export const settings = { id:'changed' }; export const identity = undefined; export const callback = undefined; export const unused = undefined;"), 0644); err != nil {
		t.Fatal(err)
	}
	changed, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Discover: true, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	if a.demandCache == cache {
		t.Fatal("real compiler movement retained the old capture")
	}
	for _, owner := range demandPayload(t, changed).Owners {
		for _, absent := range owners {
			if owner.Owner == absent {
				t.Fatal("vanished requested owner survived the inventory")
			}
		}
	}
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	assertDemandMatchesFull(t, changed, oracle)
	cold := openBodyDemandAnalyzer(t, root)
	defer cold.close()
	fresh, _, err := cold.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	if changed.Next.ID != fresh.Next.ID {
		t.Fatal("edit with vanished requested owner differs from fresh compiler")
	}
	// The native-owned copy preserves [] even in stable recipe identity.
	admitted, err := admitBodyDemand(&bodyDemandRecipe{Paths: []string{}, Owners: &empty})
	if err != nil {
		t.Fatal(err)
	}
	omitted, err := admitBodyDemand(&bodyDemandRecipe{Paths: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(admitted, omitted) || stableJSON(admitted) == stableJSON(omitted) {
		t.Fatal("omitted and explicit empty owners have the same recipe identity")
	}
}

func TestBodyDemandCachedExpansionFailureAndDiscoveryRemainCoherent(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	initial, _, err := a.refresh(request{ID: 1, Discover: true, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	owners := []string{}
	for _, owner := range demandPayload(t, initial).Owners {
		if !owner.Materialized {
			owners = append(owners, owner.Owner)
		}
	}
	a.maximumSemanticPayloadBytes = 1
	_, _, err = a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err == nil || a.pending != nil || a.acknowledged.generation.ID != initial.Next.ID {
		t.Fatal("failed cached expansion corrupted acknowledged publication")
	}
	a.maximumSemanticPayloadBytes = 0
	repaired, _, err := a.refresh(request{ID: 3, Base: initial.Next.ID, BaseSequence: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	cold := openBodyDemandAnalyzer(t, root)
	defer cold.close()
	fresh, _, err := cold.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &owners}})
	if err != nil {
		t.Fatal(err)
	}
	if repaired.Next.ID != fresh.Next.ID {
		t.Fatal("cached failure recovery changed exact fact identity")
	}
	if !reflect.DeepEqual(a.pending.state.callableReads, cold.pending.state.callableReads) {
		t.Fatal("reusing failed body preparation lost compiler read ownership")
	}
	if err := a.acknowledge(request{Generation: repaired.Next.ID, Sequence: 2}); err != nil {
		t.Fatal(err)
	}
	cache := a.demandCache
	mutation := &discoveryMutationWriter{path: filepath.Join(root, "entry.ts"), remaining: 1}
	writer := bufio.NewWriter(mutation)
	a.telemetry = &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	coherent, _, err := a.refresh(request{ID: 4, Base: repaired.Next.ID, BaseSequence: 2, Discover: true, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	if mutation.writes != 1 || a.demandCache == cache {
		t.Fatal("recipe-only post-extraction discovery mixed captures")
	}
	latest := openBodyDemandAnalyzer(t, root)
	defer latest.close()
	oracle, _, err := latest.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	if coherent.Next.ID != oracle.Next.ID {
		t.Fatal("recipe-only concurrent source edit was published from stale cache")
	}
}

func TestBodyDemandDiscoveryRetiresCacheOnConfigurationMovement(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, Discover: true, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	cache := a.demandCache
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"noLib":true,"strict":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`), 0644); err != nil {
		t.Fatal(err)
	}
	changed, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	if a.demandCache == cache || changed == nil {
		t.Fatal("configuration movement reused the old demand capture")
	}
	cold := openBodyDemandAnalyzer(t, root)
	defer cold.close()
	fresh, _, err := cold.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Next.ID != changed.Next.ID {
		t.Fatal("retained recipe after configuration movement differs from fresh compiler")
	}
}
