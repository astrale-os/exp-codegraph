package main

import "testing"

func TestStableJSONMatchesPortableUnicodeSeparatorSpelling(t *testing.T) {
	actual := stableJSON(map[string]any{
		"actual":  "line\u2028paragraph\u2029separator",
		"literal": `line\u2028paragraph\u2029separator`,
	})
	expected := `{"actual":"line\u2028paragraph\u2029separator","literal":"line\\u2028paragraph\\u2029separator"}`
	if actual != expected {
		t.Fatalf("portable canonical JSON differs:\nactual:   %s\nexpected: %s", actual, expected)
	}
}
