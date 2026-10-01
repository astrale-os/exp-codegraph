package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestQueryRulesDoNotDemandDefinitionIDs(t *testing.T) {
	core, file := effectFixture(`import{defineQuery,Query}from'@astrale-os/sdk/query';export const q=defineQuery()(d=>({id:ghost,build:()=>Query.from({}).select({}),project:r=>r}));`)
	context := fixtureContext([]CapturedFile{*file})
	context.Effect = core.DemandEffects(func(EffectRequest) EffectSummary { return EffectSummary{Pure: true} })
	context.GlobalValue = func(string, *ast.Node) GlobalValueObservation { return GlobalValueObservation{} }
	queries := ObserveQueries(context)
	if len(queries.Residual) != 0 || len(queries.Observations) != 1 {
		t.Fatalf("unobserved ID blocked Query rules: %+v", queries)
	}
	observation := queries.Observations[0]
	if observation.ID.Kind != "" || observation.BuildCallbackCount.Count != 1 || observation.CanonicalRequestCount.Count != 1 {
		t.Fatalf("unexpected query footprint %+v", observation)
	}
	for _, proof := range []DemandOutcome{observation.Ownership, observation.BuildCallbackCount, observation.ProjectCallbackCount, observation.CanonicalRequestCount, observation.ProjectorProof} {
		for _, read := range proof.Reads {
			if read.Name == "ghost" {
				t.Fatal("Query proof read the ID initializer")
			}
		}
	}
	if len(ObserveQueriesAndIDs(context).Residual) == 0 {
		t.Fatal("exploratory ID demand lost missing authority")
	}
}
