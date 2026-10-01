package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGovernanceProductCommentsStartBOMAndScannerLexing(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "\ufeff// astrale-disable-next-line IMP-STATIC -- 😀\r\nrequire('x');\nconst str='// astrale-disable-next-line';\n/* astrale-disable-next-line invalid */")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	comments := governanceSuppressionComments(project)
	if len(comments) != 2 {
		t.Fatalf("scanner comments=%#v", comments)
	}
	if comments[0].Location.Offset != 1 || comments[0].Location.Line != 1 || comments[0].Location.Column != 2 || string(comments[0].LinePrefix) != "\ufeff" {
		t.Fatalf("first BOM comment=%#v", comments[0])
	}
	if comments[1].Location.Line != 4 {
		t.Fatalf("multiline=%#v", comments[1])
	}
}
func TestGovernanceProductsDoNotCertifySubsetOrCGReplacement(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "require('x')")
	session := governanceSession{productsSession: &governanceProductsSession{Prepare: governancePrepare{Root: root, Options: json.RawMessage(`{"generic":false}`)}}}
	configuration, err := session.captureConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	if configuration["configKind"] != "absent" || configuration["metadata"] != nil {
		t.Fatalf("configuration protocol=%#v", configuration)
	}
	payload := map[string]any{"token": configuration["token"], "kind": "policy", "policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical"}, "implementationContracts": []governanceImplementationContract{{RuleID: "IMP-STATIC", RuleRevision: governanceRevisions["IMP-STATIC"], Implementation: governanceImplementation{"astrale.sdk.typescript-source", "1"}}}}
	bytes, _ := json.Marshal(payload)
	response, err := session.continueProducts(bytes)
	if err != nil {
		t.Fatal(err)
	}
	out := response.(map[string]any)
	if out["status"] != "partial" {
		t.Fatalf("subset cannot be full=%#v", out)
	}
	if session.productsSession != nil {
		t.Fatal("partial capture retained")
	}
}
func TestGovernanceProductsFinalBarrierAfterConsumerProjection(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "const x=1;")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	state := &governanceProductsSession{Project: project, Token: "t", ProductsDigest: strings.Repeat("a", 64), InputCertificate: project.capture.certificate(), Generation: "1"}
	session := governanceSession{productsSession: state}
	governanceWrite(t, root, "mutations/source.ts", "const x=2;")
	response, err := session.sealProducts("t", state.ProductsDigest, strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	if response.(map[string]any)["status"] != "retry" {
		t.Fatalf("changed captured input sealed=%#v", response)
	}
	if session.productsSession != nil {
		t.Fatal("sealed capture not consumed")
	}
}
func TestGovernanceIntrinsicOrderRequiresStableCompletePermutation(t *testing.T) {
	for _, groups := range [][][]int{{{0, 2}, {1}}, {{0}, {1}, {2}}} {
		if !governanceValidOrder(groups, 3) {
			t.Fatal(groups)
		}
	}
	for _, groups := range [][][]int{{{2, 0}, {1}}, {{0}, {0}, {2}}, {{0}, {1}}, {{}, {0, 1, 2}}} {
		if governanceValidOrder(groups, 3) {
			t.Fatal(groups)
		}
	}
}
