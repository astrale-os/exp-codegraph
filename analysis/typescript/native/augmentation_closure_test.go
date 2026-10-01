package main

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

func writeAugmentationClosureFixture(t *testing.T, root, forwarding string) {
	t.Helper()
	writeBodyDemandFixture(t, root)
	for path, text := range map[string]string{
		"base.ts":          `export interface Box { seed:string }; export const seed = 'base'`,
		"facade.ts":        forwarding,
		"helper.ts":        `export const current = { before: 'original' }; export function build() { return current }`,
		"augment.ts":       `import { current } from './helper'; export {}; declare module './facade' { interface Box { value: typeof current } }`,
		"coaugment.ts":     `export {}; declare module './facade' { interface Box { other: string } }`,
		"direct-reader.ts": `import type { Box } from './base'; declare const box:Box; export function readDirect() { return box.value.before }`,
		"facade-reader.ts": `import type { Box } from './facade'; declare const box:Box; export function readFacade() { return box.value.before }`,
		"idle.ts":          `export function idle() { return 'independent' }`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSparseDemandUnchangedAugmentationRecapturesForwardedOwnersAndUsers(t *testing.T) {
	for _, forwarding := range []string{`export * from './base'`, `export type { Box } from './base'`} {
		for _, codec := range []string{"", typescriptBodyPayloadCodec} {
			t.Run(forwarding+codec, func(t *testing.T) {
				root := t.TempDir()
				writeAugmentationClosureFixture(t, root, forwarding)
				a := openBodyDemandAnalyzer(t, root)
				defer a.close()
				root = a.root
				if codec != "" {
					a.payloadCodecs = map[string]bool{codec: true}
				}
				empty := []string{}
				recipe := &bodyDemandRecipe{Paths: []string{"direct-reader.ts", "facade-reader.ts"}, Owners: &empty}
				initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
				if err != nil {
					t.Fatal(err)
				}
				if err = a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
					t.Fatal(err)
				}
				augmentPath := filepath.Join(root, "augment.ts")
				capture := a.demandCache.references.augmentations[augmentPath]
				if !capture.complete || !slices.Contains(capture.owners, filepath.Join(root, "base.ts")) || !slices.Contains(capture.owners, filepath.Join(root, "coaugment.ts")) {
					t.Fatalf("missing current merged contribution owners: %+v", capture)
				}
				before, err := os.ReadFile(augmentPath)
				if err != nil {
					t.Fatal(err)
				}
				idle := a.demandCache.snapshot.sources[a.acknowledged.sources[filepath.Join(root, "idle.ts")].Source]
				if idle.record.Source == "" || len(idle.owners) == 0 {
					t.Fatal("independent source was not actually captured")
				}
				original := `export const current = { before: 'original' }; export function build() { return current }`
				for i, text := range []string{`export const current = { after: 'edited' }; export function build() { return current }`, original} {
					if err = os.WriteFile(filepath.Join(root, "helper.ts"), []byte(text), 0644); err != nil {
						t.Fatal(err)
					}
					base := a.acknowledged.generation.ID
					current, _, err := a.refresh(request{ID: i + 2, Base: base, BaseSequence: i + 1, Changed: []string{"helper.ts"}, BodyDemand: recipe})
					if err != nil {
						t.Fatal(err)
					}
					if !a.demandCache.sparseCatalogue {
						t.Fatal("unchanged supported augmentation did not admit current sparse recapture")
					}
					retained := a.demandCache.snapshot.sources[idle.record.Source]
					if !reflect.DeepEqual(idle.record, retained.record) || len(retained.owners) == 0 || &idle.owners[0] != &retained.owners[0] {
						t.Fatal("independent sealed owner rows were not retained")
					}
					if now, err := os.ReadFile(augmentPath); err != nil || !slices.Equal(before, now) {
						t.Fatal("fixture accidentally changed augmentation bytes", err)
					}
					assertSparseDemandFresh(t, a, current, recipe)
					if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: i + 2}); err != nil {
						t.Fatal(err)
					}
				}
				// Expanding all previously omitted owners after the current repair
				// proves that retained scalar locators hydrate against CURRENT AST.
				owners := []string{}
				for _, rows := range a.demandCache.snapshot.sources {
					for _, owner := range rows.owners {
						owners = append(owners, owner.Owner)
					}
				}
				slices.Sort(owners)
				expandedRecipe := &bodyDemandRecipe{Paths: recipe.Paths, Owners: &owners}
				expanded, _, err := a.refresh(request{ID: 5, Base: a.acknowledged.generation.ID, BaseSequence: 3, BodyDemand: expandedRecipe})
				if err != nil {
					t.Fatal(err)
				}
				assertSparseDemandFresh(t, a, expanded, expandedRecipe)
			})
		}
	}
}

func TestSparseDemandAugmentationUnknownAndChangedFormsKeepFullFallback(t *testing.T) {
	for _, kind := range []string{"changed-interface", "changed-merge-kind", "global", "global-target-owner", "pattern", "unresolved", "namespace", "export-equals", "type-alias"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			writeAugmentationClosureFixture(t, root, `export * from './base'`)
			augment := `import { current } from './helper'; export {}; declare module './facade' { interface Box { value: typeof current } }`
			switch kind {
			case "global":
				augment = `import { current } from './helper'; export {}; declare global { interface GlobalBox { value: typeof current } }`
			case "global-target-owner":
				if err := os.WriteFile(filepath.Join(root, "base.ts"), []byte(`export interface Box { seed:string }; declare global { var cache: Box }`), 0644); err != nil {
					t.Fatal(err)
				}
			case "pattern":
				augment = `import { current } from './helper'; export {}; declare module '*.provider' { interface Box { value: typeof current } }`
			case "unresolved":
				augment = `import { current } from './helper'; export {}; declare module 'missing-provider' { interface Box { value: typeof current } }`
			case "namespace":
				augment = `import { current } from './helper'; export {}; declare module './facade' { namespace Inner { interface Box { value: typeof current } } }`
			case "type-alias":
				augment = `import { current } from './helper'; export {}; declare module './facade' { type Added = typeof current }`
			case "export-equals":
				if err := os.WriteFile(filepath.Join(root, "facade.ts"), []byte(`import * as base from './base'; export = base`), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(root, "augment.ts"), []byte(augment), 0644); err != nil {
				t.Fatal(err)
			}
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			root = a.root
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"direct-reader.ts"}, Owners: &empty}
			initial, _, err := a.refresh(request{ID: 1, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if err = a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
				t.Fatal(err)
			}
			changed := "helper.ts"
			text := `export const current = { after: 'edited' }; export function build() { return current }`
			if kind == "changed-interface" {
				changed = "augment.ts"
				text = `import { current } from './helper'; export {}; declare module './facade' { interface Box { changed: typeof current } }`
			}
			if kind == "changed-merge-kind" {
				changed = "base.ts"
				text = `export class Box { seed = 'class' }`
			}
			if err := os.WriteFile(filepath.Join(root, changed), []byte(text), 0644); err != nil {
				t.Fatal(err)
			}
			current, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{changed}, BodyDemand: recipe})
			if err != nil {
				t.Fatal(err)
			}
			if a.demandCache.sparseCatalogue {
				t.Fatal("unsupported/changed augmentation admitted sparse reuse")
			}
			assertSparseDemandFresh(t, a, current, recipe)
		})
	}
}

// Exercise the C2 graph with the H17 producer, rather than accepting the
// pre-header isolated product as qualification of their composition.
func TestSparseAugmentationHeadersActiveExpansionAndFailedPublication(t *testing.T) {
	for _, codec := range []string{"", typescriptBodyPayloadCodec} {
		t.Run(codec, func(t *testing.T) {
			root := t.TempDir()
			writeAugmentationClosureFixture(t, root, `export type { Box } from './base'`)
			original := `export const current = { before: 'original' }; export function build(value=current) { return value }`
			helper := filepath.Join(root, "helper.ts")
			if err := os.WriteFile(helper, []byte(original), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "direct-reader.ts"), []byte(`import type { Box } from './base'; declare const box:Box; export function readDirect(value:Box['value']=box.value) { return value.before }`), 0644); err != nil {
				t.Fatal(err)
			}
			a := openBodyDemandAnalyzer(t, root)
			defer a.close()
			if codec != "" {
				a.payloadCodecs = map[string]bool{codec: true}
			}
			empty := []string{}
			recipe := &bodyDemandRecipe{Paths: []string{"direct-reader.ts", "facade-reader.ts"}, Owners: &empty}
			id, sequence := 0, 0
			var current *factTransaction
			refresh := func(recipe *bodyDemandRecipe, changed ...string) *factTransaction {
				t.Helper()
				id++
				input := request{ID: id, BodyDemand: recipe, Changed: changed}
				if current != nil {
					input.Base, input.BaseSequence = current.Next.ID, sequence
				}
				transaction, _, err := a.refresh(input)
				if err != nil {
					t.Fatal(err)
				}
				assertSparseDemandFresh(t, a, transaction, recipe)
				return transaction
			}
			ack := func(transaction *factTransaction) {
				t.Helper()
				sequence++
				if err := a.acknowledge(request{Generation: transaction.Next.ID, Sequence: sequence}); err != nil {
					t.Fatal(err)
				}
				current = transaction
			}
			initial := refresh(recipe)
			initialBytes := stableJSON(initial)
			oldSnapshot := a.demandCache.snapshot
			oldSnapshotBytes := stableJSON(oldSnapshot.payload(recipe, map[string]bool{}))
			var oldHeader *functionHeader
			for _, owner := range demandPayload(t, initial).Owners {
				if owner.Path == "helper.ts" && owner.Header != nil {
					oldHeader = copyFunctionHeader(owner.Header)
				}
			}
			if oldHeader == nil || oldHeader.Execution != "sync" || len(oldHeader.Parameters) != 1 {
				t.Fatal("fixture lacks original omitted callback metadata")
			}
			ack(initial)
			editedText := `export const current = { after: 'edited' }; export async function build(renamed=current,...tail:typeof current[]) { return tail[0] ?? renamed }`
			if err := os.WriteFile(helper, []byte(editedText), 0644); err != nil {
				t.Fatal(err)
			}
			edited := refresh(recipe, "helper.ts")
			if !a.demandCache.sparseCatalogue {
				t.Fatal("H17 composition did not take supported sparse augmentation closure")
			}
			readerRecaptured := false
			for source, rows := range a.demandCache.snapshot.sources {
				if rows.record.Path != "direct-reader.ts" {
					continue
				}
				previous := oldSnapshot.sources[source]
				if len(rows.owners) == 0 || len(previous.owners) == 0 || &rows.owners[0] == &previous.owners[0] {
					t.Fatal("augmentation-connected declaration reader retained old header rows")
				}
				for _, owner := range rows.owners {
					readerRecaptured = readerRecaptured || (owner.Header != nil && len(owner.Header.Parameters) == 1)
				}
			}
			if !readerRecaptured {
				t.Fatal("missing current header with augmentation-resolved parameter")
			}
			owners := []string{}
			for _, owner := range demandPayload(t, edited).Owners {
				if owner.Header == nil || (owner.Path != "helper.ts" && owner.Path != "idle.ts") {
					continue
				}
				if owner.Materialized || owner.Fact != "" {
					t.Fatal("header or root selection materialized omitted callback")
				}
				if owner.Path == "helper.ts" && (owner.Header.Execution != "async" || len(owner.Header.Parameters) != 2 || reflect.DeepEqual(owner.Header.Parameters, oldHeader.Parameters) || owner.Header.Span.Revision == oldHeader.Span.Revision) {
					t.Fatal("changed callback retained old parameter/execution/span authority")
				}
				owners = append(owners, owner.Owner)
			}
			if len(owners) != 2 {
				t.Fatal("fixture lacks both freshly recaptured and independently retained omitted callbacks")
			}
			editedBytes := stableJSON(edited)
			ack(edited)
			expandedRecipe := &bodyDemandRecipe{Paths: recipe.Paths, Owners: &owners}
			expanded := refresh(expandedRecipe)
			for _, owner := range demandPayload(t, expanded).Owners {
				if slices.Contains(owners, owner.Owner) && (!owner.Materialized || owner.Fact == "") {
					t.Fatal("active edited callback invocation did not acquire its actual full body")
				}
			}
			expandedBytes := stableJSON(expanded)
			ack(expanded)
			shrunk := refresh(recipe)
			ack(shrunk)
			reexpanded := refresh(expandedRecipe)
			if reexpanded.Next.ID != expanded.Next.ID {
				t.Fatal("active edited shrink/reexpansion changed product identity")
			}
			ack(reexpanded)
			// Fail after Apply while an unchanged augmentation must be recaptured.
			// Recovery must rebuild current authority, never publish partial rows.
			for _, limit := range []string{"semantic", "decoded"} {
				text := `export const current = { after: '` + limit + `' }; export async function build(renamed=current,...tail:typeof current[]) { return tail[0] ?? renamed }`
				if err := os.WriteFile(helper, []byte(text), 0644); err != nil {
					t.Fatal(err)
				}
				if limit == "semantic" {
					a.maximumSemanticPayloadBytes = 1
				} else {
					a.maximumDecodedShardBytes = 1
				}
				id++
				_, _, err := a.refresh(request{ID: id, Base: current.Next.ID, BaseSequence: sequence, Changed: []string{"helper.ts"}, BodyDemand: expandedRecipe})
				if err == nil || a.pending != nil || !a.pendingFull || a.acknowledged.generation.ID != current.Next.ID {
					t.Fatal("failed augmentation candidate crossed its publication/ACK boundary")
				}
				a.maximumSemanticPayloadBytes, a.maximumDecodedShardBytes = 0, 0
				recovered := refresh(expandedRecipe)
				if a.demandCache.sparseCatalogue {
					t.Fatal("failed advanced augmentation capture was reused")
				}
				// Pending replay is immutable; a different recipe cannot replace it.
				id++
				if _, _, err := a.refresh(request{ID: id, Base: current.Next.ID, BaseSequence: sequence, BodyDemand: recipe}); err == nil {
					t.Fatal("conflicting recipe replaced unacknowledged recovery")
				}
				id++
				replay, _, err := a.refresh(request{ID: id, Base: current.Next.ID, BaseSequence: sequence, BodyDemand: expandedRecipe})
				if err != nil || stableJSON(replay) != stableJSON(recovered) {
					t.Fatal("failed candidate recovery lost its exact pending replay", err)
				}
				ack(recovered)
			}
			if err := os.WriteFile(helper, []byte(original), 0644); err != nil {
				t.Fatal(err)
			}
			repaired := refresh(recipe, "helper.ts")
			if repaired.Next.ID != initial.Next.ID || stableJSON(repaired.Manifest) != stableJSON(initial.Manifest) {
				t.Fatal("repair did not restore the exact initial header/certificate product")
			}
			if stableJSON(initial) != initialBytes || stableJSON(edited) != editedBytes || stableJSON(expanded) != expandedBytes || stableJSON(oldSnapshot.payload(recipe, map[string]bool{})) != oldSnapshotBytes {
				t.Fatal("augmentation edit/expansion/failure mutated a prior transaction or sealed authority")
			}
		})
	}
}
