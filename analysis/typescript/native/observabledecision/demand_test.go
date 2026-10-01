package observabledecision

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Test fixture premises stand in for the capture-owned resolver/effect engine.
// They are explicit, traced, and NOT implementation qualification of that engine.
func fixtureContext(files []CapturedFile) DemandContext {
	return DemandContext{Files: files, Resolve: func(owner, specifier, export string) Resolution {
		read := []SemanticRead{{Kind: "qualified-export", Path: specifier, Name: export, Fingerprint: "fixture-origin-v1"}}
		if specifier == "@astrale-os/sdk/query" {
			if export == "defineQuery" || export == "defineCollectionQuery" {
				return Resolution{Origin: &Origin{Package: "@astrale-os/sdk", File: "src/application/query/define.ts", Path: []string{export}}, Reads: read}
			}
			if export == "Query" {
				return Resolution{Origin: &Origin{Package: "@astrale-os/kernel-core", File: "src/graph/query/index.ts", Path: []string{"Query"}}, Reads: read}
			}
		}
		if specifier == "./helper" {
			return Resolution{Path: "helper.ts", Reads: []SemanticRead{{Kind: "resolution-probe", Path: "helper.ts", Name: export, Fingerprint: "present"}}}
		}
		return Resolution{Reason: "unmodeled captured export", Reads: read}
	}, Effect: func(request EffectRequest) EffectSummary {
		return EffectSummary{Pure: true, Reads: []SemanticRead{{Kind: "effect", Path: request.Path, Name: request.Operation, Fingerprint: "fixture-declarative-pure-premise-v1"}}}
	}}
}
func captured(path, text string) CapturedFile {
	return CapturedFile{Path: path, AbsolutePath: "/fixture/" + path, Role: "production", Layer: "queries", Text: text}
}
func onlyObservation(t *testing.T, product QueryProduct) QueryObservation {
	t.Helper()
	if product.Complete || len(product.Observations) != 1 {
		t.Fatalf("partial observation product: %+v", product)
	}
	return product.Observations[0]
}
func TestRealAuthoredIssuesQueryShapesAndBuildRequestsWithoutProgram(t *testing.T) {
	products := map[string]QueryProduct{}
	for _, fixture := range []struct{ path, id string }{{"read-tag.ts", "issues.tag.read"}, {"list-visible-issues.ts", "issues.issue.list-visible"}} {
		bytes, e := os.ReadFile("testdata/issues/" + fixture.path)
		if e != nil {
			t.Fatal(e)
		}
		product := ObserveQueries(fixtureContext([]CapturedFile{captured(fixture.path, string(bytes))}))
		o := onlyObservation(t, product)
		if o.ConstructorIdentity != "astrale.sdk.defineQuery" || o.ID.Kind != "known" || o.ID.String != fixture.id || o.BuildCallbackCount.Count != 1 || o.ProjectCallbackCount.Count != 1 || o.CanonicalRequestCount.Count != 1 || !o.ProjectorShape.Callable || !o.ProjectorShape.Curried || o.ProjectorShape.ParameterCount != 1 {
			t.Fatalf("real field observation: %+v", o)
		}
		if o.Start >= o.End || len(o.Ownership.Reads) == 0 || len(o.ID.Reads) == 0 {
			t.Fatalf("missing source/semantic trace: %+v", o)
		}
		// Query.project body remains opaque; unmodeled queryResult/map/sort/projection
		// exports must never be resolved by ID/build demand.
		for _, proof := range []DemandOutcome{o.ID, o.BuildCallbackCount, o.ProjectCallbackCount, o.CanonicalRequestCount} {
			for _, read := range proof.Reads {
				if read.Kind == "qualified-export" && (read.Name == "queryResult" || strings.Contains(read.Path, "#queries")) {
					t.Fatalf("unobserved callback body read: %+v", read)
				}
			}
		}
		products[fixture.path] = product
	}
	if target := os.Getenv("OBSERVABLE_QUERY_EVIDENCE"); target != "" {
		data, _ := json.MarshalIndent(products, "", "  ")
		if e := os.WriteFile(target, data, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
func TestCanonicalAliasesImportedHelperAndLexicalShadowing(t *testing.T) {
	source := `import { defineQuery as dq, Query as Builder } from '@astrale-os/sdk/query';
 import { id } from './helper'; const alias = dq;
 export const query = alias<any>()((domain) => ({ id: id('alpha'), build: (_input) => Builder.from({nodes: []}).filter({}).select({}), project: (result) => result }));`
	helper := CapturedFile{Path: "helper.ts", AbsolutePath: "/fixture/helper.ts", Role: "production", Layer: "shared", Text: "const prefix = 'issues.alpha'; export function id(name: string) { return prefix; }"}
	o := onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("query.ts", source), helper})))
	if o.ID.String != "issues.alpha" || o.CanonicalRequestCount.Count != 1 {
		t.Fatalf("alias/helper: %+v", o)
	}
	shadow := strings.Replace(source, "(_input) => Builder.from", "(Builder) => Builder.from", 1)
	o = onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("query.ts", shadow), helper})))
	if o.ID.String != "issues.alpha" || o.BuildCallbackCount.Count != 1 || o.CanonicalRequestCount.Kind != "unknown" {
		t.Fatalf("shadowed receiver guessed canonical: %+v", o)
	}
	namespace := `import * as sdk from '@astrale-os/sdk/query'; export const query=sdk.defineQuery<any>()((domain)=>({id:'namespace',build:()=>sdk.Query.from({}).select({}),project:result=>result}));`
	o = onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("namespace.ts", namespace)})))
	if o.ID.String != "namespace" || o.CanonicalRequestCount.Count != 1 {
		t.Fatalf("runtime namespace origin: %+v", o)
	}
}
func TestIndependentBudgetsAndEffectResidualDoNotHideSubjects(t *testing.T) {
	source := `import { defineQuery, Query } from '@astrale-os/sdk/query'; import { id } from './helper'; export const query=defineQuery<any>()((domain)=>({id:id('alpha'),build:()=>Query.from({}).select({}),project:result=>result}));`
	helper := CapturedFile{Path: "helper.ts", AbsolutePath: "/fixture/helper.ts", Role: "production", Layer: "shared", Text: "export function id(name: string) { return 'issues.' + name; }"}
	context := fixtureContext([]CapturedFile{captured("query.ts", source), helper})
	context.Limits = Limits{MaximumSteps: 1, MaximumDepth: 64, MaximumAlternatives: 32}
	o := onlyObservation(t, ObserveQueries(context))
	if o.ID.Kind != "unknown" || o.ID.Reason != "VALUE_STEP_LIMIT" {
		t.Fatalf("rule budget did not remain independent discovery: %+v", o)
	}
	context = fixtureContext([]CapturedFile{captured("query.ts", source), helper})
	previous := context.Effect
	context.Effect = func(request EffectRequest) EffectSummary {
		if request.Path == "helper.ts" && request.Operation == "invoke-function" {
			return EffectSummary{Reason: "captured prefix has interfering closure write", Reads: []SemanticRead{{Kind: "effect", Path: "helper.ts", Name: "captured-prefix-write", Fingerprint: "present"}}}
		}
		return previous(request)
	}
	o = onlyObservation(t, ObserveQueries(context))
	if o.ID.Kind != "unknown" || o.CanonicalRequestCount.Kind != "known" || o.CanonicalRequestCount.Count != 1 {
		t.Fatalf("effect leaked between independent proof budgets: %+v", o)
	}
}
func TestDeclarationTypeDoesNotGrantCanonicalOwnership(t *testing.T) {
	source := `import { defineQuery as actual } from '@astrale-os/sdk/query'; const pretend: typeof actual = () => (projector) => projector; export const query=pretend<any>()((domain)=>({id:'fake',build:()=>null,project:r=>r}));`
	product := ObserveQueries(fixtureContext([]CapturedFile{captured("lookalike.ts", source)}))
	if len(product.Observations) != 0 {
		t.Fatalf("type annotation became runtime constructor: %+v", product)
	}
	source = `import { defineQuery } from '@astrale-os/sdk/query'; const alias=defineQuery; export const query=alias<any>()((domain)=>({id:'one',build:()=>null,project:r=>r})); const same=query;`
	product = ObserveQueries(fixtureContext([]CapturedFile{captured("deduplicate.ts", source)}))
	if len(product.Observations) != 1 {
		t.Fatalf("alias duplicated source subject: %+v", product)
	}
}

func TestCanonicalProvenanceAndUncurriedShapeRemainObservable(t *testing.T) {
	source := `import { defineQuery, Query } from '@astrale-os/sdk/query'; export const query=defineQuery((domain)=>({id:'uncurried',build:()=>Query.from({}).select({}),project:result=>result}));`
	context := fixtureContext([]CapturedFile{captured("query.ts", source)})
	o := onlyObservation(t, ObserveQueries(context))
	if o.ProjectorShape.Curried || o.ID.String != "uncurried" || o.CanonicalRequestCount.Count != 1 {
		t.Fatalf("uncurried shape erased: %+v", o)
	}
	resolve := context.Resolve
	context.Resolve = func(owner, specifier, export string) Resolution {
		r := resolve(owner, specifier, export)
		if export == "Query" && r.Origin != nil {
			r.Origin.File = "src/unrelated/query.ts"
		}
		return r
	}
	o = onlyObservation(t, ObserveQueries(context))
	if o.CanonicalRequestCount.Kind != "unknown" {
		t.Fatalf("lookalike receiver provenance accepted: %+v", o)
	}
	context = fixtureContext([]CapturedFile{captured("query.ts", source)})
	resolve = context.Resolve
	context.Resolve = func(owner, specifier, export string) Resolution {
		r := resolve(owner, specifier, export)
		if export == "defineQuery" && r.Origin != nil {
			r.Origin.File = "src/lookalike/define.ts"
		}
		return r
	}
	product := ObserveQueries(context)
	if len(product.Observations) != 0 {
		t.Fatalf("lookalike factory provenance accepted: %+v", product)
	}
	objectSource := `import { defineQuery } from '@astrale-os/sdk/query'; export const query=defineQuery<any>()({id:'invalid-projector'});`
	o = onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("object.ts", objectSource)})))
	if o.ProjectorShape.Callable || o.BuildCallbackCount.Count != 0 || o.ProjectCallbackCount.Count != 0 || o.CanonicalRequestCount.Kind != "known" || o.CanonicalRequestCount.Count != 0 {
		t.Fatalf("noncallable projector should have no callbacks/request: %+v", o)
	}
}

func TestUnboundIntrinsicMemberDoesNotRetainReceiverByAccident(t *testing.T) {
	source := `import {defineQuery,Query} from '@astrale-os/sdk/query'; const Q=Query; export const query=defineQuery<any>()((domain)=>({id:'aliased-query-object',build:()=>Q.from({}).select({}),project:r=>r}));`
	o := onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("query.ts", source)})))
	if o.CanonicalRequestCount.Count != 1 {
		t.Fatalf("runtime object alias lost: %+v", o)
	}
	source = `import {defineQuery,Query} from '@astrale-os/sdk/query'; const from=Query.from; export const query=defineQuery<any>()((domain)=>({id:'unbound-method',build:()=>from({}).select({}),project:r=>r}));`
	o = onlyObservation(t, ObserveQueries(fixtureContext([]CapturedFile{captured("query.ts", source)})))
	if o.CanonicalRequestCount.Kind != "unknown" {
		t.Fatalf("receiver recovered from property value instead of call: %+v", o)
	}
}
