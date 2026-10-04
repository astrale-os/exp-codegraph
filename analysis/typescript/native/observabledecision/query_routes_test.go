package observabledecision

import (
	"encoding/json"
	"os"
	"testing"
)

func TestFrozenSDKQueryRuntimeReceiverRoutes(t *testing.T) {
	var oracle struct {
		Source string
		Cases  []struct {
			Limits       Limits
			Observations []struct {
				Source struct {
					Path       string
					Start, End int
				}
				BuildCallbackCount, ProjectCallbackCount, CanonicalRequestCount struct {
					State, Reason string
					Value         int
				}
			}
		}
	}
	raw, e := os.ReadFile("testdata/query-route-oracle.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &oracle); e != nil {
		t.Fatal(e)
	}
	for _, row := range oracle.Cases {
		effectCore, file := effectFixture(oracle.Source)
		file.Path = "routes.ts"
		effectCore = NewNativeEffectCore([]CapturedFile{*file}, effectCore.authority)
		context := fixtureContext([]CapturedFile{*file})
		context.Effect = effectCore.DemandEffects(func(request EffectRequest) EffectSummary {
			return EffectSummary{Pure: true, ChargeKey: request.Path + ":" + request.Operation}
		})
		context.Limits = row.Limits
		product := ObserveQueries(context)
		if len(product.Observations) != len(row.Observations) {
			t.Fatalf("inventory %+v: want%d got%d", row.Limits, len(row.Observations), len(product.Observations))
		}
		for _, expected := range row.Observations {
			var observation *QueryObservation
			for i := range product.Observations {
				if product.Observations[i].Start == expected.Source.Start && product.Observations[i].End == expected.Source.End {
					observation = &product.Observations[i]
					break
				}
			}
			if observation == nil {
				t.Fatalf("lost source %+v", expected.Source)
			}
			for _, proof := range []struct {
				name, state, reason string
				count               int
				actual              DemandOutcome
			}{{"build", expected.BuildCallbackCount.State, expected.BuildCallbackCount.Reason, expected.BuildCallbackCount.Value, observation.BuildCallbackCount}, {"project", expected.ProjectCallbackCount.State, expected.ProjectCallbackCount.Reason, expected.ProjectCallbackCount.Value, observation.ProjectCallbackCount}, {"request", expected.CanonicalRequestCount.State, expected.CanonicalRequestCount.Reason, expected.CanonicalRequestCount.Value, observation.CanonicalRequestCount}} {
				if proof.actual.Kind != proof.state || (proof.state == "known" && proof.actual.Count != proof.count) || (proof.state != "known" && PublicQueryReason(proof.actual) != proof.reason) {
					t.Errorf("%s/%d %s %+v steps%d expected%s/%d/%q actual%s/%d/%q", expected.Source.Path, expected.Source.Start, proof.name, row.Limits, proof.actual.Steps, proof.state, proof.count, proof.reason, proof.actual.Kind, proof.actual.Count, PublicQueryReason(proof.actual))
				}
			}
		}
	}
}
