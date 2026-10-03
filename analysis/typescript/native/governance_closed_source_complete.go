package main

import (
  "encoding/json"
  "fmt"
  "astrale-typespec-v2-native-analysis/jsstring"
  scanner "github.com/microsoft/typescript-go/shim/scanner"
)

// Admission is atomic: failed, pending or foreign rows never enter ready cells.
func (session *governanceSession) completeClosedSource(raw json.RawMessage) (any, error) {
  var input struct {
    Token, Generation, SourceSnapshotDigest string
    Decisions []struct {
      ID string
      Decision struct {
        Status string
        Findings []struct {
          Kind string
          EvidenceUnits []uint16
          Location *decisionLocation
          AmbiguityReason string
        }
      }
    }
  }
  if err := json.Unmarshal(raw, &input); err != nil { return nil, err }
  state := session.productsSession
  if state == nil || session.policyLane != nil || state.Project == nil ||
    state.Token != input.Token || state.Generation != input.Generation || state.Project.GovernanceDigest != input.SourceSnapshotDigest ||
    state.ProductsDigest != "" || state.SourceProducts != nil {
    return nil, fmt.Errorf("closed source completion does not own the admitting phase")
  }
  contracts := []governanceImplementationContract{}
  for _, contract := range state.Contracts {
    if contract.Implementation.ID == "astrale.sdk.typescript-source" {
      if _, disabled := state.Project.Disabled[contract.RuleID]; !disabled { contracts = append(contracts, contract) }
    }
  }
  if len(input.Decisions) != len(contracts) { return nil, fmt.Errorf("closed source coverage differs") }
  products := []governanceRuleProduct{}
  for i, row := range input.Decisions {
    contract := contracts[i]
    if row.ID != contract.RuleID || contract.RuleRevision != governanceRevisions[row.ID] ||
      contract.Implementation.Version != "1" { return nil, fmt.Errorf("closed source rule contract differs") }
    decision := governanceRuleDecision{Status: row.Decision.Status}
    if decision.Status != "pass" && decision.Status != "fail" && decision.Status != "indeterminate" {
      return nil, fmt.Errorf("closed source verifier status differs")
    }
    failed := false
    for _, finding := range row.Decision.Findings {
      if finding.Kind != "fail" && finding.Kind != "indeterminate" { return nil, fmt.Errorf("closed source evidence kind differs") }
      failed = failed || finding.Kind == "fail"
      text := jsstring.FromUnits(finding.EvidenceUnits)
      if location := finding.Location; location != nil {
        file := state.Project.FilesByPath[location.Path]
        if file == nil { return nil, fmt.Errorf("closed source evidence is foreign") }
        length := file.coordinates.utf16(len(file.Text))
        if location.Offset < 0 || location.Offset > length || location.Length < 1 ||
          location.Length > length-location.Offset {
          return nil, fmt.Errorf("closed source evidence is foreign or outside source")
        }
        starts := scanner.GetECMALineStarts(file.Source)
        line := 0
        for line+1 < len(starts) && file.coordinates.utf16(int(starts[line+1])) <= location.Offset { line++ }
        if location.Line != line+1 || location.Column != location.Offset-file.coordinates.utf16(int(starts[line]))+1 {
          return nil, fmt.Errorf("closed source evidence coordinates differ")
        }
      }
      decision.Findings = append(decision.Findings, governanceRuleFinding{finding.Kind, jsstring.JSONText(text.WTF8()), finding.Location, finding.AmbiguityReason})
    }
    if (len(decision.Findings) == 0) != (decision.Status == "pass") || (decision.Status == "fail") != failed {
      return nil, fmt.Errorf("closed source decision disagrees with findings")
    }
    products = append(products, governanceRuleProduct{contract.RuleID, contract.RuleRevision, contract.Implementation, decision})
  }
  state.SourceProducts = products
  return session.evaluateProducts()
}

func governanceOwnedSourceProducts(source []governanceRuleProduct) []governanceRuleProduct {
  if source == nil { return nil }
  out := append([]governanceRuleProduct{}, source...)
  for i := range out {
    out[i].Decision.Findings = append([]governanceRuleFinding(nil), source[i].Decision.Findings...)
    for j := range out[i].Decision.Findings {
      if location := out[i].Decision.Findings[j].Location; location != nil {
        owned := *location
        out[i].Decision.Findings[j].Location = &owned
      }
    }
  }
  return out
}
