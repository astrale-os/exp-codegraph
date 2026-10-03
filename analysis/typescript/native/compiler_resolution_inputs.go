package main

import (
 "encoding/base64"
 "sort"
 "unicode/utf8"

 vfs "github.com/microsoft/typescript-go/shim/vfs"
)

// Experimental projection, not a registered protocol or a publication receipt.
// The caller must retain this capture and use its original fresh seal. Export
// completed actual cells only; omission means unavailable, never absent.
type compilerResolutionInputs struct {
 Root string `json:"root"`
 UseCaseSensitiveFileNames bool `json:"useCaseSensitiveFileNames"`
 Rows []compilerResolutionInput `json:"rows"`
}
type compilerResolutionInput struct {
 Path string `json:"path"`
 Operation string `json:"operation"`
 Fingerprint string `json:"fingerprint"`
 Boolean *bool `json:"boolean,omitempty"`
 Base64 *string `json:"base64,omitempty"`
 Directories []string `json:"directories"`
 Realpath string `json:"realpath,omitempty"`
 Unavailable string `json:"unavailable,omitempty"`
}

func (capture *governanceCapture) resolutionInputs() (compilerResolutionInputs, bool) {
 fs := capture.compiler
 if fs == nil || !fs.singleCapture || capture.probeInconsistent { return compilerResolutionInputs{}, false }
 if _, owned := fs.disk.(*authoredCompilerDisk); !owned { return compilerResolutionInputs{}, false }
 result := compilerResolutionInputs{Root: capture.root, UseCaseSensitiveFileNames: fs.UseCaseSensitiveFileNames(), Rows: []compilerResolutionInput{}}
 fs.mu.Lock()
 defer fs.mu.Unlock()
 if fs.inconsistent { return compilerResolutionInputs{}, false }
 for key, cell := range fs.operations {
  if cell.value == nil { continue } // Concurrent/unfinished producer has no exportable value.
  if !utf8.ValidString(key.path) { return compilerResolutionInputs{}, false }
  row := compilerResolutionInput{Path: key.path, Fingerprint: fs.observed[key]}
  switch key.kind {
  case inputRead:
   row.Operation = "read"
   value := cell.value.(compilerCapturedValue[compilerRawRead]).value
   if !value.present { absent := false; row.Boolean = &absent; break }
   // Native UTF-16 decoding can lose lone units. Only already retained ORIGINAL
   // byte cells can supply TS6's reader, including its BOM/invalid UTF8 behavior.
   raw, exists := capture.byteCells[key.path]
   if !exists || raw.err != nil { row.Unavailable = "Original byte observation is not retained."; break }
   encoded := base64.StdEncoding.EncodeToString(raw.bytes)
   row.Base64 = &encoded
  case inputFile:
   row.Operation = "file"
   value := cell.value.(compilerCapturedValue[bool]).value
   if value {
    // Go FileExists admits every non-directory; TS6 admits regular files only.
    // Do not assume a special file is regular without an actual metadata cell.
    metadata := fs.operations[compilerInputKey{key.path, inputMetadata}]
    if metadata == nil || metadata.value == nil { row.Unavailable = "Regular-file membership is not covered."; break }
    info := metadata.value.(compilerCapturedValue[vfs.FileInfo]).value
    if info == nil { row.Unavailable = "Conflicting file membership observations."; break }
    value = info.Mode().IsRegular()
   }
   row.Boolean = &value
  case inputDirectory:
   row.Operation = "directory"
   value := cell.value.(compilerCapturedValue[bool]).value
   row.Boolean = &value
  case inputEnumeration:
   row.Operation = "entries"
   row.Directories = append([]string{}, cell.value.(compilerCapturedValue[vfs.Entries]).value.Directories...)
  case inputRealpath:
   row.Operation = "realpath"
   row.Realpath = cell.value.(compilerCapturedValue[string]).value
   if !utf8.ValidString(row.Realpath) { return compilerResolutionInputs{}, false }
  default:
   continue
  }
  result.Rows = append(result.Rows, row)
 }
 sort.Slice(result.Rows, func(i, j int) bool {
  if result.Rows[i].Operation != result.Rows[j].Operation { return result.Rows[i].Operation < result.Rows[j].Operation }
  return result.Rows[i].Path < result.Rows[j].Path
 })
 return result, true
}
