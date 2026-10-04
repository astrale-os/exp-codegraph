package observabledecision

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestSelectedLegacyQueryBoundaryBudgetsMatchDirectASTVirtualCharges(t *testing.T) {
	var oracle struct {
		Cases []struct {
			Limits   struct{ MaximumDepth, MaximumSteps, MaximumAlternatives int }
			Expected []struct {
				Source struct {
					Path       string
					Start, End int
				}
				ID struct {
					Kind, Value string
					Reasons     []string
				}
				ProjectorShape struct {
					State string
					Value struct {
						Curried, Callable, Async, Generator bool
						ParameterCount                      int
					}
				}
				BuildCallbackCount, ProjectCallbackCount, CanonicalRequestCount struct {
					State  string
					Reason string
					Value  int
				}
			}
		}
	}
	bytes, e := os.ReadFile("testdata/budgets/oracle.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(bytes, &oracle); e != nil {
		t.Fatal(e)
	}
	files := []CapturedFile{}
	for _, name := range []string{"read-tag.ts", "list-visible-issues.ts"} {
		text, e := os.ReadFile("testdata/issues/" + name)
		if e != nil {
			t.Fatal(e)
		}
		files = append(files, captured(name, string(text)))
	}
	for _, name := range []string{"helper-query.ts", "helper.ts"} {
		text, e := os.ReadFile("testdata/budgets/" + name)
		if e != nil {
			t.Fatal(e)
		}
		file := captured(name, string(text))
		if name == "helper.ts" {
			file.Layer = "shared"
		}
		files = append(files, file)
	}
	comparisons := 0
	for _, testCase := range oracle.Cases {
		context := fixtureContext(files)
		context.Limits = Limits{MaximumDepth: testCase.Limits.MaximumDepth, MaximumSteps: testCase.Limits.MaximumSteps, MaximumAlternatives: testCase.Limits.MaximumAlternatives}
		product := ObserveQueriesAndIDs(context)
		if product.Complete || len(product.Observations) != len(testCase.Expected) {
			t.Fatalf("inventory changed/hid subject at %+v", context.Limits)
		}
		for _, expected := range testCase.Expected {
			var actual *QueryObservation
			for i := range product.Observations {
				o := &product.Observations[i]
				if o.Path == expected.Source.Path && o.Start == expected.Source.Start && o.End == expected.Source.End {
					actual = o
					break
				}
			}
			if actual == nil {
				t.Fatalf("source lost at %+v: %+v", context.Limits, expected.Source)
			}
			if actual.ID.Kind != expected.ID.Kind || (expected.ID.Kind == "known" && actual.ID.String != expected.ID.Value) {
				t.Fatalf("ID at %+v/%s:%d expected %+v actual %s/%s/%s", context.Limits, actual.Path, actual.Start, expected.ID, actual.ID.Kind, actual.ID.String, actual.ID.Reason)
			}
			if expected.ID.Kind == "unknown" && len(expected.ID.Reasons) > 0 && actual.ID.Reason != expected.ID.Reasons[0] {
				t.Fatalf("ID reason boundary: %+v %s expected%s got%s", context.Limits, actual.Path, expected.ID.Reasons[0], actual.ID.Reason)
			}

			for _, reasonCase := range []struct {
				expectedState, expectedReason string
				actual                        DemandOutcome
			}{{expected.BuildCallbackCount.State, expected.BuildCallbackCount.Reason, actual.BuildCallbackCount}, {expected.ProjectCallbackCount.State, expected.ProjectCallbackCount.Reason, actual.ProjectCallbackCount}, {expected.CanonicalRequestCount.State, expected.CanonicalRequestCount.Reason, actual.CanonicalRequestCount}} {
				if reasonCase.expectedState != "known" && PublicQueryReason(reasonCase.actual) != reasonCase.expectedReason {
					t.Fatalf("public reason at %+v/%s expected %q actual %q", context.Limits, actual.Path, reasonCase.expectedReason, PublicQueryReason(reasonCase.actual))
				}
			}
			counts := []struct {
				name          string
				expectedState string
				expectedCount int
				actual        DemandOutcome
			}{{"build", expected.BuildCallbackCount.State, expected.BuildCallbackCount.Value, actual.BuildCallbackCount}, {"project", expected.ProjectCallbackCount.State, expected.ProjectCallbackCount.Value, actual.ProjectCallbackCount}, {"request", expected.CanonicalRequestCount.State, expected.CanonicalRequestCount.Value, actual.CanonicalRequestCount}}
			for _, count := range counts {
				if count.actual.Kind != count.expectedState || (count.expectedState == "known" && count.actual.Count != count.expectedCount) {
					t.Fatalf("%s at %+v/%s:%d expected%s/%d actual%s/%d/%s", count.name, context.Limits, actual.Path, actual.Start, count.expectedState, count.expectedCount, count.actual.Kind, count.actual.Count, count.actual.Reason)
				}
			}
			if actual.ProjectorProof.Kind != expected.ProjectorShape.State {
				t.Fatalf("shape budget mismatch %+v", context.Limits)
			}
			comparisons += 5
		}
	}
	t.Log(fmt.Sprintf("%d selected proof outcomes matched frozen legacy across %d step/depth budgets", comparisons, len(oracle.Cases)))
}
