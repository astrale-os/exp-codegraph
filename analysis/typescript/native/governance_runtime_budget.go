package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"bytes"
	"encoding/json"
	"fmt"
	"math"
)

type governanceSemanticBudgetError struct{ name string }

func (e *governanceSemanticBudgetError) Error() string {
	return fmt.Sprintf("Cannot analyze Domain semantics: %s must be a positive integer.", e.name)
}

// The SDK merges these independently into every Query/definition proof. Callee
// discovery retains its separate fixed original limits inside the shared reader.
func (state *governanceProductsSession) runtimeProofLimits() (observabledecision.Limits, error) {
	activeQuery := state.Project.Disabled["QRY-CANON"] == "" || state.Project.Disabled["QRY-SINGLE"] == ""
	activeDefinition := state.Project.Disabled["QLT-DEF-IDS"] == ""
	relevant := false
	for _, file := range state.Project.Files {
		if file.Role == "production" && ((file.Layer == "queries" && (activeQuery || activeDefinition)) || (file.Layer == "mutations" && activeDefinition)) {
			relevant = true
			break
		}
	}
	if !relevant {
		return observabledecision.Limits{}, nil
	}
	return governanceParseProofLimits(state.Prepare.Options)
}
func governanceParseProofLimits(options json.RawMessage) (observabledecision.Limits, error) {
	limits := observabledecision.Limits{MaximumDepth: 64, MaximumSteps: 4096, MaximumAlternatives: 32}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(options, &object); err != nil && len(options) != 0 {
		return limits, err
	}
	if validation := object["budgetValidation"]; len(validation) != 0 {
		var product struct {
			Kind   string          `json:"kind"`
			Field  string          `json:"field"`
			Reason string          `json:"reason"`
			Limits json.RawMessage `json:"limits"`
		}
		if err := json.Unmarshal(validation, &product); err != nil {
			return limits, err
		}
		switch product.Kind {
		case "invalid":
			if product.Reason != "positive-integer" {
				return limits, fmt.Errorf("unknown canonical option-validation reason")
			}
			return limits, &governanceSemanticBudgetError{product.Field}
		case "valid":
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(product.Limits, &fields); err != nil {
				return limits, err
			}
			for _, name := range []string{"maximumDepth", "maximumSteps", "maximumAlternatives"} {
				if len(fields[name]) == 0 {
					return limits, fmt.Errorf("incomplete canonical option-validation limits")
				}
			}
			// Recheck the scalar domain; the supplied product cannot weaken the
			// original reader's positive safe-integer option contract.
			return governanceParseProofLimits(append(append([]byte(`{"budget":`), product.Limits...), '}'))
		default:
			return limits, fmt.Errorf("unknown canonical option-validation product")
		}
	}
	raw := object["budget"]
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return limits, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil {
		return limits, err
	}
	if token != json.Delim('{') {
		return limits, fmt.Errorf("invalid semantic proof budget object")
	}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return limits, err
		}
		name := token.(string)
		var value any
		if err := decoder.Decode(&value); err != nil {
			return limits, err
		}
		number, ok := value.(json.Number)
		scalar := float64(0)
		if ok {
			scalar, err = number.Float64()
		}
		if !ok || err != nil || scalar < 1 || scalar > 9007199254740991 || math.Trunc(scalar) != scalar {
			return limits, &governanceSemanticBudgetError{name}
		}
		switch name {
		case "maximumDepth":
			limits.MaximumDepth = int(scalar)
		case "maximumSteps":
			limits.MaximumSteps = int(scalar)
		case "maximumAlternatives":
			limits.MaximumAlternatives = int(scalar)
		}
	}
	return limits, nil
}
