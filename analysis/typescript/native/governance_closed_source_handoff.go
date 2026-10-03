package main

import (
  "fmt"
  "encoding/base64"
  "encoding/json"
  "path/filepath"
  "astrale-typespec-v2-native-analysis/jsstring"
)

// This is an experimental private suspension, never a partially admitted report.
// It precedes ProductsDigest. The existing lane transfers the same owner back.
func (session *governanceSession) closedSourceHandoff() (any, error) {
  state := session.productsSession
  if state == nil || state.Project == nil || state.ProductsDigest != "" {
    return nil, fmt.Errorf("closed source handoff lacks an admitting owner")
  }
  project := state.Project
  if project.capture.probeInconsistent {
    session.discardProducts()
    return map[string]any{"status":"partial", "residual":[]string{"Captured generic I/O observations changed or exceeded authority bounds."}}, nil
  }
  rows := []map[string]any{}
  for _, file := range project.Files {
    rows = append(rows, map[string]any{"path": file.Path, "absolutePath": file.AbsolutePath, "text": jsstring.JSONText(file.Text)})
  }
  metadata := map[string]*string{}
  for _, name := range []string{"package.json", "tsconfig.json", "pnpm-workspace.yaml"} {
    path := filepath.Join(project.Root, name)
    cell, captured := project.capture.byteCells[path]
    if !captured {
      if project.capture.observations["read\000"+path].Value != "absent" { return nil, fmt.Errorf("closed source root metadata was not captured: %s", name) }
      metadata[name] = nil
      continue
    }
    if cell.err != nil { return nil, cell.err }
    if cell.bytes == nil { metadata[name] = nil } else {
      text := base64.StdEncoding.EncodeToString(cell.bytes)
      metadata[name] = &text
    }
  }
  frame := map[string]any{
    "status": "source", "token": state.Token, "generation": state.Generation,
    "sourceSnapshotDigest": project.GovernanceDigest, "root": project.Root,
    "rootEntries": append([]string{}, project.RootEntries...), "files": rows,
    "compilerValid": project.compilerValid, "verbatimModuleSyntax": project.verbatim,
    "rootMetadata": metadata,
  }
  bytes, err := json.Marshal(frame)
  if err != nil { return nil, err }
  if len(bytes) > 32*1024*1024 {
    return map[string]any{"status": "partial", "residual": []string{"Captured source frame exceeds original private payload admission bound."}}, nil
  }
  return frame, nil
}
