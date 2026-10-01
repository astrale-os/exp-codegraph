package main

import (
	"encoding/json"
	"testing"
)

func TestRuntimeProofLimitsPreserveOptionalAndExplicitValues(t *testing.T) {
	for _, raw := range []string{"", `{}`, `{"budget":null}`, `{"budget":{}}`} {
		got, err := governanceParseProofLimits(json.RawMessage(raw))
		if err != nil || got.MaximumSteps != 4096 || got.MaximumDepth != 64 || got.MaximumAlternatives != 32 {
			t.Fatalf("%s: %+v %v", raw, got, err)
		}
	}
	got, err := governanceParseProofLimits(json.RawMessage(`{"budget":{"maximumSteps":3,"maximumDepth":1,"maximumAlternatives":2}}`))
	if err != nil || got.MaximumSteps != 3 || got.MaximumDepth != 1 || got.MaximumAlternatives != 2 {
		t.Fatalf("%+v %v", got, err)
	}
	// Object-entry validation includes unknown properties, just as the original
	// resolveBoundedValueLimits validates the merged complete options object.
	for _, raw := range []string{`{"maximumSteps":0}`, `{"maximumDepth":null}`, `{"maximumAlternatives":-1}`, `{"maximumSteps":1.5}`, `{"maximumSteps":"3"}`, `{"maximumSteps":9007199254740992}`, `{"extra":false}`} {
		_, err := governanceParseProofLimits(json.RawMessage(`{"budget":` + raw + `}`))
		if _, ok := err.(*governanceSemanticBudgetError); !ok {
			t.Fatalf("%s silently defaulted: %v", raw, err)
		}
	}
}
