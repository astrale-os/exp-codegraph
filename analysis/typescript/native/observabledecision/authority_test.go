package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestMissingDemandAuthorityIsMigrationResidual(t *testing.T) {
	file := captured("query.ts", "import {defineQuery,Query} from '@astrale-os/sdk/query'; export const q=defineQuery<any>()(d=>({id:'q',build:()=>Query.from({}).select({}),project:r=>r}));")
	for _, kind := range []string{"effect", "admission", "resolver"} {
		context := fixtureContext([]CapturedFile{file})
		switch kind {
		case "effect":
			context.Effect = func(EffectRequest) EffectSummary {
				return EffectSummary{Unavailable: true, Reason: "missing captured authority"}
			}
		case "admission":
			context.ExpressionAdmitted = func(string, *ast.Node) (bool, bool) { return false, false }
		case "resolver":
			context.Resolve = func(string, string, string) Resolution {
				return Resolution{Unavailable: true, Reason: "missing captured authority"}
			}
		}
		if product := ObserveQueries(context); len(product.Residual) == 0 {
			t.Errorf("%s missing authority was translated as a public observation", kind)
		}
	}
}
