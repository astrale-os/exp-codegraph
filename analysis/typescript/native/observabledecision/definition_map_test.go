package observabledecision

import (
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"testing"
)

func TestFrozenDefinitionIDProjection(t *testing.T) {
	var oracle struct {
		Source string
		Cases  []struct {
			Limits       Limits
			Observations []struct {
				Source struct{ Start, End int }
				ID     struct {
					Kind    string
					Value   *string
					Reasons []DemandReason
				}
			}
		}
	}
	raw, err := os.ReadFile("testdata/definition-map-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &oracle); err != nil {
		t.Fatal(err)
	}
	for _, row := range oracle.Cases {
		core, file := effectFixture(oracle.Source)
		file.Path = "routes.ts"
		core = NewNativeEffectCore([]CapturedFile{*file}, core.authority)
		context := fixtureContext([]CapturedFile{*file})
		context.Limits = row.Limits
		context.ReferenceAvailable = func(_ string, n *ast.Node) (bool, bool) { return n.Text() != "missing", true }
		context.Effect = core.DemandEffects(func(EffectRequest) EffectSummary { return EffectSummary{Pure: true} })
		product := ObserveDefinitionIDs(context)
		if len(product.Observations) != len(row.Observations) {
			t.Fatalf("inventory %v got%d want%d", row.Limits, len(product.Observations), len(row.Observations))
		}
		for _, want := range row.Observations {
			var got *DemandOutcome
			for i := range product.Observations {
				if product.Observations[i].Start == want.Source.Start {
					got = &product.Observations[i].ID
					break
				}
			}
			if got == nil {
				t.Fatalf("missing%d", want.Source.Start)
			}
			if got.Kind != want.ID.Kind || (want.ID.Kind == "known" && (got.StringPresent != (want.ID.Value != nil) || (want.ID.Value != nil && got.String != *want.ID.Value))) {
				t.Errorf("%d %v got%+v want%+v", want.Source.Start, row.Limits, *got, want.ID)
			}
			if want.ID.Kind == "unknown" {
				if len(got.Reasons) == 0 && got.Reason != "" {
					got.Reasons = []DemandReason{{Code: got.Reason, Message: got.Message}}
				}
				if len(got.Reasons) != len(want.ID.Reasons) {
					t.Errorf("reasons%d %v got%+v want%+v", want.Source.Start, row.Limits, got.Reasons, want.ID.Reasons)
				} else {
					for i := range got.Reasons {
						if got.Reasons[i] != want.ID.Reasons[i] {
							t.Errorf("reason%d %v got%+v want%+v", want.Source.Start, row.Limits, got.Reasons, want.ID.Reasons)
							break
						}
					}
				}
			}
		}
	}
}
