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
		Upserts:         []factShard{{Key: "fact-shard-key:fixture", Facts: []fact{{Payload: strings.Repeat("é𐀀\n", 2000)}}}},
		Deletes:         []string{"fact-shard-key:deleted"},
	}
	for _, kind := range []string{"transaction", "delta"} {
		t.Run(kind, func(t *testing.T) {
			var output bytes.Buffer
			if err := writeRecordPayloadResponse(&output, 7, kind, transaction, 2048, 1024, 128*1024, nil); err != nil {
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
	err := writeRecordPayloadResponse(&output, 1, "transaction", transaction, 1024, 1024, 1024, nil)
	if err == nil || !strings.Contains(err.Error(), "transaction exceeds configured limit") {
		t.Fatalf("expected transaction limit error, received %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("a rejected transaction emitted a visible prefix")
	}
}
