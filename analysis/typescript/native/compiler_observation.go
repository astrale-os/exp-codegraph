package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"sync"

	shimbundled "github.com/microsoft/typescript-go/shim/bundled"
	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
	shimosvfs "github.com/microsoft/typescript-go/shim/vfs/osvfs"
)

const compilerObservationWorkers = 8
const compilerObservationBufferBytes = 32 * 1024

// This private owner composes exactly the authored, uncached OS filesystem.
// Arbitrary/custom vfs.FS values retain the generic observation path.
type authoredCompilerDisk struct {
	shimvfs.FS
	decoder         shimvfs.FS
	originalFS      shimvfs.FS
	originalDecoder shimvfs.FS
}

func newAuthoredCompilerDisk() *authoredCompilerDisk {
	disk := shimosvfs.FS()
	original := shimbundled.WrapFS(authoredSourceFS{FS: disk})
	return &authoredCompilerDisk{FS: original, decoder: disk, originalFS: original, originalDecoder: disk}
}

type compilerInputObservation struct {
	key    compilerInputKey
	before string
}

// Observations are staged locally. No worker accesses a Program/checker or
// advances the compiler's consumed-input baseline. Every original operation is
// retained, including a separate FileExists after a successful content read.
func (fs *compilerInputFS) observe(inputs []compilerInputObservation) []string {
	result := make([]string, len(inputs))
	disk, owned := fs.disk.(*authoredCompilerDisk)
	if !owned {
		// Keep custom observers sequential. Both projections of Stat still
		// consume one fresh physical cell within this observation attempt.
		actual := &governanceTypeReplayWorld{disk: fs.disk}
		for index, observation := range inputs {
			if observation.key.kind == inputRegularity || observation.key.kind == inputMetadata {
				result[index] = actual.observeActual(observation.key)
			} else {
				result[index] = observeCompilerInput(fs.disk, observation.key)
			}
		}
		return result
	}
	buffer := make([]byte, compilerObservationBufferBytes)
	nonread := make([]int, 0, len(inputs))
	for index, observation := range inputs {
		if observation.key.kind == inputRead {
			result[index] = disk.readObservation(observation.key.path, buffer)
		} else {
			nonread = append(nonread, index)
		}
	}
	// The known OS backend already supports concurrent blocking operations;
	// the bundled backend reads immutable maps. Bound fan-out and await all work
	// before publishing results or releasing this discovery attempt.
	jobs := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < min(compilerObservationWorkers, len(nonread)); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				result[index] = observeCompilerInput(disk, inputs[index].key)
			}
		}()
	}
	for _, index := range nonread {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	return result
}

func observeCompilerInput(fs shimvfs.FS, key compilerInputKey) string {
	switch key.kind {
	case inputRead:
		content, ok := fs.ReadFile(key.path)
		return inputText(content, ok)
	case inputFile:
		return inputBool(fs.FileExists(key.path))
	case inputDirectory:
		return inputBool(fs.DirectoryExists(key.path))
	case inputEnumeration:
		return inputEntries(fs.GetAccessibleEntries(key.path))
	case inputRealpath:
		return fs.Realpath(key.path)
	case inputMetadata:
		return inputStat(fs.Stat(key.path))
	case inputRegularity:
		return inputRegularityValue(fs.Stat(key.path))
	}
	return ""
}

func (disk *authoredCompilerDisk) readObservation(path string, buffer []byte) string {
	if shimbundled.IsBundled(path) || len(buffer) < 2 {
		return observeCompilerInput(disk.FS, compilerInputKey{path: path, kind: inputRead})
	}
	file, err := os.Open(path)
	if err != nil {
		return "absent"
	}
	defer file.Close()
	// A short first read may split the BOM, including special/streamed files.
	// Accumulate only enough to discriminate UTF-16 before emitting any digest.
	length := 0
	ended := false
	for length < 2 {
		count, readErr := file.Read(buffer[length:])
		length += count
		if readErr != nil {
			if readErr != io.EOF {
				return "absent"
			}
			ended = true
			break
		}
	}
	if length >= 2 && (buffer[0] == 0xff && buffer[1] == 0xfe || buffer[0] == 0xfe && buffer[1] == 0xff) {
		// UTF-16 preserves the exact existing fallback decoder, including malformed
		// and odd-length input. Its strings are deliberately not the fast path.
		file.Close()
		// The authored reader delegates straight to this decoder after its first
		// UTF-16 read. Retain that same second operation, without re-entering the
		// authored wrapper and reading the file a third time.
		content, ok := disk.decoder.ReadFile(path)
		return inputText(content, ok)
	}
	digest := sha256.New()
	digest.Write(buffer[:length])
	if !ended {
		for {
			count, readErr := file.Read(buffer)
			if count != 0 {
				digest.Write(buffer[:count])
			}
			if readErr != nil {
				if readErr != io.EOF {
					return "absent"
				}
				break
			}
		}
	}
	return "present:" + hex.EncodeToString(digest.Sum(nil))
}
