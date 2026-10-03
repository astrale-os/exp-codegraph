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
    {"owned-comment-surrogate-pair", "//\U0001F600\nexport {}", "index.ts", 2, 2, true},
  } {
    t.Run(sample.name, func(t *testing.T) {
      root := t.TempDir()
      governanceWrite(t, root, "index.ts", sample.text)
      project, err := captureGovernedProject(root, governanceTestPolicy())
      if err != nil { t.Fatal(err) }
      project.Disabled = map[string]string{}
      state := &governanceProductsSession{Project: project, Token: "owned-source", Generation: "1",
        Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":1}`)}}
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
        t.Fatalf("owned valid UTF16 span did not finalize: %#v", result)
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
        Prepare:governancePrepare{Options:json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":1}`)}}
      for id, revision := range governanceRevisions {
        identity := "astrale.sdk.typescript-source"
        if id=="QRY-CANON" || id=="QRY-SINGLE" || id=="QLT-DEF-IDS" { identity="astrale.sdk.codegraph" }
        state.Contracts=append(state.Contracts,governanceImplementationContract{RuleID:id,RuleRevision:revision,
          Implementation:governanceImplementation{identity,"1"}})
        if id!="IMP-STATIC" && id!="QLT-DEF-IDS" { project.Disabled[id]="order fixture" }
      }
      if frontier=="invalid-budget" { state.Prepare.Options=json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":1,"budgetValidation":{"kind":"invalid","field":"maximumSteps","reason":"positive-integer"}}`) }
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

// Old callers never receive a phase they cannot consume. These are protocol
// fixtures; only the three original runtime decisions are semantically owned.
func TestClosedSourceCapabilityPreservesOlderProductsAndFallback(t *testing.T) {
  for _, sample := range []struct { raw string; offered bool } {
    {`{"sourcePolicyOwnerRevision":1}`,true}, {`{}`,false},
    {`{"sourcePolicyOwnerRevision":null}`,false}, {`{"sourcePolicyOwnerRevision":"1"}`,false},
    {`{"sourcePolicyOwnerRevision":1.0}`,false}, {`{"sourcePolicyOwnerRevision":2}`,false},
  } { if governanceClosedSourceOffered(json.RawMessage(sample.raw))!=sample.offered { t.Fatalf("offer admission differs: %s",sample.raw) } }
  for _, offer := range []string{`{"generic":false}`, `{"generic":false,"sourcePolicyOwnerRevision":2}`} {
    modes:=[]string{"selected-source", "runtime-only", "invalid-budget"}
    if offer==`{"generic":false}` { modes=append(modes,"selected-source-default-generic","invalid-budget-default-generic") }
    for _, mode := range modes {
      t.Run(offer+"/"+mode, func(t *testing.T) {
        root := t.TempDir()
        governanceWrite(t, root, "mutations/source.ts", "export const value=1;")
        governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["mutations/**/*.ts"]}`)
        scenario:=strings.TrimSuffix(mode,"-default-generic")
        defaultGeneric:=scenario!=mode
        options := json.RawMessage(offer)
        if defaultGeneric { options=json.RawMessage(`{"generic":true}`) }
        if scenario=="invalid-budget" { options=json.RawMessage(strings.TrimSuffix(string(options),"}")+`,"budgetValidation":{"kind":"invalid","field":"maximumSteps","reason":"positive-integer"}}`) }
        session := governanceSession{productsSession:&governanceProductsSession{Prepare:governancePrepare{Root:root,Options:options}}}
        defer session.discardProducts()
        configuration,err:=session.captureConfiguration(root)
        if err!=nil { t.Fatal(err) }
        contracts:=[]governanceImplementationContract{}
        disabled:=[]governanceDisabledRule{}
        for id,revision:=range governanceRevisions {
          identity:="astrale.sdk.typescript-source"
          runtime:=id=="QRY-CANON" || id=="QRY-SINGLE" || id=="QLT-DEF-IDS"
          if runtime { identity="astrale.sdk.codegraph" }
          contracts=append(contracts,governanceImplementationContract{RuleID:id,RuleRevision:revision,Implementation:governanceImplementation{identity,"1"}})
          if !runtime && (scenario=="runtime-only" || id!="IMP-STATIC") { disabled=append(disabled,governanceDisabledRule{id,"protocol fixture"}) }
        }
        raw,err:=json.Marshal(map[string]any{"token":configuration["token"],"kind":"policy",
          "policy":governanceCompiledPolicy{Source:governanceTestPolicy(),Digest:"canonical",Disabled:disabled},"implementationContracts":contracts})
        if err!=nil { t.Fatal(err) }
        result,err:=session.continueProducts(raw)
        if defaultGeneric && err==nil {
          early:=result.(map[string]any)
          if early["status"]!="generic" || session.policyLane==nil { t.Fatalf("original default lane was bypassed: %#v",early) }
          retired,_:=json.Marshal(map[string]any{"kind":"generic-retire","token":early["token"]})
          result,err=session.continueProducts(retired)
          if session.policyLane!=nil { t.Fatal("original generic-retire did not drain its policy owner") }
        }
        if scenario=="invalid-budget" {
          var original *governanceSemanticBudgetError
          if !errors.As(err,&original) || original.name!="maximumSteps" { t.Fatalf("original semantic failure masked: %#v %v",result,err) }
          return
        }
        if err!=nil { t.Fatal(err) }
        out:=result.(map[string]any)
        if scenario=="selected-source" {
          if out["status"]!="partial" || session.productsSession!=nil || !strings.Contains(strings.Join(out["residual"].([]string),"\n"),"owner capability unavailable") { t.Fatalf("older caller received unsupported source phase: %#v",out) }
          return
        }
        state:=session.productsSession
        var envelope struct { Products []governanceRuleProduct `json:"products"` }
        if out["status"]!="products" { t.Fatalf("disabled Source49 changed old products: %#v",out) }
        if err:=json.Unmarshal([]byte(out["productsJSON"].(string)),&envelope);err!=nil { t.Fatal(err) }
        if len(envelope.Products)!=3 || state.SourceProducts!=nil { t.Fatalf("invented source products: %#v",envelope) }
        for _,row:=range envelope.Products { if row.Implementation.ID!="astrale.sdk.codegraph" || row.Decision.Status!="pass" { t.Fatalf("original runtime product changed: %#v",row) } }
        // Re-open only the fixture's finalization cell to challenge the offer
        // guard with otherwise owned, correctly identified source operations.
        state.ProductsDigest=""
        for _,kind:=range []string{"source-open","source-observe","source-complete"} {
          operation,_:=json.Marshal(map[string]any{"kind":kind,"token":state.Token,
            "generation":state.Generation,"sourceSnapshotDigest":state.Project.GovernanceDigest,"decisions":[]any{},
            "request":governanceClosedSourceRequest{Token:state.Token,SourceSnapshotDigest:state.Project.GovernanceDigest,Path:"mutations/source.ts",Operation:"package-mapping"}})
          if _,err:=session.continueProducts(operation);err==nil || !strings.Contains(err.Error(),"ownership was not offered") || session.productsSession!=state || state.SourceProducts!=nil || state.ProductsDigest!="" { t.Fatalf("unoffered operation admitted: %s error=%v",kind,err) }
        }
      })
    }
  }
}
