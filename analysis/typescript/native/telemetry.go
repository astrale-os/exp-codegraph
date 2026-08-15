package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

const nativeTelemetryFormat = "astrale.codegraph.analysis-telemetry"

type nativeTelemetry struct {
	file    *os.File
	writer  *bufio.Writer
	encoder *json.Encoder
	mu      sync.Mutex
}

func openNativeTelemetry(fd int) (*nativeTelemetry, error) {
	if fd < 0 {
		return nil, nil
	}
	if fd < 3 {
		return nil, fmt.Errorf("native telemetry descriptor must be at least 3")
	}
	file := os.NewFile(uintptr(fd), "codegraph-telemetry")
	if file == nil {
		return nil, fmt.Errorf("native telemetry descriptor %d is unavailable", fd)
	}
	writer := bufio.NewWriterSize(file, 64*1024)
	return &nativeTelemetry{file: file, writer: writer, encoder: json.NewEncoder(writer)}, nil
}

func (t *nativeTelemetry) close() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	_ = t.writer.Flush()
	_ = t.file.Close()
}

func (t *nativeTelemetry) record(request int, phase string, started time.Time, metrics map[string]any) {
	if t == nil {
		return
	}
	event := map[string]any{
		"format":     nativeTelemetryFormat,
		"version":    1,
		"component":  "native",
		"phase":      phase,
		"durationNs": time.Since(started).Nanoseconds(),
	}
	if request > 0 {
		event["request"] = request
	}
	if len(metrics) != 0 {
		event["metrics"] = metrics
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.encoder.Encode(event) == nil {
		_ = t.writer.Flush()
	}
}
