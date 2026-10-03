package main

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Legacy prepare publishes only partial/residual, but its fanout demands seed
// the same cache and receipt leases consumed by later products observations.
func TestGovernancePartialQueryFanoutKeepsCacheAndProductsSeal(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"include":["queries"]}`)
	declaration := `export interface CollectionQueryDefinition { readonly brand: { readonly kind: 'node' }; }
export declare function defineCollectionQuery(): (projector: (domain: any) => unknown) => CollectionQueryDefinition;
export declare function defineCompositeQuery(): (projector: (domain: any) => unknown) => unknown;`
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", declaration)
	governanceWrite(t, root, "queries/fanout.ts", `import {defineCollectionQuery,defineCompositeQuery} from '@astrale-os/sdk';
const a=defineCollectionQuery()(D=>({id:'a',class:D.classes.a}));
const b=defineCollectionQuery()(D=>({id:'b',class:D.classes.b}));
const c=defineCollectionQuery()(D=>({id:'c',class:D.classes.c}));
export const query=defineCompositeQuery()(D=>({compose(plan){return plan.combine({a:plan.query('a',a),b:plan.query('b',b),c:plan.query('c',c)});}}));`)
	policy := governanceTestPolicy()
	policy.Layers = append(policy.Layers, governanceLayer{ID: "queries", SourcePath: "queries/"})
	session := &governanceSession{root: root}
	var current *governedProject
	for turn, ids := range [][]string{{"QRY-CANON", "QRY-SINGLE", "QRY-CANON"}, {"QRY-SINGLE", "QRY-CANON", "QRY-SINGLE"}} {
		rules := []governanceRevision{}
		for _, id := range ids {
			rules = append(rules, governanceRevision{ID: id, Revision: governanceRevisions[id]})
		}
		project, product, err := session.prepareSource(governancePrepare{Root: root, PolicySource: &policy, RuleRevisions: rules})
		if err != nil || project == nil {
			t.Fatal("partial prepare failed", err)
		}
		if project.typeRelease != nil {
			project.typeRelease()
			project.typeRelease = nil
		}
		if product.Complete || !reflect.DeepEqual(product.Residual, []string{"Canonical full policy compilation and whole LintResult assembly/suppression are not qualified."}) || project.stats.FamilyEvaluations != 1 || project.stats.RuleEvaluations != 3 || project.stats.TypeCells != 3 || len(session.typeDemandCache.entries) != 3 {
			t.Fatalf("partial fanout frontier changed: %#v stats=%#v", product.Residual, project.stats)
		}
		if len(project.stats.TypeRequests) != 3 {
			t.Fatal("fanout request trace changed", project.stats.TypeRequests)
		}
		for i, request := range project.stats.TypeRequests {
			if request.Operation != "collection-brand-kind" || request.Path != "queries/fanout.ts" || request.Expression != []string{"a", "b", "c"}[i] || !request.Known || request.Kind != "node" || request.End != request.Start+1 || (i > 0 && request.Start <= project.stats.TypeRequests[i-1].End) {
				t.Fatal("fanout request order/anchors changed", project.stats.TypeRequests)
			}
		}
		if turn == 0 && (project.stats.CompilerPrograms != 1 || project.stats.TypeCacheHits != 0) {
			t.Fatal("first fanout did not use fresh authority", project.stats)
		}
		if turn == 1 && (project.stats.CompilerPrograms != 0 || project.stats.TypeCacheHits != 3 || len(project.capture.typeCacheLeases) == 0) {
			t.Fatal("repeated partial lost original cache/leases", project.stats)
		}
		current = project
	}
	state := &governanceProductsSession{Project: current, Token: "current", Prepare: governancePrepare{Options: json.RawMessage(`{"sourcePolicyOwnerRevision":1}`)}}
	session.productsSession = state
	keys := []governanceTypeDemandKey{}
	for key := range session.typeDemandCache.entries {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].start < keys[j].start })
	for _, key := range keys {
		file := current.FilesByPath[key.path]
		answer, err := session.observeClosedSource(governanceClosedSourceRequest{Token: state.Token, SourceSnapshotDigest: current.GovernanceDigest, Path: key.path, Operation: "collection", Start: file.coordinates.utf16(key.start), End: file.coordinates.utf16(key.end)})
		if err != nil || answer.Status != "known" || answer.Kind == nil || *answer.Kind != "node" {
			t.Fatal("products continuation lost actual branded kind", answer, err)
		}
	}
	if current.stats.CompilerPrograms != 0 || current.stats.TypeCacheHits != 6 {
		t.Fatal("products continuation reopened original checker", current.stats)
	}
	state.ProductsDigest = strings.Repeat("a", 64)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", strings.ReplaceAll(declaration, "'node'", "'edge'"))
	response, err := session.sealProducts(state.Token, state.ProductsDigest, strings.Repeat("b", 64))
	if err != nil || response.(map[string]any)["status"] != "retry" || session.productsSession != nil || len(session.typeDemandCache.entries) != 0 {
		t.Fatal("hidden dependency edit escaped original lease retirement", response, err)
	}
}
