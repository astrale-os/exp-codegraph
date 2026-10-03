package main

import (
	"path/filepath"
	"strings"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

// Configuration/package strings affect keys, paths and resolution even when no
// resulting symbol contains U+FFFD. Recover code units with the existing pinned
// parser/jsstring authority; do not infer fidelity from output values or a name.
func governanceJSONLiteralFidelity(path, text string) bool {
	source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: path}, text, core.ScriptKindJSON)
	return governanceTypeLiteralFidelity(source)
}

// The original config host reads only JSON: root/extended configuration and
// resolver package metadata. This view forwards every original operation to the
// SAME input owner, including failed reads and exact operands; it adds no IO.
type governanceJSONInputs struct{ *compilerInputFS }

func (fs governanceJSONInputs) ReadFile(path string) (string, bool) {
	text, present := fs.compilerInputFS.ReadFile(path)
	if present && !strings.EqualFold(filepath.Base(path), "package.json") {
		fs.certifyJSON(path, text)
	}
	return text, present
}
func (fs *compilerInputFS) certifyJSON(path, text string) {
	if !fs.singleCapture {
		return
	}
	faithful := governanceJSONLiteralFidelity(path, text)
	fs.mu.Lock()
	if fs.metadataPaths == nil {
		fs.metadataPaths = map[string]bool{}
	}
	fs.metadataPaths[path] = true
	fs.metadataLossy = fs.metadataLossy || !faithful
	fs.mu.Unlock()
}
func (capture *governanceCapture) compilerInputs() *compilerInputFS {
	if capture.compiler == nil {
		capture.compiler = governanceNewCompilerInputFS(newAuthoredCompilerDisk())
		// These bytes were actually captured already; this certifies them without
		// inserting expected content into any actual compiler read/observation cell.
		for _, name := range []string{"package.json", "tsconfig.json"} {
			path := filepath.Join(capture.root, name)
			if value, present := capture.byteCells[path]; present && value.err == nil {
				capture.compiler.certifyJSON(path, string(value.bytes))
			}
		}
	}
	return capture.compiler
}
func (capture *governanceCapture) metadataFidelity() bool {
	fs := capture.compilerInputs()
	fs.mu.Lock()
	defer fs.mu.Unlock()
	return !fs.metadataLossy
}
