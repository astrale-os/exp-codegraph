package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func referenceFactIdentity(entry fact) string {
	return deriveID("fact", entry.Namespace, map[string]any{
		"kind": entry.Kind, "subject": entry.Subject,
		"payload": entry.Payload, "evidence": entry.Provenance.Evidence,
	})
}

func referenceShardIdentity(shard factShard) string {
	facts := make([]map[string]any, 0, len(shard.Facts))
	for _, entry := range shard.Facts {
		facts = append(facts, map[string]any{
			"id": entry.ID, "namespace": entry.Namespace, "schemaVersion": entry.SchemaVersion,
			"kind": entry.Kind, "subject": entry.Subject, "completeness": entry.Completeness,
			"provenance": entry.Provenance, "payload": entry.Payload,
		})
	}
	return deriveID("fact-shard-digest", shard.Namespace, map[string]any{
		"key": shard.Key, "namespace": shard.Namespace, "schemaVersion": shard.SchemaVersion,
		"completion": shard.Completion, "facts": facts,
	})
}

func identityFixture(payload any) fact {
	return fact{
		Namespace: "typescript.body", SchemaVersion: 1, Kind: "function-body", Subject: "symbol:test",
		Completeness: completeness{Kind: "complete"}, Payload: payload,
		Provenance: provenance{
			Pass: "pass:fixture", PassVersion: "1", Inputs: []string{},
			Evidence: []sourceSpan{{Source: "source:𝒙", Revision: "revision:é", Start: 1, End: 5}},
		},
	}
}

func TestPreparedFactsPreserveCompleteV1Preimages(t *testing.T) {
	values := []any{
		nil, true, false, []any{}, []any(nil), map[string]any{},
		math.Copysign(0, -1), math.SmallestNonzeroFloat64, math.MaxFloat64,
		json.Number("123456789012345678901234567890"),
		"<&>\n\t\u2028\u2029\xff",
		map[string]any{"𝒙": 1, "é": []any{2, nil}, "\n": "\\", "a": map[string]any{"z": 4, "b": 3}},
		json.RawMessage(`{"z":1,"a":{"z":2,"a":3},"z":4,"\u0061":{"last":true}}`),
		json.RawMessage(`{"string":"\u003c\u0026\u003e\/\u000a\uD834\uDD1E","number":1e+03}`),
		struct {
			Z     string `json:"z"`
			Empty []int  `json:"empty"`
			Nil   []int  `json:"nil"`
			Omit  string `json:"omit,omitempty"`
		}{Z: "<é>", Empty: []int{}},
	}
	for _, version := range []int{1, 2} {
		prepared := []preparedFact{}
		for index, payload := range values {
			entry := identityFixture(payload)
			entry.SchemaVersion = version
			entry.Subject = fmt.Sprintf("symbol:%d", index)
			if index%2 == 0 {
				entry.Provenance.Evidence = []sourceSpan{}
				entry.Completeness = completeness{Kind: "partial", Reasons: []any{map[string]any{"code": "LIMIT", "effective": 2}}}
			}
			current, err := prepareFact(entry)
			if err != nil {
				t.Fatal(err)
			}
			if expected := referenceFactIdentity(entry); current.ID != expected {
				t.Fatalf("fact %d/%d identity changed: %s != %s", version, index, current.ID, expected)
			}
			if !bytes.Equal(current.canonicalPayload, canonicalJSONEncoding(payload)) {
				t.Fatalf("fact %d/%d canonical payload changed", version, index)
			}
			// Normalized module facts finalize a distinct logical ID after payload
			// preparation. The shard must observe that final ID, not an old header.
			if version == 2 {
				current.ID = "logical-module:" + current.ID
			}
			prepared = append(prepared, current)
		}
		shard := finishShardVersion("typescript.body", "owner", completeness{Kind: "complete"}, prepared, version)
		if expected := referenceShardIdentity(shard); shard.Digest != expected {
			t.Fatalf("shard v%d identity changed: %s != %s", version, shard.Digest, expected)
		}
		for index, entry := range shard.Facts {
			if !reflect.DeepEqual(entry, prepared[index].fact) {
				t.Fatal("publication changed logical fact fields")
			}
		}
	}
	for _, prepared := range [][]preparedFact{nil, {}} {
		shard := finishShard("empty", "owner", completeness{Kind: "complete"}, prepared)
		if (prepared == nil) != (shard.Facts == nil) || shard.Digest != referenceShardIdentity(shard) {
			t.Fatal("nil/empty publication or canonical empty-shard identity changed")
		}
	}
}

type countedIdentityPayload struct{ calls *int }

type failingIdentityPayload struct{}

func (failingIdentityPayload) MarshalJSON() ([]byte, error) {
	return nil, fmt.Errorf("fixture payload encoding failure")
}

func (value countedIdentityPayload) MarshalJSON() ([]byte, error) {
	*value.calls++
	return []byte(`{"z":"<&>","a":[1,2,3]}`), nil
}

func TestFactAndShardIdentitySerializeTheOwnedPayloadOnce(t *testing.T) {
	calls := 0
	entry, err := prepareFact(identityFixture(countedIdentityPayload{calls: &calls}))
	if err != nil {
		t.Fatal(err)
	}
	shard := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{entry})
	if calls != 1 || len(shard.Facts) != 1 {
		t.Fatalf("identity construction serialized its payload %d times", calls)
	}
	// These fields are introduced after semantic identities are finalized and
	// must remain excluded from the v1 shard preimage.
	entry.Generation = "generation:later"
	entry.PhysicalPayload = &physicalPayloadEnvelope{Codec: "later", Data: []int{1, 2}}
	again := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{entry})
	if again.Digest != shard.Digest || calls != 1 {
		t.Fatal("generation/physical metadata entered the semantic shard identity")
	}
}

func TestPreparedPayloadPreservesSemanticLimitsAndPublishesNothingOnRejection(t *testing.T) {
	payload := strings.Repeat("<&>", 256)
	entry, err := prepareFact(identityFixture(payload))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(payload)
	if entry.semanticBytes != len(encoded) || len(entry.canonicalPayload) >= 1024 || entry.semanticBytes <= 1024 {
		t.Fatal("semantic admission must count the original JSON spelling, not the shorter canonical spelling")
	}
	shard := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{entry})
	transaction := &factTransaction{ProtocolVersion: protocolVersion, Upserts: []factShard{shard}}
	limits := recordLimits{MaximumRecordBytes: 64 * 1024, MaximumDecodedShardBytes: 1024}
	var output bytes.Buffer
	err = writeRecordPayloadResponse(&output, 1, "transaction", transaction, 64*1024, 4096, limits, nil)
	if err == nil || !strings.Contains(err.Error(), "semantic shard") || output.Len() != 0 {
		t.Fatalf("semantic rejection published a partial stream: %v (%d bytes)", err, output.Len())
	}
	limits.MaximumDecodedShardBytes = entry.semanticBytes
	limits.MaximumTransactionBytes = entry.semanticBytes - 1
	err = writeRecordPayloadResponse(&output, 2, "transaction", transaction, 64*1024, 4096, limits, nil)
	if err == nil || !strings.Contains(err.Error(), "semantic fact payloads") || output.Len() != 0 {
		t.Fatalf("aggregate rejection published a partial stream: %v", err)
	}
	limits.MaximumTransactionBytes = entry.semanticBytes
	if err := writeRecordPayloadResponse(&output, 3, "transaction", transaction, 64*1024, 4096, limits, nil); err != nil {
		t.Fatalf("same prepared shard could not recover after admission rejection: %v", err)
	}
	if output.Len() == 0 || shard.Digest != referenceShardIdentity(shard) {
		t.Fatal("admission failure corrupted the prepared shard")
	}
	if _, err := prepareFact(identityFixture(math.Inf(1))); err == nil {
		t.Fatal("unsupported semantic JSON was silently admitted")
	}
}

func TestBodyWorkspacePreservesFinalizedShardsAcrossPayloadReuse(t *testing.T) {
	var workspace bodyIdentityWorkspace
	var published []factShard
	var encodedShards [][]byte
	payloads := []any{
		map[string]any{"wide": strings.Repeat("é<&>𝒙", 4096), "nested": map[string]any{"z": 1, "a": true}},
		nil, []any{}, []any(nil), math.Copysign(0, -1), math.SmallestNonzeroFloat64,
		json.Number("123456789012345678901234567890"), "<&>\n\t\u2028\u2029\xff",
		json.RawMessage(`{"z":1,"a":{"z":2,"a":3},"z":4,"\u0061":{"last":true}}`),
		json.RawMessage(`{"string":"\u003c\u0026\u003e\/\u000a\uD834\uDD1E","number":1e+03}`),
		map[string]any{"small": true},
	}
	for index, payload := range payloads {
		entry := identityFixture(payload)
		entry.Subject = fmt.Sprintf("symbol:body:%d", index)
		if index%2 != 0 {
			entry.Completeness = completeness{Kind: "partial", Reasons: []any{map[string]any{"code": "LIMIT"}}}
		}
		prepared, err := workspace.prepare(entry)
		if err != nil {
			t.Fatal(err)
		}
		owned, err := prepareFact(entry)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(prepared.fact, owned.fact) || !bytes.Equal(prepared.canonicalPayload, owned.canonicalPayload) {
			t.Fatalf("body %d changed its logical fact, semantic admission size or identity preimage", index)
		}
		shard := finishShard(entry.Namespace, entry.Subject, entry.Completeness, []preparedFact{prepared})
		if shard.Digest != referenceShardIdentity(shard) {
			t.Fatalf("body %d metadata hashing overwrote the borrowed payload", index)
		}
		encoded, err := json.Marshal(shard)
		if err != nil {
			t.Fatal(err)
		}
		published = append(published, shard)
		encodedShards = append(encodedShards, encoded)
	}
	for index, shard := range published {
		encoded, err := json.Marshal(shard)
		if err != nil || !bytes.Equal(encoded, encodedShards[index]) || shard.Digest != referenceShardIdentity(shard) {
			t.Fatalf("workspace reuse mutated previously finalized body %d", index)
		}
	}
}

func TestBodyWorkspaceReusesCapacityWithoutRetainingCanonicalFieldKeys(t *testing.T) {
	var workspace bodyIdentityWorkspace
	var input strings.Builder
	input.WriteString(`{"\u0061":true`)
	for index := range 512 {
		fmt.Fprintf(&input, `,"field-%04d":{"z":"%s","a":true}`, index, strings.Repeat("x", 128))
	}
	input.WriteByte('}')
	finish := func(payload any) {
		t.Helper()
		prepared, err := workspace.prepare(identityFixture(payload))
		if err != nil {
			t.Fatal(err)
		}
		shard := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{prepared})
		if shard.Digest != referenceShardIdentity(shard) {
			t.Fatal("reused body identity changed")
		}
		if workspace.canonical.input != nil || len(workspace.canonical.fields) != 0 {
			t.Fatal("completed canonical encoding retained its input or active descriptors")
		}
		for _, field := range workspace.canonical.fields[:cap(workspace.canonical.fields)] {
			if field.key != nil {
				t.Fatal("popped field descriptor retained an input slice or normalized key")
			}
		}
	}
	finish(json.RawMessage(input.String()))
	semantic, canonical := &workspace.semantic.Bytes()[0], &workspace.canonical.output[0]
	fields := &workspace.canonical.fields[:cap(workspace.canonical.fields)][0]
	for range 8 {
		finish(map[string]any{"small": "<&>𝒙"})
		if semantic != &workspace.semantic.Bytes()[0] || canonical != &workspace.canonical.output[0] || fields != &workspace.canonical.fields[:cap(workspace.canonical.fields)][0] {
			t.Fatal("smaller bodies allocated replacement semantic, canonical or descriptor buffers")
		}
	}
}

func TestBodyWorkspacePreservesAdmissionAndRecoversAfterEncodingFailure(t *testing.T) {
	var workspace bodyIdentityWorkspace
	calls := 0
	prepared, err := workspace.prepare(identityFixture(countedIdentityPayload{calls: &calls}))
	if err != nil {
		t.Fatal(err)
	}
	finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{prepared})
	if calls != 1 {
		t.Fatalf("workspace serialized its logical payload %d times", calls)
	}
	payload := strings.Repeat("<&>", 256)
	prepared, err = workspace.prepare(identityFixture(payload))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(payload)
	if prepared.semanticBytes != len(encoded) || len(prepared.canonicalPayload) >= 1024 || prepared.semanticBytes <= 1024 {
		t.Fatal("workspace changed the admitted JSON spelling or included Encoder's newline")
	}
	shard := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{prepared})
	transaction := &factTransaction{ProtocolVersion: protocolVersion, Upserts: []factShard{shard}}
	var output bytes.Buffer
	limits := recordLimits{MaximumRecordBytes: 64 * 1024, MaximumDecodedShardBytes: 1024}
	err = writeRecordPayloadResponse(&output, 1, "transaction", transaction, 64*1024, 4096, limits, nil)
	if err == nil || !strings.Contains(err.Error(), "semantic shard") || output.Len() != 0 {
		t.Fatalf("workspace admission published rejected bytes: %v", err)
	}
	limits.MaximumDecodedShardBytes = prepared.semanticBytes
	limits.MaximumTransactionBytes = prepared.semanticBytes - 1
	err = writeRecordPayloadResponse(&output, 2, "transaction", transaction, 64*1024, 4096, limits, nil)
	if err == nil || !strings.Contains(err.Error(), "semantic fact payloads") || output.Len() != 0 {
		t.Fatalf("workspace bypassed aggregate semantic admission: %v", err)
	}
	for _, invalid := range []any{math.Inf(1), math.NaN(), failingIdentityPayload{}} {
		if _, err := workspace.prepare(identityFixture(invalid)); err == nil {
			t.Fatalf("workspace silently admitted an invalid payload: %T", invalid)
		}
		recovered, err := workspace.prepare(identityFixture(map[string]any{"recovered": true}))
		if err != nil || recovered.ID != referenceFactIdentity(recovered.fact) {
			t.Fatalf("workspace could not recover after encoding failure: %v", err)
		}
		finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{recovered})
	}
	limits.MaximumTransactionBytes = prepared.semanticBytes
	if err := writeRecordPayloadResponse(&output, 3, "transaction", transaction, 64*1024, 4096, limits, nil); err != nil {
		t.Fatalf("previously finalized shard became unusable after workspace reuse: %v", err)
	}
	if output.Len() == 0 || shard.Digest != referenceShardIdentity(shard) {
		t.Fatal("workspace reuse corrupted the rejected shard or its retained semantic size")
	}
}

func BenchmarkBodyIdentityWorkspace(b *testing.B) {
	rows := make([]map[string]any, 256)
	for index := range rows {
		rows[index] = map[string]any{"symbol": "symbol:abcdef0123456789", "span": sourceSpan{Source: "source:test", Revision: "revision:test", Start: index, End: index + 1}, "value": "<&>", "syntax": "Identifier"}
	}
	entry := identityFixture(map[string]any{"body": rows, "values": rows})
	for _, mode := range []string{"owned-per-body", "projection-workspace"} {
		b.Run(mode, func(b *testing.B) {
			var workspace bodyIdentityWorkspace
			prepare := prepareFact
			if mode == "projection-workspace" {
				prepare = workspace.prepare
			}
			b.ReportAllocs()
			for b.Loop() {
				prepared, err := prepare(entry)
				if err != nil {
					b.Fatal(err)
				}
				finishShard(entry.Namespace, entry.Subject, entry.Completeness, []preparedFact{prepared})
			}
		})
	}
}

func BenchmarkPreparedFactIdentity(b *testing.B) {
	rows := make([]map[string]any, 256)
	for index := range rows {
		rows[index] = map[string]any{"symbol": "symbol:abcdef0123456789", "span": sourceSpan{Source: "source:test", Revision: "revision:test", Start: index, End: index + 1}, "value": "<&>", "syntax": "Identifier"}
	}
	for _, fixture := range []struct {
		name    string
		payload any
	}{
		{"symbol", map[string]any{"symbol": "symbol:abcdef0123456789", "name": "value", "source": "source:test", "flags": 1}},
		{"body", map[string]any{"body": rows, "values": rows}},
	} {
		b.Run(fixture.name, func(b *testing.B) { benchmarkPreparedFactIdentity(b, fixture.payload) })
	}
}

func benchmarkPreparedFactIdentity(b *testing.B, payload any) {
	base := identityFixture(payload)
	prepared, _ := prepareFact(base)
	shard := finishShard("typescript.body", "owner", completeness{Kind: "complete"}, []preparedFact{prepared})
	for _, component := range []string{"fact", "shard", "combined"} {
		b.Run(component+"/legacy-envelopes", func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if component != "shard" {
					_, _ = json.Marshal(base.Payload)
					_ = referenceFactIdentity(base)
				}
				if component != "fact" {
					_ = referenceShardIdentity(shard)
				}
			}
		})
		b.Run(component+"/prepared-streams", func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				current := prepared
				if component != "shard" {
					current, _ = prepareFact(base)
				}
				if component != "fact" {
					_ = nativeShardIdentity(shard, []preparedFact{current})
				}
			}
		})
	}
}
