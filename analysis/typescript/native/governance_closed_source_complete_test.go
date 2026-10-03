package main

import (
  "encoding/json"
  "errors"
  "strings"
  "testing"
)

func TestClosedSourceCompletionRejectsOriginalInvalidSpans(t *testing.T) {
  maximum := int(^uint(0) >> 1)
  for _, sample := range []struct {
    name, text, path string
    offset, length int
    accepted bool
  }{
    {"original-binding-rejects-empty-file-span", "", "index.ts", 0, 1, false},
    {"empty-extra-length", "", "index.ts", 0, 2, false},
    {"empty-extra-offset", "", "index.ts", 1, 1, false},
    {"overflow-sum", "x", "index.ts", 1, maximum, false},
    {"oversized-length", "x", "index.ts", 0, maximum, false},
    {"foreign-file", "x", "foreign.ts", 0, 1, false},
  } {
    t.Run(sample.name, func(t *testing.T) {
      root := t.TempDir()
      governanceWrite(t, root, "index.ts", sample.text)
      project, err := captureGovernedProject(root, governanceTestPolicy())
      if err != nil { t.Fatal(err) }
      project.Disabled = map[string]string{}
      state := &governanceProductsSession{Project: project, Token: "owned-source", Generation: "1",
        Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false}`)}}
      for id, revision := range governanceRevisions {
        identity := "astrale.sdk.typescript-source"
        if id == "QRY-CANON" || id == "QRY-SINGLE" || id == "QLT-DEF-IDS" { identity = "astrale.sdk.codegraph" }
        state.Contracts = append(state.Contracts, governanceImplementationContract{RuleID: id,
          RuleRevision: revision, Implementation: governanceImplementation{identity, "1"}})
        if id != "IMP-ALIAS-CFG" { project.Disabled[id] = "completion-admission fixture" }
      }
      session := governanceSession{productsSession: state}
      defer session.discardProducts()
      payload, err := json.Marshal(map[string]any{
        "token": state.Token, "generation": state.Generation, "kind": "source-complete", "sourceSnapshotDigest": project.GovernanceDigest,
        "decisions": []any{map[string]any{"id": "IMP-ALIAS-CFG", "decision": map[string]any{
          "status": "fail", "findings": []any{map[string]any{"kind": "fail",
            "evidenceUnits": []uint16{'o', 'w', 'n', 'e', 'd'}, "location": decisionLocation{
              sample.path, 1, sample.offset+1, sample.offset, sample.length},
          }},
        }}},
      })
      if err != nil { t.Fatal(err) }
      result, err := session.continueProducts(payload)
      if !sample.accepted {
        if err == nil || state.SourceProducts != nil || state.ProductsDigest != "" {
          t.Fatalf("invalid span entered complete ownership: result=%#v error=%v products=%#v", result, err, state.SourceProducts)
        }
        return
      }
      if err != nil { t.Fatal(err) }
      if result.(map[string]any)["status"] != "products" || state.ProductsDigest == "" {
        t.Fatalf("original empty anchor did not finalize: %#v", result)
      }
      if project.typeOwner != nil && project.typeOwner.program != nil {
        t.Fatal("pure source completion opened a semantic Program")
      }
    })
  }
}

func TestClosedSourceHandoffFollowsOriginalSemanticAndCaptureObligations(t *testing.T) {
  for _, frontier := range []string{"invalid-budget", "inconsistent-capture", "pending-leaf", "ready"} {
    t.Run(frontier, func(t *testing.T) {
      root := t.TempDir()
      governanceWrite(t, root, "mutations/source.ts", "export const value=1;")
      governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["mutations/**/*.ts"]}`)
      project, err := captureGovernedProject(root, governanceTestPolicy())
      if err != nil { t.Fatal(err) }
      project.Disabled = map[string]string{}
      state := &governanceProductsSession{Project:project,Token:"semantic-first",Generation:"1",
        Prepare:governancePrepare{Options:json.RawMessage(`{"generic":false}`)}}
      for id, revision := range governanceRevisions {
        identity := "astrale.sdk.typescript-source"
        if id=="QRY-CANON" || id=="QRY-SINGLE" || id=="QLT-DEF-IDS" { identity="astrale.sdk.codegraph" }
        state.Contracts=append(state.Contracts,governanceImplementationContract{RuleID:id,RuleRevision:revision,
          Implementation:governanceImplementation{identity,"1"}})
        if id!="IMP-STATIC" && id!="QLT-DEF-IDS" { project.Disabled[id]="order fixture" }
      }
      if frontier=="invalid-budget" { state.Prepare.Options=json.RawMessage(`{"generic":false,"budgetValidation":{"kind":"invalid","field":"maximumSteps","reason":"positive-integer"}}`) }
      if frontier=="inconsistent-capture" { project.capture.probeInconsistent=true }
      if frontier=="pending-leaf" { state.require(governanceIntrinsic{ID:"original-pending",Kind:"accept-step-id"}) }
      session:=governanceSession{productsSession:state}
      defer session.discardProducts()
      opened, err:=json.Marshal(map[string]any{"token":state.Token,"kind":"source-open",
        "generation":state.Generation,"sourceSnapshotDigest":project.GovernanceDigest})
      if err!=nil { t.Fatal(err) }
      var result any
      if frontier=="inconsistent-capture" { result,err=session.closedSourceHandoff() } else { result,err=session.continueProducts(opened) }
      if state.SourceProducts!=nil || state.ProductsDigest!="" { t.Fatal("unfinished source decisions were published") }
      if frontier=="invalid-budget" {
        var original *governanceSemanticBudgetError
        if !errors.As(err,&original) || original.name!="maximumSteps" { t.Fatalf("semantic error was bypassed: result=%#v error=%v",result,err) }
        return
      }
      if err!=nil { t.Fatal(err) }
      out:=result.(map[string]any)
      expected:=map[string]string{"inconsistent-capture":"partial","pending-leaf":"intrinsics","ready":"source"}[frontier]
      if out["status"]!=expected { t.Fatalf("original frontier %s bypassed: %#v",frontier,out) }
      if frontier=="inconsistent-capture" {
        if session.productsSession!=nil || !strings.Contains(strings.Join(out["residual"].([]string),"\n"),"Captured generic I/O observations changed") { t.Fatal("changed capture reached source evaluation") }
      } else if len(state.RuntimeReady)!=3 { t.Fatal("source handoff preceded complete original runtime decisions") }
    })
  }
}
