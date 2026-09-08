package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

func referenceCanonicalJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var model any
	if err := decoder.Decode(&model); err != nil {
		panic(err)
	}
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(model); err != nil {
		panic(err)
	}
	return string(bytes.TrimSuffix(output.Bytes(), []byte{'\n'}))
}

func TestCanonicalJSONPreservesIdentityPreimage(t *testing.T) {
	type payload struct {
		Z     any    `json:"z"`
		A     any    `json:"a,omitempty"`
		Nil   []int  `json:"nil"`
		Empty []int  `json:"empty"`
		Text  string `json:"text"`
	}
	values := []any{
		nil, true, false, 0, math.Copysign(0, -1), math.SmallestNonzeroFloat64,
		math.MaxFloat64, json.Number("123456789012345678901234567890"),
		payload{Z: map[string]any{"z": 1, "a": []any{1, nil, payload{Z: 2}}}, Empty: []int{}, Text: "<&>\n\t\u2028\u2029\xff"},
		map[string]any{"𝒙": 1, "é": 2, "a": 3, "\n": 4, "\\": 5, "\"": 6},
		json.RawMessage(` { "z" : 1, "a": {"z":2,"a":3}, "z": 4, "\u0061": {"replacement":true} } `),
		json.RawMessage(`{"key":"\u003c\u0026\u003e\/\u000a\uD834\uDD1E","integer":12345678901234567890,"number":1e+03}`),
	}
	for index, value := range values {
		if actual, expected := stableJSON(value), referenceCanonicalJSON(value); actual != expected {
			t.Fatalf("case %d: canonical identity preimage changed\nactual: %s\nexpected: %s", index, actual, expected)
		}
	}
}

func TestCanonicalJSONKeepsParentAndSiblingFieldsAcrossNestedArenaGrowth(t *testing.T) {
	wide := map[string]any{}
	for index := 0; index < 96; index++ {
		wide[fmt.Sprintf("field-%03d", 95-index)] = map[string]any{"z": index, "a": []any{index, nil, "<&>"}}
	}
	encoded, err := json.Marshal(wide)
	if err != nil {
		t.Fatal(err)
	}
	// A wide child grows the workspace while its parent's fields are still
	// live. Later siblings reuse that space, including duplicate escaped keys
	// whose stable last-value semantics are part of the identity contract.
	value := json.RawMessage(fmt.Sprintf(`{"z":%s,"a":{"same":1,"\u0073ame":2},"m":[%s,{}, {"z":9,"a":2}],"after":true}`, encoded, encoded))
	if actual, expected := stableJSON(value), referenceCanonicalJSON(value); actual != expected {
		t.Fatalf("nested canonical identity preimage changed\nactual: %s\nexpected: %s", actual, expected)
	}
}

func FuzzCanonicalJSONPreservesIdentityPreimage(f *testing.F) {
	for _, value := range []string{`null`, `{"z":1,"a":[true,{"z":3,"a":null}]}`, `{"a":1,"a":2}`, `"\u2028\\u2028"`, `12345678901234567890`} {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, text string) {
		if !json.Valid([]byte(text)) {
			t.Skip()
		}
		value := json.RawMessage(text)
		if actual, expected := stableJSON(value), referenceCanonicalJSON(value); actual != expected {
			t.Fatalf("canonical identity preimage changed\nactual: %q\nexpected: %q", actual, expected)
		}
	})
}

func BenchmarkCanonicalBodyIdentity(b *testing.B) {
	rows := make([]map[string]any, 1024)
	for index := range rows {
		rows[index] = map[string]any{"symbol": "symbol:abcdef0123456789", "span": sourceSpan{Source: "source:test", Revision: "source-revision:test", Start: index, End: index + 1}, "syntax": "Identifier", "value": index}
	}
	for _, implementation := range []struct {
		name   string
		encode func(any) string
	}{{"roundtrip", referenceCanonicalJSON}, {"encoded-spans", stableJSON}} {
		b.Run(implementation.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				implementation.encode(rows)
			}
		})
	}
}
