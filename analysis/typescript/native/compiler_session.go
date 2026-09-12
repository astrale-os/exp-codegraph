package main

import (
	"context"
	"os"
	"unsafe"

	shimbundled "github.com/microsoft/typescript-go/shim/bundled"
	shimtspath "github.com/microsoft/typescript-go/shim/tspath"
	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
	shimcachedvfs "github.com/microsoft/typescript-go/shim/vfs/cachedvfs"
	shimosvfs "github.com/microsoft/typescript-go/shim/vfs/osvfs"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

// The standard tsgo OS filesystem removes UTF-8 BOMs, whereas overlay edits
// retain them. Analysis must preserve authored source text in both paths so its
// revisions and coordinates agree with JavaScript/TypeScript consumers.
// Keep the normal cached/bundled filesystem layers above this one disk read.
type authoredSourceFS struct{ shimvfs.FS }

func (fs authoredSourceFS) ReadFile(path string) (string, bool) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	if len(content) >= 2 && ((content[0] == 0xff && content[1] == 0xfe) || (content[0] == 0xfe && content[1] == 0xff)) {
		// Preserve the compiler's decoding support for UTF-16 encoded files.
		return fs.FS.ReadFile(path)
	}
	// ReadFile gives us exclusive ownership; neither this buffer nor the returned
	// immutable source text is mutated. Match tsgo's zero-copy OS reader.
	return unsafe.String(unsafe.SliceData(content), len(content)), true
}

// driver.NewSession fixes its own filesystem and ignores LoadProgramOptions.FS.
// Own this small lifecycle through its public primitives so cold loads, graph
// rebuilds and incremental overlays all use the same authored source contract.
type compilerSession struct {
	root    string
	overlay *driver.OverlayFS
	program *driver.Program
	release func()
}

func newCompilerSession(root, config string) (*compilerSession, []driver.Diagnostic, error) {
	fs := shimbundled.WrapFS(shimcachedvfs.From(authoredSourceFS{FS: shimosvfs.FS()}))
	overlay := driver.NewOverlayFS(fs)
	program, diagnostics, err := driver.LoadProgram(root, config, driver.LoadProgramOptions{ForceNoEmit: true, FS: overlay})
	if program == nil || err != nil {
		return nil, diagnostics, err
	}
	return &compilerSession{root: root, overlay: overlay, program: program, release: func() { _ = program.Close() }}, diagnostics, nil
}

func (s *compilerSession) Program() *driver.Program { return s.program }

func (s *compilerSession) SourceText(path string) (string, bool) {
	file := s.program.SourceFile(path)
	if file == nil {
		return "", false
	}
	return file.Text(), true
}

func (s *compilerSession) Apply(path, content string) bool {
	s.overlay.Set(path, content)
	name := path
	if file := s.program.SourceFile(path); file != nil {
		name = file.FileName()
	}
	changed := shimtspath.ToPath(name, s.root, s.overlay.UseCaseSensitiveFileNames())
	host := driver.DefaultHost(s.root, s.program.FS)
	updated, reused := s.program.TSProgram.UpdateProgram(changed, host, nil)
	if updated != nil {
		s.release()
		checker, release := updated.GetTypeChecker(context.Background())
		s.program.TSProgram, s.program.Checker, s.program.Host = updated, checker, host
		s.release = release
	}
	return reused
}

func (s *compilerSession) Close() error {
	if s.release != nil {
		s.release()
		s.release = nil
	}
	return nil
}
