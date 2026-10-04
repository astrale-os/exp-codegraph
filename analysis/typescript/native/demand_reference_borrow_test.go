package main

import (
	"reflect"
	"sort"
	"testing"
)

// The oracle is a plain directed edge set, independent of compiler captures
// and projection records. Only retained physical sources are selected.
func borrowedReferenceEdgeClosure(edges [][2]string, seeds []string, owned map[string]retainedSourceProjection) []string {
	seen := map[string]bool{}
	queue := append([]string{}, seeds...)
	for len(queue) != 0 {
		path := queue[0]
		queue = queue[1:]
		if seen[path] {
			continue
		}
		seen[path] = true
		for _, edge := range edges {
			if edge[0] == path {
				queue = append(queue, edge[1])
			}
		}
	}
	selected := []string{}
	for path := range seen {
		if _, exists := owned[path]; exists {
			selected = append(selected, path)
		}
	}
	sort.Strings(selected)
	return selected
}

func borrowedReferenceFixture() (*demandSourceReuse, *compilerReferenceSnapshot) {
	files := map[string]bool{}
	sources := map[string]retainedSourceProjection{}
	for _, path := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "idle"} {
		files[path] = true
		sources[path] = retainedSourceProjection{}
	}
	old := &compilerReferenceSnapshot{files: files, reverse: map[string][]string{"a": {"b", "b"}, "b": {"a"}, "idle": nil}, sensitive: map[string]bool{}, augmentations: map[string]compilerAugmentationCapture{
		"b": {complete: true, textDigest: "old", owners: []string{"d"}},
	}}
	next := &compilerReferenceSnapshot{files: files, reverse: map[string][]string{"a": {"c"}, "b": {}, "c": {"a"}}, sensitive: map[string]bool{}, augmentations: map[string]compilerAugmentationCapture{
		"c":                   {complete: true, textDigest: "new", owners: []string{"e"}},
		"unmapped-incomplete": {owners: []string{"also-unmapped"}},
	}}
	sources["f"] = retainedSourceProjection{rows: sourceProjectionRows{dependencies: []string{"d"}, thinReads: []callableRead{{dependencies: []string{"e"}}}}}
	sources["g"] = retainedSourceProjection{bodyReads: map[string][]callableRead{"owner": {{dependencies: []string{"f"}}}}, bodyDependencies: map[string][]string{"owner": {"e"}}}
	sources["h"] = retainedSourceProjection{shards: []factShard{{Namespace: symbolNamespace, Facts: []fact{{Provenance: provenance{Evidence: []sourceSpan{{Source: "symbol-source"}}}}}}}}
	return &demandSourceReuse{references: old, sources: sources, snapshot: &sourceProjectionSnapshot{sources: map[string]sourceProjectionRows{
		"symbol-source": {record: sourceRecord{Physical: "g"}},
	}}}, next
}

func TestSparseDemandBorrowedReferencesMatchEdgesAndPreserveInputs(t *testing.T) {
	edges := [][2]string{{"a", "b"}, {"b", "a"}, {"a", "c"}, {"c", "a"}, {"b", "d"}, {"d", "b"}, {"c", "e"}, {"e", "c"}, {"d", "f"}, {"e", "f"}, {"f", "g"}, {"e", "g"}, {"g", "h"}}
	for _, seeds := range [][]string{{"a"}, {"d"}, {"e"}, {"idle"}, {}, {"a", "a"}} {
		reuse, next := borrowedReferenceFixture()
		before, beforeNext := borrowedReferenceFixture()
		originalSeeds := append([]string{}, seeds...)
		for attempt := 0; attempt < 2; attempt++ {
			want := borrowedReferenceEdgeClosure(edges, seeds, reuse.sources)
			if got := reuse.closure(next, seeds); !reflect.DeepEqual(got, want) {
				t.Fatalf("seeds %v: selected %v, want %v", seeds, got, want)
			}
			if len(reuse.selected) != len(want) {
				t.Fatal("selected owner set differs from returned closure")
			}
			for _, path := range want {
				if !reuse.selected[path] {
					t.Fatal("selected owner missing:", path)
				}
			}
			if !reflect.DeepEqual(reuse.references, before.references) || !reflect.DeepEqual(next, beforeNext) || !reflect.DeepEqual(reuse.sources, before.sources) || !reflect.DeepEqual(reuse.snapshot, before.snapshot) || !reflect.DeepEqual(seeds, originalSeeds) {
				t.Fatal("closure mutated borrowed maps, adjacency slices, projection records or seeds")
			}
		}
	}
	// Original key validation does not validate owner values. Keep that private
	// synthetic behavior instead of introducing a stricter admission guard.
	reuse, next := borrowedReferenceFixture()
	next.reverse["idle"] = []string{"unowned-owner"}
	if got := reuse.closure(next, []string{"idle"}); !reflect.DeepEqual(got, []string{"idle"}) {
		t.Fatal("unowned compiler owner changed selection:", got)
	}
}

func TestSparseDemandBorrowedReferencesValidateUnreachableKeys(t *testing.T) {
	for _, test := range []struct {
		reason string
		mutate func(*demandSourceReuse, *compilerReferenceSnapshot)
	}{
		{"unknown", func(reuse *demandSourceReuse, _ *compilerReferenceSnapshot) {
			reuse.references.reverse["unknown"] = nil
		}},
		{"unknown", func(_ *demandSourceReuse, next *compilerReferenceSnapshot) { next.reverse["unknown"] = []string{} }},
		{"idle", func(reuse *demandSourceReuse, _ *compilerReferenceSnapshot) { reuse.references.files["idle"] = false }},
		{"unknown", func(reuse *demandSourceReuse, _ *compilerReferenceSnapshot) {
			reuse.sources["idle"] = retainedSourceProjection{rows: sourceProjectionRows{dependencies: []string{"unknown"}}}
		}},
		{"unknown", func(_ *demandSourceReuse, next *compilerReferenceSnapshot) {
			next.augmentations["unknown"] = compilerAugmentationCapture{complete: true, owners: []string{"idle"}}
		}},
	} {
		reuse, next := borrowedReferenceFixture()
		test.mutate(reuse, next)
		if got := reuse.closure(next, []string{"a"}); got != nil || reuse.selected != nil || reuse.fallbackReason != "unmapped-projection-dependency:"+test.reason {
			t.Fatalf("unreachable invalid key did not retain full fallback: %v, %s", got, reuse.fallbackReason)
		}
	}
}

func TestSparseDemandBorrowedAugmentationsRetainBothDirectionsAndSensitiveFallback(t *testing.T) {
	for _, changed := range [][]string{{"b"}, {"d"}} {
		reuse, next := borrowedReferenceFixture()
		capture := reuse.references.augmentations["b"]
		capture.targets = []string{"owner-target"}
		reuse.references.augmentations["b"] = capture
		next.augmentations["b"] = capture
		reuse.references.sensitive["b"] = true
		if got := reuse.closure(next, changed); !reflect.DeepEqual(got, []string{"a", "b", "c", "d", "e", "f", "g", "h"}) {
			t.Fatal("stable augmentation lost contributor/owner closure:", got)
		}
		capture.textDigest = "changed"
		next.augmentations["b"] = capture
		if reuse.closure(next, changed) != nil || reuse.selected != nil || reuse.fallbackReason != "sensitive-dependent-source:b" {
			t.Fatal("changed sensitive augmentation did not retain full fallback")
		}
	}
}
