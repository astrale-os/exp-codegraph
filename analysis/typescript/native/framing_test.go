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

func TestWriteRecordResponseFragmentsOneOversizedShard(t *testing.T) {
	transaction := &factTransaction{
		ProtocolVersion: protocolVersion,
		Next: analysisGeneration{
			ID: "generation:test", Sequence: 1, Universe: "project-universe:test",
			Producer: producerIdentity{
				ID: "producer:test", Name: "fixture", Version: "1", ProtocolVersion: protocolVersion,
			},
			SourceManifest: "source-manifest:test", Capabilities: []string{"fixture"},
		},
		Manifest: []factShardReference{},
		Upserts: []factShard{{
			Key: "fact-shard-key:test", Digest: "fact-shard-digest:test",
			Namespace: "fixture", SchemaVersion: 1, Completion: completeness{Kind: "complete"},
			Facts: []fact{{
				ID: "fact:test", Generation: "generation:test", Namespace: "fixture",
				SchemaVersion: 1, Kind: "fixture", Subject: "fixture",
				Completeness: completeness{Kind: "complete"},
				Provenance: provenance{
					Pass: "pass:test", PassVersion: "1", Evidence: []sourceSpan{}, Inputs: []string{},
				},
				Payload: strings.Repeat("one-shard-payload", 800),
			}},
		}},
		Deletes: []string{},
	}
	transaction.Upserts[0].Facts[0].semanticBytes = recordFixtureFact(transaction.Upserts[0].Facts[0].Payload).semanticBytes
	const maximumFrameBytes = 1024
	var output bytes.Buffer
	if err := writeRecordPayloadResponse(&output, 7, "transaction", transaction, maximumFrameBytes, maximumFrameBytes, recordLimits{MaximumRecordBytes: 32 * 1024, MaximumDecodedShardBytes: 32 * 1024, MaximumTransactionBytes: 32 * 1024, MaximumPhysicalTransactionBytes: 32 * 1024}, nil); err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), []byte{'\n'})
	if len(lines) < 3 {
		t.Fatalf("expected a framed transaction, received %d frames", len(lines))
	}
	var assembled []byte
	var announced struct {
		Bytes  int    `json:"bytes"`
		Chunks int    `json:"chunks"`
		SHA256 string `json:"sha256"`
	}
	for index, line := range lines {
		if len(line) > maximumFrameBytes {
			t.Fatalf("frame %d has %d bytes", index, len(line))
		}
		var frame struct {
			ID              int    `json:"id"`
			ProtocolVersion int    `json:"protocolVersion"`
			Encoding        string `json:"encoding"`
			PayloadKind     string `json:"payloadKind"`
			Kind            string `json:"kind"`
			Sequence        int    `json:"sequence"`
			Data            string `json:"data"`
			Bytes           int    `json:"bytes"`
			Chunks          int    `json:"chunks"`
			SHA256          string `json:"sha256"`
		}
		if err := json.Unmarshal(line, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.ID != 7 || frame.ProtocolVersion != protocolVersion {
			t.Fatalf("frame %d has id=%d protocol=%d", index, frame.ID, frame.ProtocolVersion)
		}
		switch index {
		case 0:
			if frame.Kind != "transaction-start" || frame.Encoding != transactionRecordEncoding || frame.PayloadKind != "transaction" {
				t.Fatalf("first frame kind is %q", frame.Kind)
			}
			announced.Bytes, announced.Chunks, announced.SHA256 = frame.Bytes, frame.Chunks, frame.SHA256
		case len(lines) - 1:
			if frame.Kind != "transaction-end" || frame.PayloadKind != "transaction" {
				t.Fatalf("last frame kind is %q", frame.Kind)
			}
			if frame.Bytes != announced.Bytes || frame.Chunks != announced.Chunks || frame.SHA256 != announced.SHA256 {
				t.Fatal("transaction end metadata differs from start")
			}
		default:
			if frame.Kind != "transaction-chunk" || frame.Sequence != index-1 {
				t.Fatalf("chunk %d has kind=%q sequence=%d", index, frame.Kind, frame.Sequence)
			}
			decoded, err := base64.StdEncoding.DecodeString(frame.Data)
			if err != nil {
				t.Fatal(err)
			}
			assembled = append(assembled, decoded...)
		}
	}
	if announced.Chunks != len(lines)-2 || announced.Bytes != len(assembled) {
		t.Fatalf("announced chunks=%d bytes=%d, received chunks=%d bytes=%d", announced.Chunks, announced.Bytes, len(lines)-2, len(assembled))
	}
	digest := sha256.Sum256(assembled)
	if hex.EncodeToString(digest[:]) != announced.SHA256 {
		t.Fatal("assembled digest differs from announced digest")
	}
	const header = `["header",{"protocolVersion":1,"next":{"id":"generation:test","sequence":1,"universe":"project-universe:test","producer":{"id":"producer:test","name":"fixture","version":"1","protocolVersion":1},"sourceManifest":"source-manifest:test","capabilities":["fixture"]}},[0,1,0]]`
	shard, err := json.Marshal([]any{"upsert", transaction.Upserts[0]})
	if err != nil {
		t.Fatal(err)
	}
	expected := append([]byte(header+"\n"), shard...)
	expected = append(expected, '\n')
	if !bytes.Equal(assembled, expected) {
		t.Fatal("assembled records differ from the complete expected header and shard")
	}
}

func TestWriteRecordDeltaResponseRejectsAssembledLimit(t *testing.T) {
	transaction := &factTransaction{ProtocolVersion: protocolVersion, Base: "generation:base", Deletes: []string{strings.Repeat("x", 2048)}}
	var output bytes.Buffer
	err := writeRecordPayloadResponse(&output, 1, "delta", transaction, 1024, 1024, recordLimits{MaximumRecordBytes: 4096, MaximumDecodedShardBytes: 4096, MaximumPhysicalTransactionBytes: 1024}, nil)
	if err == nil || !strings.Contains(err.Error(), "transaction exceeds configured limit") {
		t.Fatalf("expected transaction limit error, received %v", err)
	}
	if output.Len() != 0 {
		t.Fatal("a rejected transaction emitted a visible prefix")
	}
}
