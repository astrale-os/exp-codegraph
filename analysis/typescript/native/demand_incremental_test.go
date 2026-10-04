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

func assertSparseDemandFresh(t *testing.T, a *analyzer, current *factTransaction, recipe *bodyDemandRecipe) {
	t.Helper()
	fresh := openBodyDemandAnalyzer(t, a.root)
	defer fresh.close()
	fresh.payloadCodecs = a.payloadCodecs
	fresh.projection.occurrences = a.projection.occurrences
	oracle, _, err := fresh.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if current.Next.ID != oracle.Next.ID || current.Next.SourceManifest != oracle.Next.SourceManifest || stableJSON(current.Manifest) != stableJSON(oracle.Manifest) {
		t.Fatalf("incremental product identity differs from fresh: %s != %s", current.Next.ID, oracle.Next.ID)
	}
	if stableJSON(demandPayload(t, current)) != stableJSON(demandPayload(t, oracle)) || !reflect.DeepEqual(a.pending.state.callableReads, fresh.pending.state.callableReads) {
		t.Fatal("incremental effect/callable authority or read ownership differs from fresh")
	}
	byKey := map[string]factShard{}
	for _, shard := range oracle.Upserts {
		byKey[shard.Key] = shard
	}
	for _, shard := range current.Upserts {
		if stableJSON(shard) != stableJSON(byKey[shard.Key]) {
			t.Fatalf("incremental shard bytes differ from fresh: %s", shard.Namespace)
		}
	}
	// Reassemble the whole current physical product from its retained rows,
	// including omitted/unchanged shards absent from the published delta.
	plan := a.projection
	plan.demand, plan.demandCache = recipe, a.demandCache
	product, _, _, err := a.demandCache.project(plan, 0, 0, nil, 0)
	if err != nil || len(product) != len(byKey) {
		t.Fatalf("whole physical product membership differs: %d != %d: %v", len(product), len(byKey), err)
	}
	for _, shard := range product {
		if shard.Facts != nil {
			shard.Facts = append([]fact{}, shard.Facts...)
		}
		for index := range shard.Facts {
			shard.Facts[index].Generation = current.Next.ID
		}
		if stableJSON(shard) != stableJSON(byKey[shard.Key]) {
			t.Fatalf("whole physical product differs from fresh: %s", shard.Namespace)
		}
	}
	full := openChangeAdmissionAnalyzer(t, a.root, nil)
	defer full.close()
	complete, _, err := full.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	assertDemandMatchesFull(t, current, complete)
}

func TestSparseDemandRealEditsRetainIndependentSourcesAndMatchFresh(t *testing.T) {
	for _, codec := range []string{"", typescriptBodyPayloadCodec} {
		t.Run(codec, func(t *testing.T) {
			root := t.TempDir()
			writeBodyDemandFixture(t, root)
			if err := os.WriteFile(filepath.Join(root, "idle.ts"), []byte(`export const saved = { id:'idle' }; export function idle() { return saved }`), 0644); err != nil {
				t.Fatal(err)
			}
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			root = a.root
			if codec != "" {
				a.payloadCodecs = map[string]bool{codec: true}
			}
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"entry.ts", "idle.ts"}, Owners: &empty}
			current, _, err := a.refresh(request{ID: 1, BodyDemand: recipe, Discover: true})
			if err != nil {
				t.Fatal(err)
			}
			original := stableJSON(current)
			for index, edit := range []struct{ path, text string }{
				{"entry.ts", `import { settings, identity, callback } from './shared'; export const project = () => ({ id: identity('changed'), build: callback }); export const result = project()`},
				{"foreign.ts", `import { settings, unused } from './shared'; declare function outside(value:unknown):void; export function foreign() { const alias = settings; alias.id = 'changed'; outside(alias); unused(settings) }`},
				{"shared.ts", `export const settings = { id:'new' }; export function identity<T>(renamed:T,...tail:T[]):T { return tail[0] ?? renamed }; export const callback = () => ({ ok:false }); export function unused(value:unknown) { return value }`},
				{"shared.ts", `export const settings = { id:'new' }; export function identity<T>(renamed:T,...tail:T[]):T { return tail[0] ?? renamed }; export const callback = undefined; export const unused = undefined; export function added() { return settings }`},
			} {
				if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: index + 1}); err != nil {
					t.Fatal(err)
				}
				old := a.demandCache.snapshot
				record, exists := a.acknowledged.sources[filepath.Join(root, "idle.ts")]
				if !exists || record.Source == "" {
					t.Fatal("independent physical source was not captured")
				}
				idle, exists := old.sources[record.Source]
				if !exists || idle.record.Source != record.Source || idle.record.Physical != record.Physical || len(idle.owners) == 0 {
					t.Fatal("independent sealed source lacks its actual owned rows")
				}
				for _, owner := range idle.owners {
					if owner.Owner == "" || owner.Span.Source != record.Source {
						t.Fatal("independent sealed owner lacks its source identity")
					}
				}
				if err := os.WriteFile(filepath.Join(root, edit.path), []byte(edit.text), 0644); err != nil {
					t.Fatal(err)
				}
				current, _, err = a.refresh(request{ID: index + 2, Base: current.Next.ID, BaseSequence: index + 1, Discover: true, Changed: []string{edit.path}, BodyDemand: recipe})
				if err != nil {
					t.Fatal(err)
				}
				if !a.demandCache.sparseCatalogue || a.demandCache.reuse != nil {
					t.Fatal("ordinary module edit did not activate isolated sparse recapture")
				}
				retained, exists := a.demandCache.snapshot.sources[idle.record.Source]
				if !exists || !reflect.DeepEqual(retained, idle) {
					t.Fatal("independent sealed source changed")
				}
				if stableJSON(demandPayload(t, current)) == "" || stableJSON(current) == original {
					t.Fatal("edit failed to change current capture")
				}
				assertSparseDemandFresh(t, a, current, recipe)
			}
			if stableJSON(a.demandCache.snapshot.payload(recipe, map[string]bool{})) == "" {
				t.Fatal("lost sealed authority")
			}
		})
	}
}

func TestSparseDemandCurrentLazyBodiesFailureAndConservativeRecovery(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "entry.ts"), []byte(`import { settings, identity } from './shared'; export const project = () => identity(settings.id)`), 0644); err != nil {
		t.Fatal(err)
	}
	changed, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"entry.ts"}, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if !a.demandCache.sparseCatalogue {
		t.Fatal("fixture did not select sparse capture")
	}
	owners := []string{}
	for _, owner := range demandPayload(t, changed).Owners {
		if !owner.Materialized {
			owners = append(owners, owner.Owner)
		}
	}
	if err := a.acknowledge(request{Generation: changed.Next.ID, Sequence: 2}); err != nil {
		t.Fatal(err)
	}
	oldInitial, oldChanged := stableJSON(initial), stableJSON(changed)
	a.maximumSemanticPayloadBytes = 1
	_, _, err = a.refresh(request{ID: 3, Base: changed.Next.ID, BaseSequence: 2, BodyDemand: &bodyDemandRecipe{Paths: recipe.Paths, Owners: &owners}})
	if err == nil || a.pending != nil || a.acknowledged.generation.ID != changed.Next.ID {
		t.Fatal("failed sparse lazy expansion corrupted publication")
	}
	a.maximumSemanticPayloadBytes = 0
	expandedRecipe := &bodyDemandRecipe{Paths: recipe.Paths, Owners: &owners}
	expanded, _, err := a.refresh(request{ID: 4, Base: changed.Next.ID, BaseSequence: 2, BodyDemand: expandedRecipe})
	if err != nil {
		t.Fatal(err)
	}
	assertSparseDemandFresh(t, a, expanded, expandedRecipe)
	if stableJSON(initial) != oldInitial || stableJSON(changed) != oldChanged {
		t.Fatal("sparse recapture/lazy materialization renamed old facts")
	}
	if err := a.acknowledge(request{Generation: expanded.Next.ID, Sequence: 3}); err != nil {
		t.Fatal(err)
	}
	expandedBytes := stableJSON(expanded)
	shrunk, _, err := a.refresh(request{ID: 5, Base: expanded.Next.ID, BaseSequence: 3, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	assertSparseDemandFresh(t, a, shrunk, recipe)
	if err := a.acknowledge(request{Generation: shrunk.Next.ID, Sequence: 4}); err != nil {
		t.Fatal(err)
	}
	reexpanded, _, err := a.refresh(request{ID: 6, Base: shrunk.Next.ID, BaseSequence: 4, BodyDemand: expandedRecipe})
	if err != nil {
		t.Fatal(err)
	}
	assertSparseDemandFresh(t, a, reexpanded, expandedRecipe)
	if stableJSON(expanded) != expandedBytes || reexpanded.Next.ID != expanded.Next.ID {
		t.Fatal("sparse recipe shrink/reexpansion renamed old facts")
	}
	if err := a.acknowledge(request{Generation: reexpanded.Next.ID, Sequence: 5}); err != nil {
		t.Fatal(err)
	}
	conservativeRecipe := &bodyDemandRecipe{Paths: recipe.Paths}
	conservative, _, err := a.refresh(request{ID: 7, Base: reexpanded.Next.ID, BaseSequence: 5, BodyDemand: conservativeRecipe})
	if err != nil {
		t.Fatal(err)
	}
	if a.demandCache.sparseCatalogue {
		t.Fatal("conservative recipe retained an incomplete AST catalogue")
	}
	assertSparseDemandFresh(t, a, conservative, conservativeRecipe)
}

func TestSparseDemandFallbacksAndCapturedAmbientInputs(t *testing.T) {
	for _, kind := range []string{"module-to-script", "augmentation", "ambient", "import-topology", "delete", "incomplete-provenance", "unchanged-ambient-input"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			writeBodyDemandFixture(t, root)
			if kind == "unchanged-ambient-input" {
				if err := os.WriteFile(filepath.Join(root, "ambient.d.ts"), []byte(`declare module 'untouched' { export function external(value:unknown):void }`), 0644); err != nil {
					t.Fatal(err)
				}
			}
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
			initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe, Discover: true})
			if err != nil {
				t.Fatal(err)
			}
			if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
				t.Fatal(err)
			}
			if kind == "incomplete-provenance" {
				a.demandCache.snapshot.dependenciesCaptured = false
			}
			text := `import { settings } from './shared'; export const project = () => settings.id`
			switch kind {
			case "module-to-script":
				text = `const project = () => 'script'`
			case "augmentation":
				text = `export {}; declare module './shared' { export interface Extra { value:string } }`
			case "ambient":
				text = `declare module 'new-provider' { export function newFunction():void }`
			case "import-topology":
				text = `import { foreign } from './foreign'; export const project = () => foreign()`
			}
			if kind == "delete" {
				err = os.Remove(filepath.Join(root, "entry.ts"))
			} else {
				err = os.WriteFile(filepath.Join(root, "entry.ts"), []byte(text), 0644)
			}
			if err != nil {
				t.Fatal(err)
			}
			current, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Discover: true, Changed: []string{"entry.ts"}, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if a.demandCache.sparseCatalogue != (kind == "unchanged-ambient-input") {
				t.Fatalf("wrong eligibility for %s", kind)
			}
			assertSparseDemandFresh(t, a, current, recipe)
		})
	}
}

func TestSparseDemandReferenceUnionAndForeignReadsAreConservative(t *testing.T) {
	old := &compilerReferenceSnapshot{files: map[string]bool{"a": true, "b": true, "c": true, "d": true, "e": true}, reverse: map[string][]string{"a": {"b"}}, sensitive: map[string]bool{}}
	next := &compilerReferenceSnapshot{files: old.files, reverse: map[string][]string{"a": {"c"}}, sensitive: map[string]bool{}}
	reuse := &demandSourceReuse{references: old, snapshot: &sourceProjectionSnapshot{sources: map[string]sourceProjectionRows{}}, sources: map[string]retainedSourceProjection{
		"a": {}, "b": {}, "c": {}, "d": {rows: sourceProjectionRows{dependencies: []string{"b"}}}, "e": {bodyDependencies: map[string][]string{"owner": {"d"}}},
	}}
	if got := reuse.closure(next, []string{"a"}); !reflect.DeepEqual(got, []string{"a", "b", "c", "d", "e"}) {
		t.Fatal("lost old/new references or recorded foreign signature/declaration dependencies:", got)
	}
	next.sensitive["c"] = true
	if reuse.closure(next, []string{"a"}) != nil || reuse.selected != nil {
		t.Fatal("sensitive dependency did not force full fallback")
	}
}

func TestSparseDemandInputRaceRecoversWithOneCoherentFullCapture(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "foreign.ts"), []byte(`import { settings, unused } from './shared'; export function foreign() { unused(settings); return 'changed' }`), 0644); err != nil {
		t.Fatal(err)
	}
	mutation := &discoveryMutationWriter{path: filepath.Join(root, "entry.ts"), remaining: 1}
	writer := bufio.NewWriter(mutation)
	a.telemetry = &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	current, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Discover: true, Changed: []string{"foreign.ts"}, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if mutation.writes != 1 {
		t.Fatal("race fixture did not move compiler inputs")
	}
	assertSparseDemandFresh(t, a, current, recipe)
}

func TestSparseDemandTelemetryReportsSourceFrontier(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	var events bytes.Buffer
	writer := bufio.NewWriter(&events)
	a.telemetry = &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	events.Reset()
	if err := os.WriteFile(filepath.Join(root, "entry.ts"), []byte(`import { settings } from './shared'; export const project = () => settings.id`), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err = a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"entry.ts"}, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	writer.Flush()
	if !bytes.Contains(events.Bytes(), []byte(`"phase":"projection.source-reuse"`)) || !bytes.Contains(events.Bytes(), []byte(`"reusedSources":2`)) {
		t.Fatal("source reuse frontier not observable:", events.String())
	}
}

func TestSparseDemandAliasSignatureTypeOnlyAndMemberTransitions(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	files := map[string]string{
		"provider.ts": `export interface Contract { id:string }; export function first(value:Contract, extra:Contract=value,...rest:Contract[]) { return extra }; export function second(value:Contract) { return value }; export const bridge=first; export const receiver={member:first}`,
		"consumer.ts": `import { bridge, receiver } from './provider'; import type { Contract } from './provider'; export function use(value:Contract) { const alias=bridge; return [alias(value),receiver.member(value)] }`,
		"idle.ts":     `export function stable() { return 'unrelated' }`,
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	a.projection.occurrences = true
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"consumer.ts", "idle.ts"}, Owners: &empty}
	current, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	for index, text := range []string{
		`export interface Contract { id:string }; export function first(value:Contract, extra:Contract=value,...rest:Contract[]) { return extra }; export function second(value:Contract) { return value }; export const bridge=second; export const receiver={member:second}`,
		`export interface Contract { id:string; additional?:boolean }; export function first(value:Contract, extra:Contract=value,...rest:Contract[]) { return extra }; export function second(renamed:Contract, fallback:Contract=renamed,...tail:Contract[]) { return tail[0] ?? fallback }; export const bridge=second; export const receiver={member:second}`,
		`export interface Contract { id:string }; export function first(value:Contract) { return value }; export const second=undefined; export const bridge=first; export const receiver={member:first, added:first}`,
	} {
		if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: index + 1}); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "provider.ts"), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
		current, _, err = a.refresh(request{ID: index + 2, Base: current.Next.ID, BaseSequence: index + 1, Changed: []string{"provider.ts"}, Discover: true, BodyDemand: recipe})
		if err != nil {
			t.Fatal(err)
		}
		if !a.demandCache.sparseCatalogue {
			t.Fatal("ordinary alias/signature/type-only/member edit did not activate sparse capture")
		}
		assertSparseDemandFresh(t, a, current, recipe)
	}
}

func TestSparseDemandEditBudgetFailureRebuildsAndPendingReplayIsImmutable(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	initialBytes := stableJSON(initial)
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "entry.ts"), []byte(`import { settings,identity,callback } from './shared'; export const project=()=>({id:identity(settings.id+'changed'),build:callback}); export const result=project()`), 0644); err != nil {
		t.Fatal(err)
	}
	a.maximumDecodedShardBytes = 1
	_, _, err = a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"entry.ts"}, BodyDemand: recipe})
	if err == nil || !a.pendingFull || a.pending != nil || a.acknowledged.generation.ID != initial.Next.ID || stableJSON(initial) != initialBytes {
		t.Fatal("failed sparse edit crossed the publication boundary")
	}
	a.maximumDecodedShardBytes = 0
	current, _, err := a.refresh(request{ID: 3, Base: initial.Next.ID, BaseSequence: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	if a.demandCache.sparseCatalogue {
		t.Fatal("failed advanced capture was reused rather than rebuilt")
	}
	assertSparseDemandFresh(t, a, current, recipe)
	currentBytes := stableJSON(current)
	if _, _, err := a.refresh(request{ID: 4, Base: initial.Next.ID, BodyDemand: &bodyDemandRecipe{Paths: []string{"shared.ts"}, Owners: &empty}}); err == nil {
		t.Fatal("unacknowledged candidate admitted a conflicting recipe")
	}
	replay, _, err := a.refresh(request{ID: 5, Base: initial.Next.ID, BodyDemand: recipe})
	if err != nil || stableJSON(replay) != currentBytes || stableJSON(initial) != initialBytes {
		t.Fatal("rejected recipe mutated pending/old transaction", err)
	}
}

func TestSparseDemandRawMembershipReclassifiesEscapesWithoutOldNodes(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := a.demandCache.snapshot
	var removed string
	for _, rows := range snapshot.sources {
		for _, call := range rows.rawCalls {
			if call.Target != "" {
				removed = call.Target
				break
			}
		}
	}
	if removed == "" {
		t.Fatal("fixture lacks a locally suppressed call witness")
	}
	before := stableJSON(snapshot.payload(recipe, map[string]bool{}))
	retained := map[string]retainedSourceProjection{}
	for _, rows := range snapshot.sources {
		retained[rows.record.Physical] = retainedSourceProjection{rows: rows}
	}
	freshRows := &sourceProjectionSnapshot{}
	// Supply the current source inventory, but remove only one callable member.
	freshRows.sources = map[string]sourceProjectionRows{}
	for source, rows := range snapshot.sources {
		copyRows := rows
		copyRows.owners = nil
		for _, owner := range rows.owners {
			if owner.Owner != removed {
				copyRows.owners = append(copyRows.owners, owner)
			}
		}
		freshRows.sources[source] = copyRows
	}
	selected := map[string]bool{}
	for path := range retained {
		selected[path] = true
	}
	merged := freshRows.mergeRetained(&demandSourceReuse{sources: retained, selected: selected})
	found := false
	for _, rows := range merged.sources {
		for _, call := range rows.rawCalls {
			if call.Target != removed {
				continue
			}
			for _, escape := range rows.escapes {
				found = found || escape == (demandEffect{call.Symbol, call.Occurrence, call.Owner})
			}
		}
	}
	if !found || stableJSON(snapshot.payload(recipe, map[string]bool{})) != before || stableJSON(initial) == "" {
		t.Fatal("membership recapture lost a raw call or mutated the sealed predecessor")
	}
}
