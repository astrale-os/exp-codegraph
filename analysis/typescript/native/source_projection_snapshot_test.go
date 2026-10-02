package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// The hashes were captured from the qualified pre-C0 H12 binary, not generated
// by the assembler under test. Cover both fresh products and retained-body
// reemission; these fingerprints include every legacy fact byte and ID.
// H17 headers are independently checked against full bodies, then projected out
// with their derived identities to preserve this immutable pre-H17 oracle.
func TestSourceProjectionMatchesFrozenH12Products(t *testing.T) {
	encoded, err := os.ReadFile("testdata/source_projection_h12_oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var oracle struct {
		Provenance struct{ BinarySha256 string }
		Cases      map[string]map[string]string
	}
	if err := json.Unmarshal(encoded, &oracle); err != nil {
		t.Fatal(err)
	}
	if oracle.Provenance.BinarySha256 != "250c1f807b2e8074772b2e78b672201f8d53c2c7d3a869ed05d7b6fe296f21c3" {
		t.Fatal("oracle is not tied to the qualified H12 artifact")
	}
	assertProduct := func(t *testing.T, name string, transaction *factTransaction) {
		t.Helper()
		transaction = legacyH12Projection(t, transaction)
		got := map[string]string{
			"generation": transaction.Next.ID,
			"manifest":   hashText(stableJSON(transaction.Manifest)),
			"upserts":    hashText(stableJSON(transaction.Upserts)),
		}
		for _, shard := range transaction.Upserts {
			if shard.Namespace == bodyDemandNamespace {
				got["certificate"] = hashText(stableJSON(shard))
			}
		}
		if !reflect.DeepEqual(got, oracle.Cases[name]) {
			t.Fatalf("%s changed frozen H12 fact bytes/IDs: got %v, want %v", name, got, oracle.Cases[name])
		}
	}
	for _, name := range []string{"empty", "roots", "conservative", "packed-roots", "full", "packed-full"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writeBodyDemandFixture(t, root)
			codecs := map[string]bool{}
			if name == "packed-roots" || name == "packed-full" {
				codecs[typescriptBodyPayloadCodec] = true
			}
			capabilities := []string{projectNamespace, sourceNamespace, symbolNamespace, bodyDemandNamespace}
			if name == "full" || name == "packed-full" {
				capabilities[3] = bodyNamespace
			}
			a, err := newAnalyzer(root, "tsconfig.json", "projection-oracle-v1", capabilities, nil, codecs, 0, 0, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer a.close()
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
			if name == "empty" || name == "full" || name == "packed-full" {
				recipe.Paths = []string{}
			} else if name == "conservative" {
				recipe.Owners = nil
			}
			current, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			assertProduct(t, name, current)
			if name != "roots" {
				return
			}
			all := []string{}
			for _, owner := range demandPayload(t, current).Owners {
				if !owner.Materialized {
					all = append(all, owner.Owner)
				}
			}
			for index, phase := range []string{"expand", "shrink", "reexpand"} {
				sequence := index + 1
				if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: sequence}); err != nil {
					t.Fatal(err)
				}
				selected := all
				if phase == "expand" {
					selected = all[:1]
				} else if phase == "shrink" {
					selected = empty
				}
				recipe.Owners = &selected
				current, _, err = a.refresh(request{ID: index + 2, Base: current.Next.ID, BaseSequence: sequence, BodyDemand: recipe})
				if err != nil {
					t.Fatal(err)
				}
				assertProduct(t, phase, current)
			}
		})
	}
}

func TestSourceProjectionSnapshotPreservesOrderAndOwnsRows(t *testing.T) {
	a := sourceRecord{Physical: "/a.ts", Source: "source:a", Path: "a.ts", Revision: "revision:a", canonical: []byte("a")}
	z := sourceRecord{Physical: "/z.ts", Source: "source:z", Path: "z.ts", Revision: "revision:z"}
	empty := sourceRecord{Physical: "/empty.ts", Source: "source:empty", Path: "empty.ts", Revision: "revision:empty"}
	origin := &callTargetOrigin{Package: "pkg", File: "entry.ts", Path: []string{"factory"}}
	payload := bodyDemandPayload{
		Observed: true, Paths: []string{"a.ts"}, Completeness: complete(), Coverage: []demandCoverage{},
		Owners: []demandOwner{
			{Owner: "symbol:1", Path: "z.ts", Scope: "function", Span: sourceSpan{Source: z.Source, Revision: z.Revision}, Materialized: true, Fact: "fact:old"},
			{Owner: "symbol:2", Path: "a.ts", Scope: "module", Span: sourceSpan{Source: a.Source, Revision: a.Revision}},
		},
		Witnesses:    []bodyOccurrence{{ID: "occurrence:1", Owner: "symbol:2", Span: sourceSpan{Source: a.Source, Revision: a.Revision}, SymbolOrigin: origin}},
		Initializers: []demandEffect{{"symbol:x", "occurrence:1", "symbol:1"}, {"symbol:x", "occurrence:1", "symbol:2"}, {"symbol:x", "occurrence:1", "symbol:1"}},
		Mutations:    []demandEffect{{"symbol:x", "occurrence:1", "symbol:2"}},
		Escapes:      []demandEffect{{"symbol:x", "occurrence:1", "symbol:1"}},
		Aliases:      []demandAlias{{"symbol:x", "symbol:y", "occurrence:1", "symbol:2"}, {"symbol:x", "symbol:z", "occurrence:1", "symbol:1"}},
	}
	reads := map[string][]callableRead{
		a.Physical:     {{start: 1, end: 2, observation: callableObservation{target: "symbol:x", origin: origin}, dependencies: []string{z.Physical}}},
		empty.Physical: {},
	}
	snapshot := sealSourceProjection(map[string]sourceRecord{a.Physical: a, z.Physical: z, empty.Physical: empty}, payload, reads)
	if len(snapshot.sources) != 3 || len(snapshot.sources[empty.Source].owners) != 0 || !snapshot.sources[empty.Source].hasThinReads {
		t.Fatal("empty source/read contribution was lost")
	}
	for _, rows := range snapshot.sources {
		for _, owner := range rows.owners {
			if owner.Materialized || owner.Fact != "" {
				t.Fatal("sealed catalogue retained publication membership")
			}
		}
	}
	owners := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{"a.ts"}, Owners: &owners}
	selected := map[string]bool{"symbol:1": true}
	assembled := snapshot.payload(recipe, selected)
	payload.Owners[0].Fact = ""
	if stableJSON(assembled) != stableJSON(payload) {
		t.Fatal("source partition changed global row order, duplicates or payload encoding")
	}
	before := stableJSON(assembled)
	if !reflect.DeepEqual(snapshot.callableReads(), reads) {
		t.Fatal("source partition changed callable read keys/order/metadata")
	}
	readBefore := snapshot.callableReads()
	// Neither extraction input nor the recipe/certificate view owns cache rows.
	payload.Owners[0].Owner = "changed"
	payload.Initializers[0].Symbol = "changed"
	payload.Aliases[0].From = "changed"
	payload.Witnesses[0].SymbolOrigin.Path[0] = "changed"
	reads[a.Physical][0].dependencies[0] = "changed"
	a.canonical[0] = 'x'
	assembled.Owners[0].Fact = "changed"
	assembled.Initializers[0].Symbol = "changed"
	assembled.Witnesses[0].SymbolOrigin.Path[0] = "changed"
	assembled.Paths[0] = "changed"
	returnedReads := snapshot.callableReads()
	returnedReads[a.Physical][0].observation.origin.Path[0] = "changed"
	returnedReads[a.Physical][0].dependencies[0] = "changed"
	if stableJSON(snapshot.payload(recipe, selected)) != before || !reflect.DeepEqual(snapshot.callableReads(), readBefore) || string(snapshot.sources[a.Source].record.canonical) != "a" {
		t.Fatal("caller or publication view mutated sealed source rows")
	}
}

func TestSourceProjectionSnapshotContainsNoCompilerObjects(t *testing.T) {
	seen := map[reflect.Type]bool{}
	var visit func(reflect.Type)
	visit = func(value reflect.Type) {
		if seen[value] {
			return
		}
		seen[value] = true
		switch value.Kind() {
		case reflect.Interface, reflect.Func, reflect.UnsafePointer:
			t.Fatalf("unbounded compiler object could escape through %s", value)
		case reflect.Pointer:
			if value.Elem().PkgPath() != "" && value.Elem().PkgPath() != reflect.TypeFor[sourceProjectionSnapshot]().PkgPath() {
				t.Fatalf("foreign compiler pointer in snapshot: %s", value)
			}
			visit(value.Elem())
		case reflect.Slice, reflect.Array:
			visit(value.Elem())
		case reflect.Map:
			visit(value.Key())
			visit(value.Elem())
		case reflect.Struct:
			for index := 0; index < value.NumField(); index++ {
				visit(value.Field(index).Type)
			}
		}
	}
	visit(reflect.TypeFor[sourceProjectionSnapshot]())
}

func TestRetainedSourceEscapesPreserveRepresentationAndCurrentMembership(t *testing.T) {
	reader := sourceRecord{Physical: "/reader.ts", Source: "source:reader", Revision: "revision:reader"}
	callee := sourceRecord{Physical: "/callee.ts", Source: "source:callee", Revision: "revision:callee"}
	outside := demandEffect{"value", "outside", "reader"}
	local := demandEffect{"value", "local", "reader"}
	for _, name := range []string{"nil", "empty", "ordered"} {
		t.Run(name, func(t *testing.T) {
			payload := bodyDemandPayload{Owners: []demandOwner{
				{Owner: "reader", Scope: "function", Span: sourceSpan{Source: reader.Source}},
				{Owner: "callee", Scope: "function", Span: sourceSpan{Source: callee.Source}},
			}}
			x := &extractor{}
			if name == "ordered" {
				payload.Escapes = []demandEffect{outside, outside}
				x.rawDemandCalls = []demandEffectCall{
					{Symbol: "value", Occurrence: "outside", Owner: "reader"},
					{Symbol: "value", Target: "callee", Occurrence: "local", Owner: "reader"},
					{Symbol: "value", Occurrence: "outside", Owner: "reader"},
				}
			}
			old := sealSourceProjection(map[string]sourceRecord{reader.Physical: reader, callee.Physical: callee}, payload, nil, x)
			if name == "empty" {
				rows := old.sources[reader.Source]
				rows.escapes = []demandEffect{}
				old.sources[reader.Source] = rows
			}
			before := old.sources[reader.Source]
			retained := map[string]retainedSourceProjection{
				reader.Physical: {rows: before}, callee.Physical: {rows: old.sources[callee.Source]},
			}
			// An unchanged owner inventory must retain the complete row, including
			// nil/empty shape; duplicate escapes are observable and remain ordered.
			unchanged := old.mergeRetained(&demandSourceReuse{sources: retained, selected: map[string]bool{}})
			if !reflect.DeepEqual(unchanged.sources[reader.Source], before) {
				t.Fatal("unchanged membership replaced sealed source rows")
			}
			if name != "ordered" {
				return
			}
			// The selected source dropped its local callee. Its old contribution
			// must not suppress the reader's newly external call.
			next := sealSourceProjection(map[string]sourceRecord{reader.Physical: reader, callee.Physical: callee}, bodyDemandPayload{}, nil)
			dropped := next.mergeRetained(&demandSourceReuse{sources: retained, selected: map[string]bool{callee.Physical: true}})
			want := []demandEffect{outside, local, outside}
			if !reflect.DeepEqual(dropped.sources[reader.Source].escapes, want) {
				t.Fatal("current membership lost escape order or duplicates")
			}
			owners := []string{"reader"}
			recipe := &bodyDemandRecipe{Paths: []string{}, Owners: &owners}
			for _, selected := range []map[string]bool{{}, {"reader": true}} {
				view := dropped.payload(recipe, selected)
				if !reflect.DeepEqual(view.Escapes, want) || len(view.Owners) != 1 || view.Owners[0].Materialized != selected["reader"] {
					t.Fatal("body demand changed current escape authority")
				}
				view.Escapes[0].Symbol = "publication-mutated"
			}
			// Restoring the callee removes just that escape. Reclassification and
			// publication views must never mutate either older sealed authority.
			retained[reader.Physical] = retainedSourceProjection{rows: dropped.sources[reader.Source]}
			restored := old.mergeRetained(&demandSourceReuse{sources: retained, selected: map[string]bool{callee.Physical: true}})
			if !reflect.DeepEqual(restored.sources[reader.Source].escapes, []demandEffect{outside, outside}) ||
				!reflect.DeepEqual(dropped.sources[reader.Source].escapes, want) || !reflect.DeepEqual(old.sources[reader.Source], before) {
				t.Fatal("membership recovery or publication mutated sealed escape rows")
			}
		})
	}
}

func TestSourceProjectionReexpansionDetachesPublicationAndMatchesFresh(t *testing.T) {
	for _, codec := range []string{"", typescriptBodyPayloadCodec} {
		t.Run(codec, func(t *testing.T) {
			root := t.TempDir()
			writeBodyDemandFixture(t, root)
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			if codec != "" {
				a.payloadCodecs = map[string]bool{codec: true}
			}
			empty := []string{}
			initial, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
			if err != nil {
				t.Fatal(err)
			}
			all := []string{}
			for _, owner := range demandPayload(t, initial).Owners {
				if !owner.Materialized {
					all = append(all, owner.Owner)
				}
			}
			if len(all) < 2 {
				t.Fatal("fixture lacks distinct omitted owners")
			}
			snapshot := a.demandCache.snapshot
			if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
				t.Fatal(err)
			}
			one := all[:1]
			expanded, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &one}})
			if err != nil {
				t.Fatal(err)
			}
			oldInitial, oldExpanded := stableJSON(initial), stableJSON(expanded)
			if err := a.acknowledge(request{Generation: expanded.Next.ID, Sequence: 2}); err != nil {
				t.Fatal(err)
			}
			shrunk, _, err := a.refresh(request{ID: 3, Base: expanded.Next.ID, BaseSequence: 2, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}})
			if err != nil {
				t.Fatal(err)
			}
			if len(shrunk.Deletes) == 0 {
				t.Fatal("shrink failed to retire the selected dependency")
			}
			if err := a.acknowledge(request{Generation: shrunk.Next.ID, Sequence: 3}); err != nil {
				t.Fatal(err)
			}
			a.maximumSemanticPayloadBytes = 1
			if _, _, err := a.refresh(request{ID: 4, Base: shrunk.Next.ID, BaseSequence: 3, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &all}}); err == nil || a.pending != nil || a.acknowledged.generation.ID != shrunk.Next.ID {
				t.Fatal("failed reexpansion corrupted publication ownership")
			}
			a.maximumSemanticPayloadBytes = 0
			recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &all}
			reexpanded, _, err := a.refresh(request{ID: 5, Base: shrunk.Next.ID, BaseSequence: 3, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if reexpanded.Next.ID == expanded.Next.ID {
				t.Fatal("fixture failed to reemit a cached fact in a different generation")
			}
			if stableJSON(initial) != oldInitial || stableJSON(expanded) != oldExpanded || a.demandCache.snapshot != snapshot {
				t.Fatal("reexpansion renamed old facts or replaced the sealed catalogue")
			}
			for _, shard := range a.demandCache.fullBodies {
				for _, fact := range shard.Facts {
					if fact.Generation != "" {
						t.Fatal("publication generation escaped into the sealed body cache")
					}
				}
			}
			freshAnalyzer := openBodyDemandAnalyzer(t, root)
			defer freshAnalyzer.close()
			freshAnalyzer.payloadCodecs = a.payloadCodecs
			fresh, _, err := freshAnalyzer.refresh(request{ID: 1, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if reexpanded.Next.ID != fresh.Next.ID || stableJSON(reexpanded.Manifest) != stableJSON(fresh.Manifest) || !reflect.DeepEqual(a.pending.state.callableReads, freshAnalyzer.pending.state.callableReads) {
				t.Fatal("cached reexpansion differs from the exact fresh product/read ownership")
			}
			freshShards := map[string]factShard{}
			for _, shard := range fresh.Upserts {
				freshShards[shard.Key] = shard
			}
			for _, shard := range reexpanded.Upserts {
				if stableJSON(shard) != stableJSON(freshShards[shard.Key]) {
					t.Fatal("cached reemission changed fact bytes, packing, IDs or completion")
				}
			}
			thinBefore := snapshot.callableReads()
			bodyBefore := map[string][]callableRead{}
			for owner, reads := range a.demandCache.bodyReads {
				bodyBefore[owner] = copyProjectionReads(reads)
			}
			mutated := false
			for _, reads := range a.pending.state.callableReads.owners {
				for _, read := range reads {
					if len(read.dependencies) != 0 {
						read.dependencies[0] = "changed"
						mutated = true
					}
					if read.observation.origin != nil && len(read.observation.origin.Path) != 0 {
						read.observation.origin.Path[0] = "changed"
					}
				}
			}
			if !mutated || !reflect.DeepEqual(snapshot.callableReads(), thinBefore) || !reflect.DeepEqual(a.demandCache.bodyReads, bodyBefore) {
				t.Fatal("pending read index aliases sealed thin or full-body reads")
			}
		})
	}
}
