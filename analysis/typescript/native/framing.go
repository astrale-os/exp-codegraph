package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
)

const transactionFrameEncoding = "base64-json"

type transactionStartFrame struct {
	ID              int    `json:"id"`
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	Encoding        string `json:"encoding"`
	Bytes           int    `json:"bytes"`
	Chunks          int    `json:"chunks"`
	SHA256          string `json:"sha256"`
}

type transactionChunkFrame struct {
	ID              int    `json:"id"`
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	Sequence        int    `json:"sequence"`
	Data            string `json:"data"`
}

type transactionEndFrame struct {
	ID              int    `json:"id"`
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	Bytes           int    `json:"bytes"`
	Chunks          int    `json:"chunks"`
	SHA256          string `json:"sha256"`
}

func writeTransactionResponse(
	output io.Writer,
	id int,
	transaction *factTransaction,
	maximumFrameBytes int,
	transactionChunkFrameBytes int,
	maximumTransactionBytes int,
) error {
	serialized, err := json.Marshal(transaction)
	if err != nil {
		return fmt.Errorf("encode native transaction: %w", err)
	}
	if len(serialized) > maximumTransactionBytes {
		return fmt.Errorf(
			"native transaction exceeds configured limit: bytes=%d limit=%d",
			len(serialized),
			maximumTransactionBytes,
		)
	}
	direct := response{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction", Transaction: transaction,
	}
	encodedDirect, err := json.Marshal(direct)
	if err != nil {
		return fmt.Errorf("encode native transaction response: %w", err)
	}
	if len(encodedDirect) <= maximumFrameBytes {
		return writeEncodedFrame(output, encodedDirect, maximumFrameBytes)
	}

	chunkBytes, err := maximumRawChunkBytes(id, len(serialized), transactionChunkFrameBytes)
	if err != nil {
		return err
	}
	chunks := (len(serialized) + chunkBytes - 1) / chunkBytes
	digestBytes := sha256.Sum256(serialized)
	digest := hex.EncodeToString(digestBytes[:])
	start := transactionStartFrame{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-start",
		Encoding: transactionFrameEncoding, Bytes: len(serialized), Chunks: chunks, SHA256: digest,
	}
	if err := writeFrame(output, start, transactionChunkFrameBytes); err != nil {
		return err
	}
	for sequence, offset := 0, 0; offset < len(serialized); sequence, offset = sequence+1, offset+chunkBytes {
		end := offset + chunkBytes
		if end > len(serialized) {
			end = len(serialized)
		}
		frame := transactionChunkFrame{
			ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-chunk",
			Sequence: sequence, Data: base64.StdEncoding.EncodeToString(serialized[offset:end]),
		}
		if err := writeFrame(output, frame, transactionChunkFrameBytes); err != nil {
			return err
		}
	}
	return writeFrame(output, transactionEndFrame{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-end",
		Bytes: len(serialized), Chunks: chunks, SHA256: digest,
	}, transactionChunkFrameBytes)
}

func writeFrame(output io.Writer, frame any, maximumFrameBytes int) error {
	encoded, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("encode native protocol frame: %w", err)
	}
	return writeEncodedFrame(output, encoded, maximumFrameBytes)
}

func writeEncodedFrame(output io.Writer, encoded []byte, maximumFrameBytes int) error {
	if len(encoded) > maximumFrameBytes {
		return fmt.Errorf(
			"native protocol frame exceeds configured limit: bytes=%d limit=%d",
			len(encoded),
			maximumFrameBytes,
		)
	}
	if _, err := output.Write(encoded); err != nil {
		return fmt.Errorf("write native protocol frame: %w", err)
	}
	if _, err := output.Write([]byte{'\n'}); err != nil {
		return fmt.Errorf("terminate native protocol frame: %w", err)
	}
	return nil
}

func maximumRawChunkBytes(id, transactionBytes, maximumFrameBytes int) (int, error) {
	probe := transactionChunkFrame{
		ID: id, ProtocolVersion: protocolVersion, Kind: "transaction-chunk",
		Sequence: transactionBytes, Data: "",
	}
	encoded, err := json.Marshal(probe)
	if err != nil {
		return 0, fmt.Errorf("size native transaction chunk: %w", err)
	}
	available := maximumFrameBytes - len(encoded)
	if available < base64.StdEncoding.EncodedLen(1) {
		return 0, fmt.Errorf("configured frame limit cannot hold one transaction byte")
	}
	maximum := available / 4 * 3
	for maximum > 0 && base64.StdEncoding.EncodedLen(maximum) > available {
		maximum--
	}
	if maximum < 1 {
		return 0, fmt.Errorf("configured frame limit cannot hold one transaction byte")
	}
	return maximum, nil
}
