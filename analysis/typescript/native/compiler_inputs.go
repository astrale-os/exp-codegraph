package main

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
)

// Compiler reads are the discovery boundary. Record actual observations above
// caches, including failed resolution probes, and compare them with uncached
// reads. This inventory belongs to one compiler session, not project history.
type compilerInputKind uint8

const (
	inputRead compilerInputKind = iota
	inputFile
	inputDirectory
	inputEnumeration
	inputRealpath
	inputMetadata
)

type compilerInputKey struct {
	path string
	kind compilerInputKind
}
type compilerRawRead struct {
	text    string
	present bool
}

type compilerInputFS struct {
	// A decision capture retains its first observation. Legacy resident compiler
	// sessions can continue replacing observations between explicit generations.
	singleCapture bool
	inconsistent  bool
	metadataLossy bool
	metadataPaths map[string]bool
	shimvfs.FS
	disk       shimvfs.FS
	mu         sync.Mutex
	observed   map[compilerInputKey]string
	operations map[compilerInputKey]*compilerCapturedOperation
	rawReads   map[string]compilerRawRead
}

func newCompilerInputFS(fs, disk shimvfs.FS) *compilerInputFS {
	return &compilerInputFS{FS: fs, disk: disk, observed: map[compilerInputKey]string{}, rawReads: map[string]compilerRawRead{}}
}
func (fs *compilerInputFS) remember(path string, kind compilerInputKind, value string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	// Compiler paths may be virtual URIs (bundled:///libs), not OS paths.
	// Preserve the exact filesystem identity used to obtain the observation.
	key := compilerInputKey{path, kind}
	if before, seen := fs.observed[key]; seen && fs.singleCapture {
		if before != value {
			fs.inconsistent = true
		}
		return
	}
	fs.observed[key] = value
}
func inputText(content string, ok bool) string {
	if !ok {
		return "absent"
	}
	return "present:" + hashText(content)
}
func inputBool(value bool) string {
	if value {
		return "present"
	}
	return "absent"
}
func inputEntries(entries shimvfs.Entries) string {
	files := append([]string{}, entries.Files...)
	dirs := append([]string{}, entries.Directories...)
	sort.Strings(files)
	sort.Strings(dirs)
	return string(stableJSON(map[string]any{"files": files, "directories": dirs}))
}
func (fs *compilerInputFS) ReadFile(path string) (string, bool) {
	value := captureCompilerOperation(fs, compilerInputKey{path, inputRead}, func() compilerRawRead {
		content, present := fs.readFile(path)
		return compilerRawRead{content, present}
	})
	return value.text, value.present
}
func (fs *compilerInputFS) readFile(path string) (string, bool) {
	return fs.readFileFrom(path, fs.FS.ReadFile)
}
func (fs *compilerInputFS) readFileFrom(path string, read func(string) (string, bool)) (string, bool) {
	content, ok := read(path)
	if ok && fs.singleCapture && strings.EqualFold(filepath.Base(path), "package.json") {
		fs.certifyJSON(path, content)
	}
	fs.mu.Lock()
	if fs.rawReads == nil {
		fs.rawReads = map[string]compilerRawRead{}
	}
	value := compilerRawRead{content, ok}
	if before, seen := fs.rawReads[path]; !seen || !fs.singleCapture {
		fs.rawReads[path] = value
	} else if before != value {
		fs.inconsistent = true
	}
	fs.mu.Unlock()
	fs.remember(path, inputRead, inputText(content, ok))
	return content, ok
}
func (fs *compilerInputFS) FileExists(path string) bool {
	return captureCompilerOperation(fs, compilerInputKey{path, inputFile}, func() bool {
		value := fs.FS.FileExists(path)
		fs.remember(path, inputFile, inputBool(value))
		return value
	})
}
func (fs *compilerInputFS) DirectoryExists(path string) bool {
	return captureCompilerOperation(fs, compilerInputKey{path, inputDirectory}, func() bool {
		value := fs.FS.DirectoryExists(path)
		fs.remember(path, inputDirectory, inputBool(value))
		return value
	})
}
func (fs *compilerInputFS) GetAccessibleEntries(path string) shimvfs.Entries {
	value := captureCompilerOperation(fs, compilerInputKey{path, inputEnumeration}, func() shimvfs.Entries {
		value := copyCompilerEntries(fs.FS.GetAccessibleEntries(path))
		fs.remember(path, inputEnumeration, inputEntries(value))
		return value
	})
	return copyCompilerEntries(value)
}
func (fs *compilerInputFS) Realpath(path string) string {
	return captureCompilerOperation(fs, compilerInputKey{path, inputRealpath}, func() string {
		value := fs.FS.Realpath(path)
		fs.remember(path, inputRealpath, value)
		return value
	})
}
func (fs *compilerInputFS) Stat(path string) shimvfs.FileInfo {
	return captureCompilerOperation(fs, compilerInputKey{path, inputMetadata}, func() shimvfs.FileInfo {
		value := fs.FS.Stat(path)
		fs.remember(path, inputMetadata, inputStat(value))
		return value
	})
}
func inputStat(value shimvfs.FileInfo) string {
	if value == nil {
		return "absent"
	}
	// Preserve all compiler-visible membership, size and timestamp metadata.
	// Content reads additionally compare bytes, including same-stat edits.
	return fmt.Sprintf("%s:%d:%d", value.Mode(), value.Size(), value.ModTime().UnixNano())
}
func (fs *compilerInputFS) WalkDir(root string, fn shimvfs.WalkDirFunc) error {
	fs.DirectoryExists(root)
	return fs.FS.WalkDir(root, func(path string, entry shimvfs.DirEntry, err error) error {
		if err != nil {
			fs.Stat(path)
		}
		if entry != nil && entry.IsDir() {
			fs.GetAccessibleEntries(path)
		}
		return fn(path, entry, err)
	})
}
func (fs *compilerInputFS) applied(path, content string) {
	fs.remember(path, inputRead, inputText(content, true))
}

func (s *compilerSession) discover() (paths []string, rebuild bool) {
	s.inputs.mu.Lock()
	observed := make([]compilerInputObservation, 0, len(s.inputs.observed))
	for key, value := range s.inputs.observed {
		observed = append(observed, compilerInputObservation{key: key, before: value})
	}
	s.inputs.mu.Unlock()
	after := s.inputs.observe(observed)
	changed := map[string]bool{}
	for index, observation := range observed {
		key, before := observation.key, observation.before
		if after[index] == before {
			continue
		}
		relative, err := filepath.Rel(s.root, key.path)
		if key.kind != inputRead || s.program.SourceFile(key.path) == nil || err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			rebuild = true
		} else {
			changed[filepath.ToSlash(relative)] = true
		}
	}
	for path := range changed {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, rebuild
}
