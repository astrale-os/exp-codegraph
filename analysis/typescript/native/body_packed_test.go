package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func packedBodyTestID(kind string, value int) string {
	return fmt.Sprintf("%s:%064x", kind, value)
}

func packedBodyTestFixture() (bodyFactPayload, sourceSpan) {
	source := sourceSpan{Source: packedBodyTestID("source", 1), Revision: packedBodyTestID("source-revision", 2), Start: 0, End: 100}
	owner, symbol, namespace := packedBodyTestID("symbol", 3), packedBodyTestID("symbol", 4), packedBodyTestID("symbol", 5)
	ids := []string{packedBodyTestID("occurrence", 6), packedBodyTestID("occurrence", 7), packedBodyTestID("occurrence", 8), packedBodyTestID("occurrence", 9)}
	origin := &callTargetOrigin{Package: "@example/domain", File: "domain.ts", Path: []string{"Order", "status"}}
	occurrences := []bodyOccurrence{
		{ID: ids[0], Kind: "assignment", Syntax: "BinaryExpression", Symbol: symbol, SymbolOrigin: origin, Operator: "EqualsToken"},
		{ID: ids[1], Kind: "use", Syntax: "Identifier"},
		{ID: ids[2], Kind: "expression", Syntax: "PropertyAccessExpression", Symbol: symbol, SymbolKind: "module-namespace", PropertyName: "status", PropertyNamespace: namespace},
		{ID: ids[3], Kind: "call", Syntax: "CallExpression", Symbol: namespace},
	}
	for i := range occurrences {
		occurrences[i].Owner = owner
		occurrences[i].Span = source
		occurrences[i].Span.Start, occurrences[i].Span.End = i*10, i*10+9
	}
	return bodyFactPayload{
		Body: functionBodyIR{
			Function: owner, Scope: "function", Execution: "async", Parameters: []string{symbol, namespace}, Occurrences: occurrences,
			Relations: []bodyRelation{
				{Parent: ids[0], Child: ids[1], Role: "argument"},
				{Parent: ids[0], Child: ids[2], Role: "argument"},
				{Parent: ids[2], Child: ids[2], Role: "receiver"},
			},
			Blocks: []controlFlowBlock{{ID: "entry", Occurrences: []string{ids[0], ids[1]}}, {ID: "exit", Occurrences: []string{ids[2], ids[3]}}},
			Edges: []controlFlowEdge{
				{From: "entry", To: "exit", Kind: "fallthrough"},
				{From: "exit", To: "exit", Kind: "true", Evidence: ids[2]},
				{From: "entry", To: "exit", Kind: "fallthrough", Evidence: ids[1]},
			},
			Definitions: []definitionUse{
				{Definition: ids[0], Use: ids[2], Symbol: symbol, Reaching: "definite"},
				{Definition: ids[1], Use: ids[2], Reaching: "possible"},
				{Definition: ids[0], Use: ids[2], Symbol: symbol, Reaching: "definite"},
			},
			Calls: []resolvedCall{
				{Occurrence: ids[3], Target: namespace, TargetOrigin: origin, Signature: "()", Receiver: ids[1], TypeArguments: []string{"T"}, Arguments: []string{ids[1], ids[2]},
					Bindings: []parameterBinding{{Argument: ids[1], Parameter: symbol, Index: 0}, {Argument: ids[2], Parameter: symbol, Index: 1, Rest: true}}, Callbacks: []string{namespace}},
			},
			Summary: functionSummary{Function: owner, Returns: []string{ids[2]}, Throws: []string{ids[1]}, Captures: []string{symbol}, Calls: []string{ids[3]}, Escapes: []string{ids[2], ids[2]}, Recursion: true},
		},
		Values:       map[string]any{ids[2]: map[string]any{"kind": "known", "value": "submitted", "evidence": []any{}}, ids[0]: map[string]any{"kind": "known", "value": nil, "evidence": []any{}}},
		Completeness: completeness{Kind: "partial", Reasons: []any{map[string]any{"code": "QUALIFICATION", "message": "Preserve completeness.", "effective": map[string]any{"limit": 1}}}},
	}, source
}

func packedBodyTestPack(t testing.TB, payload bodyFactPayload, source sourceSpan, codec string) packedBodyData {
	t.Helper()
	envelope, err := packBodyPayload(payload, source, codec)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Codec != codec {
		t.Fatalf("codec = %q, want %q", envelope.Codec, codec)
	}
	return envelope.Data.(packedBodyData)
}

func packedBodyTestJSON(t testing.TB, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

// The TypeScript regression runner consumes this line and admits both actual
// producer envelopes with the real codecs, comparing them to the logical input.
func TestPackedBodyProducerFixture(t *testing.T) {
	payload, source := packedBodyTestFixture()
	legacy, err := packBodyPayload(payload, source, typescriptBodyPayloadCodecV5)
	if err != nil {
		t.Fatal(err)
	}
	columnar, err := packBodyPayload(payload, source, typescriptBodyPayloadCodec)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("CODEGRAPH_PACKED_BODY_FIXTURE %s", packedBodyTestJSON(t, map[string]any{
		"logical": payload, "legacy": legacy, "columnar": columnar,
	}))
}

func TestPackedBodyCodecNegotiationPreservesLegacyClients(t *testing.T) {
	for _, test := range []struct {
		name   string
		codecs map[string]bool
		want   string
	}{
		{"logical", nil, ""},
		{"older codecs", map[string]bool{"typescript.body.packed/1": true, "typescript.body.packed/4": true}, ""},
		{"legacy", map[string]bool{typescriptBodyPayloadCodecV5: true}, typescriptBodyPayloadCodecV5},
		{"columnar", map[string]bool{typescriptBodyPayloadCodec: true}, typescriptBodyPayloadCodec},
		{"prefer columnar", map[string]bool{typescriptBodyPayloadCodecV5: true, typescriptBodyPayloadCodec: true}, typescriptBodyPayloadCodec},
		{"false does not advertise", map[string]bool{typescriptBodyPayloadCodecV5: true, typescriptBodyPayloadCodec: false}, typescriptBodyPayloadCodecV5},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := negotiatedBodyPayloadCodec(test.codecs); got != test.want {
				t.Fatalf("negotiated %q, want %q", got, test.want)
			}
		})
	}
	payload, source := packedBodyTestFixture()
	for _, codec := range []string{"", "typescript.body.packed/4", "typescript.body.packed/7"} {
		got, err := packBodyPayload(payload, source, codec)
		if err == nil || !reflect.DeepEqual(got, physicalPayloadEnvelope{}) {
			t.Fatalf("unsupported codec %q returned (%+v, %v)", codec, got, err)
		}
	}
}

func TestPackedBodyColumnsPreserveContractAndLegacyRows(t *testing.T) {
	payload, source := packedBodyTestFixture()
	before := packedBodyTestJSON(t, payload)
	legacy := packedBodyTestPack(t, payload, source, typescriptBodyPayloadCodecV5)
	columns := packedBodyTestPack(t, payload, source, typescriptBodyPayloadCodec)
	if !bytes.Equal(before, packedBodyTestJSON(t, payload)) {
		t.Fatal("packing mutated the logical payload")
	}
	wantTexts := []string{"EqualsToken", "assignment", "BinaryExpression", "use", "Identifier", "module-namespace", "status", "expression", "PropertyAccessExpression", "call", "CallExpression", "argument", "receiver", "entry", "exit", "fallthrough", "true", "definite", "possible", "()", "T"}
	if !reflect.DeepEqual(columns.Texts, wantTexts) {
		t.Fatalf("dictionary order changed: %v", columns.Texts)
	}
	occurrences := columns.Occurrences.([]any)
	ids, fields, origins := occurrences[0].([]string), occurrences[1].([]int), occurrences[2].([]*callTargetOrigin)
	wantFields := []int{
		1, 0, 9, 2, 0, 0, -1, -1, -1,
		3, 10, 19, 4, -1, -1, -1, -1, -1,
		7, 20, 29, 8, 0, -1, 5, 6, 1,
		9, 30, 39, 10, 1, -1, -1, -1, -1,
	}
	if !reflect.DeepEqual(fields, wantFields) || len(ids) != 4 || len(origins) != 4 {
		t.Fatalf("occurrence columns differ: %+v", occurrences)
	}
	if !reflect.DeepEqual(origins, []*callTargetOrigin{payload.Body.Occurrences[0].SymbolOrigin, nil, nil, nil}) {
		t.Fatalf("origins lost their occurrence alignment: %+v", origins)
	}
	for i, id := range ids {
		want, err := compactAnalysisID(payload.Body.Occurrences[i].ID, "occurrence")
		if err != nil || id != want {
			t.Fatalf("occurrence identity %d = %q, want %q (%v)", i, id, want, err)
		}
	}
	for _, table := range []struct {
		name string
		got  any
		want []int
	}{
		{"relations", columns.Relations, []int{0, 1, 11, 0, 2, 11, 2, 2, 12}},
		{"edges", columns.Edges, []int{0, 1, 15, -1, 1, 1, 16, 2, 0, 1, 15, 1}},
		{"definitions", columns.Definitions, []int{0, 2, 0, 17, 1, 2, -1, 18, 0, 2, 0, 17}},
	} {
		if !reflect.DeepEqual(table.got, table.want) {
			t.Errorf("%s = %v, want %v", table.name, table.got, table.want)
		}
	}

	// Reconstruct legacy rows only in the regression oracle. Production retains
	// the column vectors directly and never creates this second representation.
	rows := make([][]any, len(ids))
	for i, id := range ids {
		f := fields[i*9 : (i+1)*9]
		rows[i] = []any{id, f[0], f[1], f[2], f[3], f[4], origins[i], f[5], f[6], f[7], f[8]}
	}
	rowTable := func(flat []int, stride int) [][]any {
		rows := make([][]any, 0, len(flat)/stride)
		for offset := 0; offset < len(flat); offset += stride {
			row := make([]any, stride)
			for field := range stride {
				row[field] = flat[offset+field]
			}
			rows = append(rows, row)
		}
		return rows
	}
	columns.Occurrences = rows
	columns.Relations = rowTable(columns.Relations.([]int), 3)
	columns.Edges = rowTable(columns.Edges.([]int), 4)
	columns.Definitions = rowTable(columns.Definitions.([]int), 4)
	if !bytes.Equal(packedBodyTestJSON(t, legacy), packedBodyTestJSON(t, columns)) {
		t.Fatal("packed/6 changed a legacy value, row order, duplicate, sentinel or untouched section")
	}
}

func TestPackedBodyColumnsKeepEmptyTablesAsArrays(t *testing.T) {
	payload, source := packedBodyTestFixture()
	payload.Body = functionBodyIR{Function: payload.Body.Function, Scope: "function", Execution: "sync", Summary: functionSummary{Function: payload.Body.Function}}
	payload.Values = nil
	for _, codec := range []string{typescriptBodyPayloadCodecV5, typescriptBodyPayloadCodec} {
		packed := packedBodyTestPack(t, payload, source, codec)
		var wire map[string]json.RawMessage
		if err := json.Unmarshal(packedBodyTestJSON(t, packed), &wire); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"s", "t", "p", "r", "b", "e", "d", "a", "v"} {
			if string(wire[key]) != "[]" {
				t.Errorf("%s.%s = %s, want []", codec, key, wire[key])
			}
		}
		wantOccurrences := "[]"
		if codec == typescriptBodyPayloadCodec {
			wantOccurrences = "[[],[],[]]"
		}
		if string(wire["o"]) != wantOccurrences {
			t.Errorf("%s.o = %s, want %s", codec, wire["o"], wantOccurrences)
		}
	}
}

func TestPackedBodyColumnsPreserveSafeIntegersBeyond32Bits(t *testing.T) {
	if strconv.IntSize < 64 {
		t.Skip("native release targets use 64-bit integers")
	}
	payload, source := packedBodyTestFixture()
	maximum := int64(1<<53 - 1)
	payload.Body.Occurrences[0].Span.Start = int(maximum - 1)
	payload.Body.Occurrences[0].Span.End = int(maximum)
	packed := packedBodyTestPack(t, payload, source, typescriptBodyPayloadCodec)
	fields := packed.Occurrences.([]any)[1].([]int)
	if fields[1] != int(maximum-1) || fields[2] != int(maximum) {
		t.Fatalf("source positions were narrowed: %v", fields[:9])
	}
	wire := packedBodyTestJSON(t, packed)
	if !bytes.Contains(wire, []byte("9007199254740990,9007199254740991")) {
		t.Fatal("safe source positions were not serialized exactly")
	}
}

func TestPackedBodyColumnCapacityRejectsOverflowWithoutAllocation(t *testing.T) {
	maximum := int(^uint(0) >> 1)
	for _, stride := range []int{3, 4, 9} {
		rows := maximum / stride
		if got, err := packedFieldCapacity(rows, stride); err != nil || got != rows*stride {
			t.Fatalf("safe capacity (%d, %d) = (%d, %v)", rows, stride, got, err)
		}
		if got, err := packedFieldCapacity(rows+1, stride); err == nil || got != 0 {
			t.Fatalf("overflow capacity (%d, %d) = (%d, %v)", rows+1, stride, got, err)
		}
		if got, err := packedFieldCapacity(0, stride); err != nil || got != 0 {
			t.Fatalf("empty capacity = (%d, %v)", got, err)
		}
	}
	for _, input := range [][2]int{{-1, 9}, {1, 0}, {1, -1}} {
		if _, err := packedFieldCapacity(input[0], input[1]); err == nil {
			t.Fatalf("invalid capacity %v accepted", input)
		}
	}
}

func TestPackedBodyColumnsRetainValidationAndPublishNothingOnError(t *testing.T) {
	for _, test := range []struct {
		name    string
		change  func(*bodyFactPayload, *sourceSpan)
		message string
	}{
		{"source identity", func(_ *bodyFactPayload, s *sourceSpan) { s.Source = "source:bad" }, "expected source identity"},
		{"summary owner", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Summary.Function = "other" }, "summary owner differs"},
		{"duplicate occurrence", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Occurrences[1].ID = p.Body.Occurrences[0].ID }, "is duplicated"},
		{"foreign owner", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Occurrences[1].Owner = "other" }, "does not share"},
		{"foreign source", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Occurrences[1].Span.Source = "other" }, "does not share"},
		{"foreign revision", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Occurrences[1].Span.Revision = "other" }, "does not share"},
		{"namespace identity", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Occurrences[2].PropertyNamespace = "symbol:bad" }, "expected symbol identity"},
		{"unknown relation", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Relations[0].Child = "missing" }, "unknown occurrence"},
		{"duplicate block", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Blocks[1].ID = p.Body.Blocks[0].ID }, "is duplicated"},
		{"unknown edge block", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Edges[0].To = "missing" }, "unknown block"},
		{"unknown edge evidence", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Edges[0].Evidence = "missing" }, "unknown occurrence"},
		{"unknown definition", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Definitions[0].Definition = "missing" }, "unknown occurrence"},
		{"unknown call binding", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Calls[0].Bindings[0].Argument = "missing" }, "unknown occurrence"},
		{"unknown summary", func(p *bodyFactPayload, _ *sourceSpan) { p.Body.Summary.Returns = []string{"missing"} }, "unknown occurrence"},
		{"unknown value", func(p *bodyFactPayload, _ *sourceSpan) { p.Values["missing"] = "bad" }, "values contain an unknown occurrence"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var previousError string
			for _, codec := range []string{typescriptBodyPayloadCodecV5, typescriptBodyPayloadCodec} {
				payload, source := packedBodyTestFixture()
				test.change(&payload, &source)
				before := packedBodyTestJSON(t, payload)
				got, err := packBodyPayload(payload, source, codec)
				if err == nil || !strings.Contains(err.Error(), test.message) || !reflect.DeepEqual(got, physicalPayloadEnvelope{}) {
					t.Fatalf("%s returned (%+v, %v), want no result and %q", codec, got, err, test.message)
				}
				if previousError != "" && previousError != err.Error() {
					t.Fatalf("error changed between codecs: %q / %q", previousError, err)
				}
				previousError = err.Error()
				if !bytes.Equal(before, packedBodyTestJSON(t, payload)) {
					t.Fatal("rejected packing mutated its logical input")
				}
			}
		})
	}
}

func TestPackedBodyColumnsOwnTheirNumericBuffers(t *testing.T) {
	payload, source := packedBodyTestFixture()
	input := packedBodyTestJSON(t, payload)
	first := packedBodyTestPack(t, payload, source, typescriptBodyPayloadCodec)
	second := packedBodyTestPack(t, payload, source, typescriptBodyPayloadCodec)
	before := packedBodyTestJSON(t, second)
	occurrences := first.Occurrences.([]any)
	occurrences[0].([]string)[0] = "changed"
	occurrences[1].([]int)[0] = 999
	occurrences[2].([]*callTargetOrigin)[0] = nil
	first.Relations.([]int)[0] = 999
	first.Edges.([]int)[0] = 999
	first.Definitions.([]int)[0] = 999
	if !bytes.Equal(before, packedBodyTestJSON(t, second)) || !bytes.Equal(input, packedBodyTestJSON(t, payload)) {
		t.Fatal("body packing reused another result's column buffers or mutated logical input")
	}
}

// Measures the producer representation itself, without JSON encoding or input
// construction. Run both codecs on the same payload to attribute row removal.
func BenchmarkPackedBodyColumns(b *testing.B) {
	payload, source := packedBodyTestFixture()
	payload.Body.Relations = nil
	payload.Body.Definitions = nil
	for i := range 1024 {
		occurrence := payload.Body.Occurrences[i%4]
		occurrence.ID = packedBodyTestID("occurrence", 10+i)
		payload.Body.Occurrences = append(payload.Body.Occurrences, occurrence)
		payload.Body.Blocks[1].Occurrences = append(payload.Body.Blocks[1].Occurrences, occurrence.ID)
		payload.Body.Relations = append(payload.Body.Relations, bodyRelation{Parent: payload.Body.Occurrences[0].ID, Child: occurrence.ID, Role: "argument"})
		payload.Body.Definitions = append(payload.Body.Definitions, definitionUse{Definition: occurrence.ID, Use: payload.Body.Occurrences[2].ID, Symbol: occurrence.Symbol, Reaching: "possible"})
	}
	for _, codec := range []string{typescriptBodyPayloadCodecV5, typescriptBodyPayloadCodec} {
		b.Run(codec, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := packBodyPayload(payload, source, codec); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
