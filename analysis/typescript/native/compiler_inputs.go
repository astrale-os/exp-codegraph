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
type compilerInputFS struct {
	shimvfs.FS
	disk     shimvfs.FS
	mu       sync.Mutex
	observed map[compilerInputKey]string
}

func newCompilerInputFS(fs, disk shimvfs.FS) *compilerInputFS {
	return &compilerInputFS{FS: fs, disk: disk, observed: map[compilerInputKey]string{}}
}
func (fs *compilerInputFS) remember(path string, kind compilerInputKind, value string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.observed[compilerInputKey{filepath.Clean(path), kind}] = value
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
	content, ok := fs.FS.ReadFile(path)
	fs.remember(path, inputRead, inputText(content, ok))
	return content, ok
}
func (fs *compilerInputFS) FileExists(path string) bool {
	value := fs.FS.FileExists(path)
	fs.remember(path, inputFile, inputBool(value))
	return value
}
func (fs *compilerInputFS) DirectoryExists(path string) bool {
	value := fs.FS.DirectoryExists(path)
	fs.remember(path, inputDirectory, inputBool(value))
	return value
}
func (fs *compilerInputFS) GetAccessibleEntries(path string) shimvfs.Entries {
	value := fs.FS.GetAccessibleEntries(path)
	fs.remember(path, inputEnumeration, inputEntries(value))
	return value
}
func (fs *compilerInputFS) Realpath(path string) string {
	value := fs.FS.Realpath(path)
	fs.remember(path, inputRealpath, value)
	return value
}
func (fs *compilerInputFS) Stat(path string) shimvfs.FileInfo {
	value := fs.FS.Stat(path)
	fs.remember(path, inputMetadata, inputStat(value))
	return value
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
	observed := make(map[compilerInputKey]string, len(s.inputs.observed))
	for key, value := range s.inputs.observed {
		observed[key] = value
	}
	s.inputs.mu.Unlock()
	changed := map[string]bool{}
	for key, before := range observed {
		var after string
		switch key.kind {
		case inputRead:
			content, ok := s.inputs.disk.ReadFile(key.path)
			after = inputText(content, ok)
		case inputFile:
			after = inputBool(s.inputs.disk.FileExists(key.path))
		case inputDirectory:
			after = inputBool(s.inputs.disk.DirectoryExists(key.path))
		case inputEnumeration:
			after = inputEntries(s.inputs.disk.GetAccessibleEntries(key.path))
		case inputRealpath:
			after = s.inputs.disk.Realpath(key.path)
		case inputMetadata:
			after = inputStat(s.inputs.disk.Stat(key.path))
		}
		if after == before {
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
