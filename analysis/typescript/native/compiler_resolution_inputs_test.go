package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCompilerResolutionProjectionKeepsActualBytesAndNegativeCells(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "tsconfig.json")
	// The original byte owner preserves lone UTF16 units which Go's decoder loses.
	raw := []byte{0xff, 0xfe, 0x22, 0, 0, 0xd8, 0x22, 0}
	if err := os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}
	plain := filepath.Join(root, "package.json")
	if err := os.WriteFile(plain, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	capture := &governanceCapture{root: root, observations: map[string]governanceObservation{}, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
	if _, err := capture.read(config); err != nil {
		t.Fatal(err)
	}
	fs := capture.compiler
	fs.ReadFile(config)
	fs.ReadFile(plain) // No ORIGINAL byte cell: do not export its decoded text.
	body := filepath.Join(root, "a.ts")
	if err := os.WriteFile(body, []byte("export const a = 1"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := capture.read(body); err != nil {
		t.Fatal(err)
	}
	fs.ReadFile(body)
	fs.FileExists(config)
	fs.Stat(config)
	missing := filepath.Join(root, "absent.json")
	fs.FileExists(missing)
	fs.ReadFile(missing)
	fs.DirectoryExists(root)
	fs.GetAccessibleEntries(root)
	fs.Realpath(config)
	before, ok := capture.resolutionInputs([]string{config})
	if !ok {
		t.Fatal("owned projection unavailable")
	}
	rows := map[string]compilerResolutionInput{}
	for _, row := range before.Rows {
		rows[row.Operation+":"+row.Path] = row
	}
	read := rows["read:"+config]
	if read.Base64 == nil || *read.Base64 != base64.StdEncoding.EncodeToString(raw) {
		t.Fatalf("original bytes lost: %#v", read)
	}
	if rows["read:"+plain].Unavailable == "" {
		t.Fatal("unretained raw bytes became known")
	}
	bodyRow := rows["read:"+body]
	if bodyRow.Base64 != nil || bodyRow.Unavailable == "" {
		t.Fatal("authored body bulk-transferred as metadata")
	}
	absent := rows["file:"+missing]
	if absent.Boolean == nil || *absent.Boolean {
		t.Fatal("actual negative lost")
	}
	if err := os.WriteFile(config, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	after, ok := capture.resolutionInputs([]string{config})
	if !ok || !reflect.DeepEqual(before, after) {
		t.Fatal("snapshot reread disk or changed first cells")
	}
	fs.mu.Lock()
	observation := compilerInputObservation{key: compilerInputKey{config, inputRead}, before: fs.observed[compilerInputKey{config, inputRead}]}
	fs.mu.Unlock()
	if fs.observe([]compilerInputObservation{observation})[0] == observation.before {
		t.Fatal("fresh original guard missed the edit")
	}
}

func TestCompilerResolutionProjectionDoesNotInventRegularMembership(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "a.ts")
	if err := os.WriteFile(path, []byte("export {}"), 0600); err != nil {
		t.Fatal(err)
	}
	capture := &governanceCapture{root: root, compiler: governanceNewCompilerInputFS(newAuthoredCompilerDisk())}
	capture.compiler.FileExists(path)
	before, ok := capture.resolutionInputs(nil)
	if !ok || len(before.Rows) != 1 || before.Rows[0].Unavailable == "" {
		t.Fatal("positive non-directory silently became regular")
	}
	capture.compiler.Stat(path)
	after, ok := capture.resolutionInputs(nil)
	if !ok || len(after.Rows) != 1 || after.Rows[0].Boolean == nil || !*after.Rows[0].Boolean {
		t.Fatal("actual regular membership not admitted")
	}
	// Unfinished producers are never joined by doing an unselected first read.
	capture.compiler.mu.Lock()
	capture.compiler.operations[compilerInputKey{filepath.Join(root, "unopened.json"), inputRead}] = &compilerCapturedOperation{}
	capture.compiler.mu.Unlock()
	unfinished, ok := capture.resolutionInputs(nil)
	if !ok || !reflect.DeepEqual(after, unfinished) {
		t.Fatal("unfinished producer escaped")
	}
}
