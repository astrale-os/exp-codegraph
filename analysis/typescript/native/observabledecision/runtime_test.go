package observabledecision

import (
	"reflect"
	"testing"
)

func TestSharedRuntimeIndexPreservesFreshProofProducts(t *testing.T) {
	context := fixtureContext([]CapturedFile{captured("query.ts", `import {defineQuery,Query} from '@astrale-os/sdk/query';export const q=defineQuery()(d=>({id:'q',build:()=>Query.from({}).select({}),project:r=>r}));`)})
	for _, limits := range []Limits{{MaximumDepth: 64, MaximumSteps: 4096, MaximumAlternatives: 32}, {MaximumDepth: 3, MaximumSteps: 5, MaximumAlternatives: 1}} {
		context.Limits = limits
		shared := ObserveRuntime(context)
		if !reflect.DeepEqual(shared.Queries, ObserveQueries(context)) || !reflect.DeepEqual(shared.Definitions, ObserveDefinitionIDs(context)) {
			t.Fatalf("shared immutable indexes changed observations at %+v", limits)
		}
	}
}
