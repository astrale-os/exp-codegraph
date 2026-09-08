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
const nativeStderrTelemetryPrefix = "@astrale/codegraph/telemetry "

type nativeTelemetry struct {
	file    *os.File
	writer  *bufio.Writer
	encoder *json.Encoder
	mu      sync.Mutex
	prefix  string
}

func openNativeTelemetry(fd int, stderr bool) (*nativeTelemetry, error) {
	if stderr {
		if fd >= 0 {
			return nil, fmt.Errorf("native telemetry must select one diagnostic transport")
		}
		writer := bufio.NewWriterSize(os.Stderr, 64*1024)
		return &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer), prefix: nativeStderrTelemetryPrefix}, nil
	}
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
	if t.file != nil {
		_ = t.file.Close()
	}
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
	if t.prefix != "" {
		if _, err := t.writer.WriteString(t.prefix); err != nil {
			return
		}
	}
	if t.encoder.Encode(event) == nil {
		_ = t.writer.Flush()
	}
}
