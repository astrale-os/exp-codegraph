package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestBodyDemandEffectsAndSelectedBodiesMatchCompleteProjection(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	next, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}}, Discover: true})
	if err != nil || next == nil {
		t.Fatalf("initial demand: %v", err)
	}
	assertDemandMatchesFull(t, next, oracle)
	payload := demandPayload(t, next)
	materialized, omitted := 0, 0
	for _, owner := range payload.Owners {
		if owner.Materialized {
			materialized++
		} else {
			omitted++
			if owner.Path == "entry.ts" {
				t.Fatal("requested source has an omitted callable owner")
			}
		}
	}
	if materialized == 0 || omitted == 0 {
		t.Fatalf("selection did not project a strict body subset: %d selected, %d omitted", materialized, omitted)
	}
	if len(payload.Mutations) == 0 || len(payload.Escapes) == 0 || len(payload.Aliases) == 0 {
		t.Fatal("complete effects omitted the unrelated mutation/escape/alias contributors")
	}
}

func TestBodyDemandKeepsFullClientsAndEmptySelectionHonest(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	compatible := openChangeAdmissionAnalyzer(t, root, nil)
	defer compatible.close()
	next, _, err := compatible.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{}}, Discover: true})
	if err != nil || next == nil || next.Next.ID != oracle.Next.ID {
		t.Fatalf("old full client was filtered by an optional demand hint: %v", err)
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	empty, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{}}, Discover: true})
	if err != nil || empty == nil {
		t.Fatalf("explicit empty selection: %v", err)
	}
	assertDemandMatchesFull(t, empty, oracle)
	for _, owner := range demandPayload(t, empty).Owners {
		if owner.Materialized {
			t.Fatal("explicit empty selection materialized an unrequested owner")
		}
	}
	for _, shard := range empty.Upserts {
		if shard.Namespace == bodyNamespace && (len(shard.Facts) != 0 || shard.Completion.Kind != "partial") {
			t.Fatal("empty selection pretended to own complete full body coverage")
		}
	}
}

func TestBodyDemandSelectedPartialCoverageAndAdversarialEffects(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	if err := os.WriteFile(filepath.Join(root, "entry.ts"), []byte(`import { settings } from './shared'; export function project(flag:boolean) { try { switch(flag) { case true: return settings; default: return {} } } catch { return {} } }`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "foreign.ts"), []byte(`import { settings } from './shared'; declare function outside(...value:unknown[]):void; export function foreign() { const alias = (settings as typeof settings)!; const { id } = settings; outside(settings, alias); outside(settings['id']); settings['id'] += id; outside({ settings }); outside(() => { settings.id = 'nested' }); unknownIdentifier(settings); let local = settings; local = alias; }`), 0644); err != nil {
		t.Fatal(err)
	}
	full := openChangeAdmissionAnalyzer(t, root, nil)
	defer full.close()
	oracle, _, err := full.refresh(request{ID: 1, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	next, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}}, Discover: true})
	if err != nil || next == nil {
		t.Fatalf("adversarial demand: %v", err)
	}
	assertDemandMatchesFull(t, next, oracle)
	coverage := demandPayload(t, next).Coverage
	if len(coverage) != 1 || coverage[0].Completeness.Kind != "partial" {
		t.Fatal("selected control-flow partial reasons were discarded")
	}
}

func TestBodyDemandRefreshRecipeAndForeignEffectsStayCoherent(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	initial, _, err := a.refresh(request{ID: 1, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}}, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	unchanged, identity, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Discover: true})
	if err != nil || unchanged != nil || identity != initial.Next.ID {
		t.Fatalf("acknowledged demand no-op: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "foreign.ts"), []byte(`import { settings } from './shared'; declare function outside(value:unknown):void; export function foreign() { const alias = settings; alias.id = 'changed'; outside((alias as typeof settings)) }`), 0644); err != nil {
		t.Fatal(err)
	}
	next, _, err := a.refresh(request{ID: 3, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"foreign.ts"}, Discover: true})
	if err != nil || next == nil || next.Next.ID == initial.Next.ID {
		t.Fatalf("foreign effect refresh: %v", err)
	}
	full := openChangeAdmissionAnalyzer(t, root, nil)
	oracle, _, err := full.refresh(request{ID: 1, Discover: true})
	full.close()
	if err != nil {
		t.Fatal(err)
	}
	assertDemandMatchesFull(t, next, oracle)
	if err := a.acknowledge(request{Generation: next.Next.ID, Sequence: 2}); err != nil {
		t.Fatal(err)
	}
	changed, _, err := a.refresh(request{ID: 4, Base: next.Next.ID, BaseSequence: 2, BodyDemand: &bodyDemandRecipe{Paths: []string{"foreign.ts"}}, Discover: true})
	if err != nil || changed == nil || changed.Next.ID == next.Next.ID {
		t.Fatalf("recipe movement reused previous body coverage: %v", err)
	}
	assertDemandMatchesFull(t, changed, oracle)
	for _, owner := range demandPayload(t, changed).Owners {
		if owner.Path == "foreign.ts" && !owner.Materialized {
			t.Fatal("new root does not have full body coverage")
		}
	}
	if len(changed.Deletes) == 0 {
		t.Fatal("recipe movement retained every obsolete selected body shard")
	}
}

func TestBodyDemandRequiresExplicitCoverageAndRecoversRemovedRoots(t *testing.T) {
	root := t.TempDir()
	writeBodyDemandFixture(t, root)
	a := openBodyDemandAnalyzer(t, root)
	defer a.close()
	fallback, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range demandPayload(t, fallback).Owners {
		if !owner.Materialized {
			t.Fatal("missing recipe did not retain honest full coverage")
		}
	}
	a.close()
	a = openBodyDemandAnalyzer(t, root)
	defer a.close()
	initial, _, err := a.refresh(request{ID: 2, BodyDemand: &bodyDemandRecipe{Paths: []string{"entry.ts"}}, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "entry.ts")); err != nil {
		t.Fatal(err)
	}
	removed, _, err := a.refresh(request{ID: 3, Base: initial.Next.ID, BaseSequence: 1, Discover: true})
	if err != nil || removed == nil {
		t.Fatalf("removed root: %v", err)
	}
	payload := demandPayload(t, removed)
	if len(payload.Coverage) != 1 || payload.Coverage[0].Completeness.Kind != "unavailable" {
		t.Fatal("removed root was certified as a complete empty source")
	}
	for _, owner := range payload.Owners {
		if owner.Path == "entry.ts" {
			t.Fatal("removed owner remained in complete callable membership")
		}
	}
}

func writeBodyDemandFixture(t *testing.T, root string) {
	t.Helper()
	for path, content := range map[string]string{
		"tsconfig.json": `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`,
		"entry.ts":      `import { settings, identity, callback } from './shared'; export const project = () => ({ id: identity(settings.id), build: callback }); export const result = project()`,
		"shared.ts":     `export const settings = { id:'stable' }; export function identity<T>(value:T):T { return value }; export const callback = () => ({ ok:true }); export function unused(value:unknown) { return value }`,
		"foreign.ts":    `import { settings, unused } from './shared'; declare function outside(value:unknown):void; export function foreign() { const alias = settings; alias.id = 'foreign'; outside(alias); unused(settings); outside(delete settings.id); if (settings) { outside((settings as typeof settings)) } }; export class Hidden { field = settings; mutate() { settings.id = 'method' } }`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func openBodyDemandAnalyzer(t *testing.T, root string) *analyzer {
	t.Helper()
	a, err := newAnalyzer(root, "tsconfig.json", "", []string{projectNamespace, sourceNamespace, symbolNamespace, bodyDemandNamespace}, nil, nil, 0, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func demandPayload(t *testing.T, transaction *factTransaction) bodyDemandPayload {
	t.Helper()
	for _, shard := range transaction.Upserts {
		if shard.Namespace == bodyDemandNamespace {
			return shard.Facts[0].Payload.(bodyDemandPayload)
		}
	}
	t.Fatal("no complete demand certificate was published")
	return bodyDemandPayload{}
}

func assertDemandMatchesFull(t *testing.T, selected, full *factTransaction) {
	t.Helper()
	payload := demandPayload(t, selected)
	fullShards, owners, occurrences := map[string]factShard{}, map[string]bool{}, map[string]bodyOccurrence{}
	fullFacts := map[string]string{}
	for _, shard := range full.Upserts {
		if shard.Namespace != bodyNamespace || len(shard.Facts) == 0 {
			continue
		}
		fullShards[shard.Key] = shard
		body := shard.Facts[0].Payload.(bodyFactPayload).Body
		owners[body.Function] = true
		fullFacts[body.Function] = shard.Facts[0].ID
		for _, occurrence := range body.Occurrences {
			occurrences[occurrence.ID] = occurrence
		}
	}
	if len(owners) != len(payload.Owners) {
		t.Fatalf("owner membership differs from full projection: %d != %d", len(payload.Owners), len(owners))
	}
	selectedOwners := map[string]bool{}
	for _, owner := range payload.Owners {
		if !owners[owner.Owner] {
			t.Fatal("certificate invented a callable body owner")
		}
		selectedOwners[owner.Owner] = owner.Materialized
		if owner.Materialized && owner.Fact != fullFacts[owner.Owner] {
			t.Fatal("materialized owner lost its original logical fact identity")
		}
		if !owner.Materialized && owner.Fact != "" {
			t.Fatal("omitted owner advertised an absent body fact")
		}
	}
	for _, shard := range selected.Upserts {
		if shard.Namespace != bodyNamespace || len(shard.Facts) == 0 {
			continue
		}
		original, exists := fullShards[shard.Key]
		if !exists || original.Digest != shard.Digest || original.Facts[0].ID != shard.Facts[0].ID {
			t.Fatal("materialized body differs from complete projection")
		}
	}
	for _, witness := range payload.Witnesses {
		original, exists := occurrences[witness.ID]
		if !exists || witness.Owner != original.Owner || witness.Kind != original.Kind || witness.Syntax != original.Syntax || witness.Span != original.Span || witness.Symbol != original.Symbol {
			t.Fatalf("effect witness is not an original admitted occurrence: %#v vs %#v", witness, original)
		}
	}
	oracle := fullBodyEffectOracle(full)
	for name, pair := range map[string][2][]string{
		"initializers": {effectKeys(payload.Initializers), effectKeys(oracle.Initializers)},
		"mutations":    {effectKeys(payload.Mutations), effectKeys(oracle.Mutations)},
		"escapes":      {effectKeys(payload.Escapes), effectKeys(oracle.Escapes)},
		"aliases":      {aliasKeys(payload.Aliases), aliasKeys(oracle.Aliases)},
	} {
		if !reflect.DeepEqual(pair[0], pair[1]) {
			t.Fatalf("thin %s differs from full symbolic derivation:\n%v\n%v", name, pair[0], pair[1])
		}
	}
}

// Independent oracle consumes complete IR rows, mirroring the existing public
// symbolic effect contract rather than the thin AST projector's traversal.
func fullBodyEffectOracle(transaction *factTransaction) bodyDemandPayload {
	payload := bodyDemandPayload{Initializers: []demandEffect{}, Mutations: []demandEffect{}, Escapes: []demandEffect{}, Aliases: []demandAlias{}}
	owners := map[string]bool{}
	bodies := []functionBodyIR{}
	for _, shard := range transaction.Upserts {
		if shard.Namespace == bodyNamespace && len(shard.Facts) != 0 {
			body := shard.Facts[0].Payload.(bodyFactPayload).Body
			bodies = append(bodies, body)
			owners[body.Function] = true
		}
	}
	for _, body := range bodies {
		nodes := map[string]bodyOccurrence{}
		children := map[string]map[string]string{}
		for _, node := range body.Occurrences {
			nodes[node.ID] = node
		}
		for _, relation := range body.Relations {
			if children[relation.Parent] == nil {
				children[relation.Parent] = map[string]string{}
			}
			children[relation.Parent][relation.Role] = relation.Child
		}
		root := func(id string) string {
			for id != "" {
				node, exists := nodes[id]
				if !exists {
					return ""
				}
				switch node.Syntax {
				case "Identifier":
					return node.Symbol
				case "PropertyAccessExpression", "ElementAccessExpression":
					id = children[id]["receiver"]
					if id == "" {
						id = children[node.ID]["child:0"]
					}
				case "ParenthesizedExpression", "NonNullExpression", "SatisfiesExpression", "AsExpression", "TypeAssertionExpression":
					id = children[id]["expression"]
				default:
					return ""
				}
			}
			return ""
		}
		for _, node := range body.Occurrences {
			if node.Syntax == "VariableDeclaration" {
				name, initializer := children[node.ID]["name"], children[node.ID]["initializer"]
				symbol := nodes[name].Symbol
				if symbol != "" && initializer != "" {
					payload.Initializers = append(payload.Initializers, demandEffect{symbol, initializer, body.Function})
					if target := root(initializer); target != "" && target != symbol {
						payload.Aliases = append(payload.Aliases, demandAlias{target, symbol, initializer, body.Function})
					}
				}
			}
			target := ""
			if node.Kind == "assignment" {
				target = children[node.ID]["left"]
			} else if node.Syntax == "DeleteExpression" {
				target = children[node.ID]["expression"]
			}
			if symbol := root(target); symbol != "" {
				payload.Mutations = append(payload.Mutations, demandEffect{symbol, node.ID, body.Function})
			}
		}
		for _, call := range body.Calls {
			for _, binding := range call.Bindings {
				if symbol := root(binding.Argument); binding.Parameter != "" && symbol != "" && binding.Parameter != symbol {
					payload.Aliases = append(payload.Aliases, demandAlias{symbol, binding.Parameter, call.Occurrence, body.Function})
				}
			}
			if call.Target != "" && owners[call.Target] && !call.Dynamic {
				continue
			}
			for _, argument := range call.Arguments {
				if symbol := root(argument); symbol != "" {
					payload.Escapes = append(payload.Escapes, demandEffect{symbol, call.Occurrence, body.Function})
				}
			}
		}
	}
	return payload
}

func effectKeys(values []demandEffect) []string {
	keys := []string{}
	for _, value := range values {
		keys = append(keys, value.Owner+"\x00"+value.Symbol+"\x00"+value.Occurrence)
	}
	sort.Strings(keys)
	return keys
}

func aliasKeys(values []demandAlias) []string {
	keys := []string{}
	for _, value := range values {
		keys = append(keys, value.Owner+"\x00"+value.Symbol+"\x00"+value.From+"\x00"+value.Occurrence)
	}
	sort.Strings(keys)
	return keys
}
