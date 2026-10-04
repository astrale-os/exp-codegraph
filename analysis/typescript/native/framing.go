package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
)

type transactionStartFrame struct {
	ID              int    `json:"id"`
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	PayloadKind     string `json:"payloadKind"`
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
	PayloadKind     string `json:"payloadKind"`
	Bytes           int    `json:"bytes"`
	Chunks          int    `json:"chunks"`
	SHA256          string `json:"sha256"`
}

type countingWriter struct {
	target io.Writer
	bytes  int
}

func (w *countingWriter) Write(value []byte) (int, error) {
	written, err := w.target.Write(value)
	w.bytes += written
	return written, err
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
