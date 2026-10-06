package main

import (
	"sync"

	vfs "github.com/microsoft/typescript-go/shim/vfs"
)

// One actual compiler filesystem owner and operation/path owns one first value
// within a decision capture. Parallel parser/resolver requests join its producer;
// no global lock spans I/O. Expected replay obligations never populate these
// actual cells. The original disk methods at the final barrier remain uncached.
// Legacy resident compiler generations retain their replacing read behavior.
type compilerCapturedOperation struct {
	once        sync.Once
	value       any
	observation string
	observed    bool
}

type compilerCapturedValue[T any] struct{ value T }

// The one key index owns both completed physical values and consumed semantic
// projections. A semantic-only Stat replay or retained expectation may have no
// physical value; completing an operation never fabricates its consumption.
func (fs *compilerInputFS) operationLocked(key compilerInputKey) *compilerCapturedOperation {
	if fs.operations == nil {
		fs.operations = map[compilerInputKey]*compilerCapturedOperation{}
	}
	cell := fs.operations[key]
	if cell == nil {
		cell = &compilerCapturedOperation{}
		fs.operations[key] = cell
	}
	return cell
}

func (fs *compilerInputFS) rawReadLocked(path string) (compilerRawRead, bool) {
	cell := fs.operations[compilerInputKey{path, inputRead}]
	if cell == nil || cell.value == nil {
		return compilerRawRead{}, false
	}
	return cell.value.(compilerCapturedValue[compilerRawRead]).value, true
}

func (fs *compilerInputFS) semanticObservationsLocked() []compilerInputObservation {
	if fs.singleCapture {
		// Every first semantic value is already appended once under the same mutex.
		return append(make([]compilerInputObservation, 0, len(fs.prefix.observations)), fs.prefix.observations...)
	}
	rows := make([]compilerInputObservation, 0, len(fs.operations))
	for key, cell := range fs.operations {
		if cell.observed {
			rows = append(rows, compilerInputObservation{key, cell.observation})
		}
	}
	return rows
}

func publishCompilerOperation[T any](fs *compilerInputFS, key compilerInputKey, cell *compilerCapturedOperation, value T) {
	var raw compilerRawRead
	var fingerprint string
	if key.kind == inputRead {
		raw = any(value).(compilerRawRead)
		fingerprint = inputText(raw.text, raw.present)
	}
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if cell.value == nil || !fs.singleCapture {
		cell.value = compilerCapturedValue[T]{value}
		if fs.singleCapture && key.kind == inputRead {
			fs.prefix.reads = append(fs.prefix.reads, compilerRawInput{key.path, raw})
		}
	} else if key.kind == inputRead && cell.value.(compilerCapturedValue[compilerRawRead]).value != raw {
		fs.inconsistent = true
	}
	if key.kind == inputRead {
		// Every live receipt/export consumer follows joined compiler work. Publish
		// one completed read in original raw-before-observed logical order under
		// the same mutex; no joining return can add another first-value row.
		fs.rememberLocked(key, cell, fingerprint)
	}
}

func captureCompilerOperation[T any](fs *compilerInputFS, key compilerInputKey, read func() T) T {
	// Replacing generations retain semantic projections and raw reads only.
	// Other physical values live only for the duration of their original call.
	if !fs.singleCapture && key.kind != inputRead {
		return read()
	}
	fs.mu.Lock()
	cell := fs.operationLocked(key)
	fs.mu.Unlock()
	if !fs.singleCapture {
		value := read()
		publishCompilerOperation(fs, key, cell, value)
		return value
	}
	cell.once.Do(func() {
		publishCompilerOperation(fs, key, cell, read())
	})
	return cell.value.(compilerCapturedValue[T]).value
}

// Enumeration callers cannot mutate another consumer's retained membership.
// Preserve nil slices and the original enumeration order.
func copyCompilerEntries(value vfs.Entries) vfs.Entries {
	if value.Files != nil {
		value.Files = append([]string{}, value.Files...)
	}
	if value.Directories != nil {
		value.Directories = append([]string{}, value.Directories...)
	}
	return value
}
