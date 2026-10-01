package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Project only the additive H17 field out of a product and recompute its
// content-derived certificate/generation identities. The immutable H12 hashes
// then assert every legacy fact/field/ID/ordering byte, not new accepted hashes.
func legacyH12Projection(t *testing.T, transaction *factTransaction) *factTransaction {
	t.Helper()
	legacy := *transaction
	legacy.Manifest = append([]factShardReference{}, transaction.Manifest...)
	legacy.Upserts = append([]factShard{}, transaction.Upserts...)
	for index, shard := range legacy.Upserts {
		if shard.Namespace != bodyDemandNamespace {
			continue
		}
		entry := shard.Facts[0]
		payload := entry.Payload.(bodyDemandPayload)
		payload.Owners = append([]demandOwner{}, payload.Owners...)
		for owner := range payload.Owners {
			payload.Owners[owner].Header = nil
		}
		entry.Payload, entry.Generation = payload, ""
		prepared, err := prepareFact(entry)
		if err != nil {
			t.Fatal(err)
		}
		projected := finishShard(bodyDemandNamespace, entry.Subject, shard.Completion, []preparedFact{prepared})
		legacy.Upserts[index] = projected
		for reference := range legacy.Manifest {
			if legacy.Manifest[reference].Key == projected.Key {
				legacy.Manifest[reference].Digest = projected.Digest
				legacy.Manifest[reference].canonical = nil
			}
		}
	}
	legacy.Next.ID, _, _ = nativeGenerationIdentity(legacy.Next, legacy.Manifest)
	for index, shard := range legacy.Upserts {
		if shard.Facts != nil {
			shard.Facts = append([]fact{}, shard.Facts...)
		}
		for entry := range shard.Facts {
			shard.Facts[entry].Generation = legacy.Next.ID
		}
		legacy.Upserts[index] = shard
	}
	return &legacy
}

func writeFunctionHeaderFixture(t *testing.T, root string) {
	t.Helper()
	writeBodyDemandFixture(t, root)
	text := `export function plain(first:string, second=first, ...rest:string[]) { return rest[0] ?? second }
export async function asynchronous(value:string) { return value }
export function* iterator(value:string) { yield value }
export async function* asyncIterator(value:string) { yield value }
export const arrow = (first:string, second=first) => second;
export const asyncArrow = async (value:string) => value;
export const zero = () => 1;
export const destructured = ({id}:{id:string}, [first]:string[]) => id + first;
export class Container { constructor(public value:string) {} method(input:string) { return input } async *stream(input:string) { yield input } get current() { return this.value } set other(value:string) { this.value=value } }
export const duplicate = (same:string,same:string) => same;
export const invoked = plain('initial');`
	if err := os.WriteFile(filepath.Join(root, "headers.ts"), []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestFunctionHeadersAreFullMetadataWithoutBodyCoverage(t *testing.T) {
	root := t.TempDir()
	writeFunctionHeaderFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{}, Owners: &empty}
	selected, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
	if err != nil {
		t.Fatal(err)
	}
	payload := demandPayload(t, selected)
	if len(payload.Coverage) != 0 || payload.Completeness.Kind != "complete" {
		t.Fatal("empty demand fabricated body coverage")
	}
	kinds := map[string]bool{}
	for _, owner := range payload.Owners {
		if owner.Materialized || owner.Fact != "" {
			t.Fatal("header materialized a body or fabricated a body FactID")
		}
		if owner.Scope == "module" {
			if owner.Header != nil {
				t.Fatal("module owner advertised a function header")
			}
			continue
		}
		if owner.Header == nil || owner.Header.Parameters == nil {
			t.Fatal("function lacks complete ordered header")
		}
		seen := map[string]bool{}
		for _, parameter := range owner.Header.Parameters {
			if parameter == "" || seen[parameter] {
				t.Fatal("header did not preserve resolved uniqueInOrder identities")
			}
			seen[parameter] = true
		}
		kinds[owner.Header.Execution] = true
	}
	if !reflect.DeepEqual(kinds, map[string]bool{"sync": true, "async": true, "generator": true, "async-generator": true}) {
		t.Fatal("missing execution modes", kinds)
	}
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	assertDemandMatchesFull(t, selected, oracle)
}

func TestFunctionHeadersRetainOwnedRowsAndExpandRealBodiesAcrossEdits(t *testing.T) {
	for _, codec := range []string{"", typescriptBodyPayloadCodec} {
		t.Run(codec, func(t *testing.T) {
			root := t.TempDir()
			writeFunctionHeaderFixture(t, root)
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			if codec != "" {
				a.payloadCodecs = map[string]bool{codec: true}
			}
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"entry.ts"}, Owners: &empty}
			current, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			initial := current
			original := stableJSON(initial)
			before := a.demandCache.snapshot.sources[a.demandCache.extractor.sources[filepath.Join(root, "headers.ts")].Source]
			if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: 1}); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "entry.ts"), []byte(`import { settings,identity,callback } from './shared'; export const project=()=>identity(settings.id+'changed')`), 0644); err != nil {
				t.Fatal(err)
			}
			current, _, err = a.refresh(request{ID: 2, Base: current.Next.ID, BaseSequence: 1, Changed: []string{"entry.ts"}, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if !a.demandCache.sparseCatalogue || !reflect.DeepEqual(before, a.demandCache.snapshot.sources[before.record.Source]) {
				t.Fatal("independent header contribution was recaptured/mutated")
			}
			assertSparseDemandFresh(t, a, current, recipe)
			owners := []string{}
			for _, owner := range demandPayload(t, current).Owners {
				if owner.Path == "headers.ts" && owner.Header != nil {
					owners = append(owners, owner.Owner)
				}
			}
			if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: 2}); err != nil {
				t.Fatal(err)
			}
			expandedRecipe := &bodyDemandRecipe{Paths: recipe.Paths, Owners: &owners}
			expanded, _, err := a.refresh(request{ID: 3, Base: current.Next.ID, BaseSequence: 2, BodyDemand: expandedRecipe})
			if err != nil {
				t.Fatal(err)
			}
			assertSparseDemandFresh(t, a, expanded, expandedRecipe)
			expandedBytes := stableJSON(expanded)
			if err := a.acknowledge(request{Generation: expanded.Next.ID, Sequence: 3}); err != nil {
				t.Fatal(err)
			}
			shrunk, _, err := a.refresh(request{ID: 4, Base: expanded.Next.ID, BaseSequence: 3, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			assertSparseDemandFresh(t, a, shrunk, recipe)
			if stableJSON(current) == original || stableJSON(expanded) == "" {
				t.Fatal("fixture did not move its capture")
			}
			if err := a.acknowledge(request{Generation: shrunk.Next.ID, Sequence: 4}); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "headers.ts"), []byte(`export async function plain(renamed:string, fallback=renamed,...tail:string[]) { return tail[0] ?? fallback }; export function newOwner() { return 1 }`), 0644); err != nil {
				t.Fatal(err)
			}
			changed, _, err := a.refresh(request{ID: 5, Base: shrunk.Next.ID, BaseSequence: 4, Changed: []string{"headers.ts"}, BodyDemand: expandedRecipe})
			if err != nil {
				t.Fatal(err)
			}
			assertSparseDemandFresh(t, a, changed, expandedRecipe)
			for _, owner := range demandPayload(t, changed).Owners {
				if owner.Path == "headers.ts" && owner.Header != nil && owner.Header.Span.Revision == before.record.Revision {
					t.Fatal("changed/deleted owner retained its old header")
				}
			}
			if stableJSON(initial) != original || stableJSON(expanded) != expandedBytes {
				t.Fatal("header edit/shrink renamed old published products")
			}
		})
	}
}

func TestFunctionHeaderOwnershipDoesNotEscapeSealedSnapshots(t *testing.T) {
	header := &functionHeader{Owner: "owner", Span: sourceSpan{Source: "source", Revision: "revision"}, Parameters: []string{"first", "second"}, Execution: "sync"}
	record := sourceRecord{Source: "source", Physical: "/owned.ts"}
	payload := bodyDemandPayload{Owners: []demandOwner{{Owner: header.Owner, Scope: "function", Span: header.Span, Header: header}}}
	snapshot := sealSourceProjection(map[string]sourceRecord{record.Physical: record}, payload, nil)
	empty := []string{}
	recipe := &bodyDemandRecipe{Paths: []string{}, Owners: &empty}
	before := stableJSON(snapshot.payload(recipe, map[string]bool{}))
	header.Parameters[0] = "input-mutated"
	view := snapshot.payload(recipe, map[string]bool{})
	view.Owners[0].Header.Parameters[0] = "output-mutated"
	view.Owners[0].Header.Span.Revision = "output-mutated"
	merged := snapshot.mergeRetained(&demandSourceReuse{sources: map[string]retainedSourceProjection{record.Physical: {rows: snapshot.sources[record.Source]}}, selected: map[string]bool{}})
	mergedView := merged.payload(recipe, map[string]bool{})
	mergedView.Owners[0].Header.Parameters[1] = "candidate-mutated"
	if stableJSON(snapshot.payload(recipe, map[string]bool{})) != before || stableJSON(merged.payload(recipe, map[string]bool{})) != before {
		t.Fatal("input/publication/candidate escaped header row ownership")
	}
}

func TestFunctionHeadersWithholdAmbiguousLegacyOwnerAuthority(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	if err := os.WriteFile(filepath.Join(root, "accessors.ts"), []byte(`export class Ambiguous { get shared() { return 'value' } set shared(value:string) {} method(value:string) { return value } }; export function unique(value:string) { return value }`), 0644); err != nil {
		t.Fatal(err)
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty := []string{}
	selected, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{}, Owners: &empty}})
	if err != nil {
		t.Fatal(err)
	}
	payload := demandPayload(t, selected)
	counts := map[string]int{}
	for _, owner := range payload.Owners {
		counts[owner.Owner]++
	}
	withheld, positive := 0, 0
	for _, owner := range payload.Owners {
		if owner.Scope != "function" {
			continue
		}
		if counts[owner.Owner] > 1 {
			withheld++
			if owner.Header != nil {
				t.Fatal("duplicate legacy owner gained a guessed unique header")
			}
		} else if owner.Header == nil {
			t.Fatal("unambiguous function lost its header")
		} else {
			positive++
		}
	}
	if withheld != 2 || positive == 0 {
		t.Fatal("fixture did not cover ambiguous accessors and independent unique functions", withheld, positive)
	}
	if len(payload.Coverage) != 0 {
		t.Fatal("ambiguous header omission fabricated body coverage")
	}
}
