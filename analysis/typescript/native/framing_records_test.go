package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestRecordStreamPreservesWholeShardsAcrossBoundedFrames(t *testing.T) {
	transaction := &factTransaction{
		ProtocolVersion: protocolVersion,
		Manifest:        []factShardReference{{Key: "fact-shard-key:fixture", Facts: 1}},
		Upserts:         []factShard{{Key: "fact-shard-key:fixture", Facts: []fact{recordFixtureFact(strings.Repeat("é𐀀\n", 2000))}}},
		Deletes:         []string{"fact-shard-key:deleted"},
	}
	for _, kind := range []string{"transaction", "delta"} {
		t.Run(kind, func(t *testing.T) {
			var output bytes.Buffer
			if err := writeRecordPayloadResponse(&output, 7, kind, transaction, 2048, 1024, recordLimits{MaximumRecordBytes: 64 * 1024, MaximumDecodedShardBytes: 64 * 1024, MaximumPhysicalTransactionBytes: 128 * 1024}, nil); err != nil {
				t.Fatal(err)
			}
			lines := bytes.Split(bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), []byte{'\n'})
			var start transactionStartFrame
			if err := json.Unmarshal(lines[0], &start); err != nil {
				t.Fatal(err)
			}
			if start.Encoding != transactionRecordEncoding || start.PayloadKind != kind || start.Chunks != len(lines)-2 {
				t.Fatalf("invalid start: %+v", start)
			}
			var assembled bytes.Buffer
			for index, line := range lines[1 : len(lines)-1] {
				if len(line) > 1024 {
					t.Fatalf("frame exceeds preferred limit: %d", len(line))
				}
				var chunk transactionChunkFrame
				if err := json.Unmarshal(line, &chunk); err != nil {
					t.Fatal(err)
				}
				if chunk.Sequence != index {
					t.Fatalf("chunk order: %d != %d", chunk.Sequence, index)
				}
				decoded, err := base64.StdEncoding.DecodeString(chunk.Data)
				if err != nil {
					t.Fatal(err)
				}
				assembled.Write(decoded)
			}
			var end transactionEndFrame
			if err := json.Unmarshal(lines[len(lines)-1], &end); err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(assembled.Bytes())
			if start.SHA256 != hex.EncodeToString(digest[:]) || start.Bytes != assembled.Len() || end.SHA256 != start.SHA256 || end.Bytes != start.Bytes || end.Chunks != start.Chunks {
				t.Fatal("stream commitment does not match encoded records")
			}
			records := bytes.Split(bytes.TrimSuffix(assembled.Bytes(), []byte{'\n'}), []byte{'\n'})
			manifestCount := 1
			if kind == "delta" {
				manifestCount = 0
			}
			if len(records) != 3+manifestCount {
				t.Fatalf("unexpected record count: %d", len(records))
			}
			var header []json.RawMessage
			if err := json.Unmarshal(records[0], &header); err != nil {
				t.Fatal(err)
			}
			var counts []int
			if err := json.Unmarshal(header[2], &counts); err != nil {
				t.Fatal(err)
			}
			if len(counts) != 3 || counts[0] != manifestCount || counts[1] != 1 || counts[2] != 1 {
				t.Fatalf("invalid counts: %v", counts)
			}
			var record []json.RawMessage
			if err := json.Unmarshal(records[1+manifestCount], &record); err != nil {
				t.Fatal(err)
			}
			expected, err := json.Marshal(transaction.Upserts[0])
			if err != nil {
				t.Fatal(err)
			}
			if string(record[0]) != `"upsert"` || !bytes.Equal(record[1], expected) {
				t.Fatal("record changed the shard bytes")
			}
		})
	}
}

func TestRecordStreamRejectsPhysicalBudgetBeforePublishing(t *testing.T) {
	transaction := &factTransaction{ProtocolVersion: protocolVersion, Deletes: []string{strings.Repeat("x", 2048)}}
	var output bytes.Buffer
	err := writeRecordPayloadResponse(&output, 1, "transaction", transaction, 1024, 1024, recordLimits{MaximumRecordBytes: 4096, MaximumDecodedShardBytes: 4096, MaximumPhysicalTransactionBytes: 1024}, nil)
	if err == nil || !strings.Contains(err.Error(), "transaction exceeds configured limit") {
		t.Fatalf("expected transaction limit error, received %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("a rejected transaction emitted a visible prefix")
	}
}

func recordFixtureFact(payload any) fact {
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return fact{Payload: payload, semanticBytes: len(encoded)}
}

func TestRecordStreamBoundsEachUnitIndependentlyOfAggregateSize(t *testing.T) {
	transaction := &factTransaction{ProtocolVersion: protocolVersion}
	for range 8 {
		transaction.Upserts = append(transaction.Upserts, factShard{Facts: []fact{recordFixtureFact(strings.Repeat("x", 800))}})
	}
	var output bytes.Buffer
	if err := writeRecordPayloadResponse(&output, 1, "transaction", transaction, 2048, 1024, recordLimits{MaximumRecordBytes: 4096, MaximumDecodedShardBytes: 1024}, nil); err != nil {
		t.Fatal(err)
	}
	if output.Len() < 8*800 {
		t.Fatal("the transaction was truncated to a per-record or per-shard budget")
	}
	output.Reset()
	if err := writeRecordPayloadResponse(&output, 1, "transaction", transaction, 2048, 1024, recordLimits{MaximumRecordBytes: 4096, MaximumDecodedShardBytes: 1024, MaximumPhysicalTransactionBytes: 4096}, nil); err == nil || !strings.Contains(err.Error(), "transaction exceeds") {
		t.Fatalf("explicit aggregate budget was not retained: %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("a rejected aggregate exposed a partial stream")
	}
}

func TestRecordStreamRejectsOversizedUnitsBeforePublishing(t *testing.T) {
	cases := []struct {
		name                      string
		shard                     factShard
		recordBytes, decodedBytes int
		message                   string
	}{
		{"physical", factShard{Facts: []fact{recordFixtureFact(strings.Repeat("x", 900))}}, 1024, 4096, "record exceeds"},
		{"expanded", factShard{Facts: []fact{{PhysicalPayload: &physicalPayloadEnvelope{Codec: "fixture", Data: "tiny"}, semanticBytes: 2048}}}, 4096, 1024, "semantic shard"},
		{"combined-facts", factShard{Facts: []fact{recordFixtureFact(strings.Repeat("x", 600)), recordFixtureFact(strings.Repeat("y", 600))}}, 4096, 1024, "semantic shard"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			transaction := &factTransaction{ProtocolVersion: protocolVersion, Upserts: []factShard{test.shard}}
			err := writeRecordPayloadResponse(&output, 1, "transaction", transaction, 2048, 1024, recordLimits{MaximumRecordBytes: test.recordBytes, MaximumDecodedShardBytes: test.decodedBytes}, nil)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("unit budget was not enforced: %v", err)
			}
			if output.Len() != 0 {
				t.Fatal("a rejected unit exposed a partial stream")
			}
		})
	}
}

func TestRecordStreamRetainsExplicitSemanticAggregateDuringPendingReplay(t *testing.T) {
	transaction := &factTransaction{ProtocolVersion: protocolVersion}
	for range 4 {
		transaction.Upserts = append(transaction.Upserts, factShard{Facts: []fact{recordFixtureFact(strings.Repeat("x", 800))}})
	}
	var request request
	if err := json.Unmarshal([]byte(`{"id":1,"kind":"refresh","recordLimits":{"maximumRecordBytes":4096,"maximumDecodedShardBytes":1024,"maximumTransactionBytes":2048,"maximumPhysicalTransactionBytes":0}}`), &request); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	err := writeRecordPayloadResponse(&output, request.ID, "transaction", transaction, 2048, 1024, *request.RecordLimits, nil)
	if err == nil || !strings.Contains(err.Error(), "semantic fact payloads exceed") {
		t.Fatalf("explicit aggregate semantic budget was not retained on replay: %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("a rejected semantic aggregate exposed a partial stream")
	}
}
