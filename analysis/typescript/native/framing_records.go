package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

const transactionRecordEncoding = "base64-json-records/1"

// A record stream retains at most one serialized shard plus one wire chunk.
// The sizing/digest pass never constructs a transaction-sized JSON buffer.
// Generation publication still happens only after the consumer admits every
// shard and verifies the entire stream, then acknowledges its atomic commit.
func writeRecordPayloadResponse(
	output io.Writer, id int, payloadKind string, transaction *factTransaction,
	maximumFrameBytes, transactionChunkFrameBytes, maximumTransactionBytes int,
	telemetry *nativeTelemetry,
) error {
	started := time.Now()
	manifest := transaction.Manifest
	if payloadKind == "delta" {
		manifest = nil
	} else if payloadKind != "transaction" {
		return fmt.Errorf("unknown transaction record payload kind %q", payloadKind)
	}
	header := struct {
		ProtocolVersion int                `json:"protocolVersion"`
		Base            string             `json:"base,omitempty"`
		Next            analysisGeneration `json:"next"`
	}{transaction.ProtocolVersion, transaction.Base, transaction.Next}
	visit := func(write func([]byte) error) error {
		record := func(value any) error {
			encoded, err := json.Marshal(value)
			if err != nil {
				return fmt.Errorf("encode native transaction record: %w", err)
			}
			encoded = append(encoded, '\n')
			return write(encoded)
		}
		if err := record([]any{"header", header, []int{len(manifest), len(transaction.Upserts), len(transaction.Deletes)}}); err != nil {
			return err
		}
		for _, reference := range manifest {
			if err := record([]any{"manifest", reference}); err != nil {
				return err
			}
		}
		for index := range transaction.Upserts {
			if err := record([]any{"upsert", &transaction.Upserts[index]}); err != nil {
				return err
			}
		}
		for _, deletion := range transaction.Deletes {
			if err := record([]any{"delete", deletion}); err != nil {
				return err
			}
		}
		return nil
	}
	digest := sha256.New()
	bytes := 0
	if err := visit(func(record []byte) error {
		if len(record) > maximumTransactionBytes-bytes {
			return fmt.Errorf("native transaction exceeds configured limit: bytes=%d limit=%d", bytes+len(record), maximumTransactionBytes)
		}
		bytes += len(record)
		_, err := digest.Write(record)
		return err
	}); err != nil {
		return err
	}
	frameLimit := min(maximumFrameBytes, transactionChunkFrameBytes)
	chunkBytes, err := maximumRawChunkBytes(id, bytes, frameLimit)
	if err != nil {
		return err
	}
	chunks := (bytes + chunkBytes - 1) / chunkBytes
	sha := hex.EncodeToString(digest.Sum(nil))
	counted := &countingWriter{target: output}
	if err := writeFrame(counted, transactionStartFrame{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-start",
		PayloadKind: payloadKind, Encoding: transactionRecordEncoding,
		Bytes: bytes, Chunks: chunks, SHA256: sha,
	}, frameLimit); err != nil {
		return err
	}
	buffer := make([]byte, 0, min(bytes, chunkBytes))
	sequence := 0
	flush := func() error {
		if len(buffer) == 0 {
			return nil
		}
		err := writeFrame(counted, transactionChunkFrame{
			ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-chunk",
			Sequence: sequence, Data: base64.StdEncoding.EncodeToString(buffer),
		}, frameLimit)
		sequence++
		buffer = buffer[:0]
		return err
	}
	if err := visit(func(record []byte) error {
		for len(record) != 0 {
			count := min(chunkBytes-len(buffer), len(record))
			buffer = append(buffer, record[:count]...)
			record = record[count:]
			if len(buffer) == chunkBytes {
				if err := flush(); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	if sequence != chunks {
		return fmt.Errorf("native transaction record stream size changed during encoding")
	}
	err = writeFrame(counted, transactionEndFrame{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-end",
		PayloadKind: payloadKind, Bytes: bytes, Chunks: chunks, SHA256: sha,
	}, frameLimit)
	telemetry.record(id, "transport.serialize-and-write", started, map[string]any{
		"transactionBytes": bytes, "wireBytes": counted.bytes, "chunks": chunks,
		"chunked": true, "records": 1 + len(manifest) + len(transaction.Upserts) + len(transaction.Deletes),
	})
	return err
}
