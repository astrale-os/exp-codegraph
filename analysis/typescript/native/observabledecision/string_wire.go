package observabledecision

import (
	js "astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
)

// Preserve the existing wire field names while delegating authored string
// transport to the qualified immutable UTF16 owner.
func (value DemandOutcome) MarshalJSON() ([]byte, error) {
	type alias DemandOutcome
	return json.Marshal(struct {
		*alias
		String js.JSONText
	}{alias: (*alias)(&value), String: js.JSONText(value.String)})
}
func (value NativeValueSummary) MarshalJSON() ([]byte, error) {
	type alias NativeValueSummary
	return json.Marshal(struct {
		*alias
		Literal js.JSONText
	}{alias: (*alias)(&value), Literal: js.JSONText(value.Literal)})
}
