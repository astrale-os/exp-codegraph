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
	once  sync.Once
	value any
}

type compilerCapturedValue[T any] struct{ value T }

func captureCompilerOperation[T any](fs *compilerInputFS, key compilerInputKey, read func() T) T {
	if !fs.singleCapture {
		return read()
	}
	fs.mu.Lock()
	if fs.operations == nil {
		fs.operations = map[compilerInputKey]*compilerCapturedOperation{}
	}
	cell := fs.operations[key]
	if cell == nil {
		cell = &compilerCapturedOperation{}
		fs.operations[key] = cell
	}
	fs.mu.Unlock()
	cell.once.Do(func() {
		value := read()
		fs.mu.Lock()
		cell.value = compilerCapturedValue[T]{value}
		fs.mu.Unlock()
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
