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
func TestCanonicalSDKBudgetValidationCell(t *testing.T) {
	limits, err := governanceParseProofLimits(json.RawMessage(`{"budgetValidation":{"kind":"valid","limits":{"maximumDepth":2,"maximumSteps":3,"maximumAlternatives":4}}}`))
	if err != nil || limits.MaximumDepth != 2 || limits.MaximumSteps != 3 || limits.MaximumAlternatives != 4 {
		t.Fatalf("%+v %v", limits, err)
	}
	_, err = governanceParseProofLimits(json.RawMessage(`{"budgetValidation":{"kind":"invalid","field":"maximumSteps","reason":"positive-integer"}}`))
	if err == nil || err.Error() != "Cannot analyze Domain semantics: maximumSteps must be a positive integer." {
		t.Fatalf("lost actual original undefined validation: %v", err)
	}
	for _, raw := range []string{`{"kind":"invalid","field":"maximumSteps","reason":"invented"}`, `{"kind":"valid","limits":{"maximumSteps":0}}`, `{"kind":"valid","limits":{"maximumSteps":3}}`} {
		if _, err := governanceParseProofLimits(json.RawMessage(`{"budgetValidation":` + raw + `}`)); err == nil {
			t.Fatalf("malformed option product admitted: %s", raw)
		}
	}
}
