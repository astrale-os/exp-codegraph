package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestGovernanceRetiredSourcePrepareKeepsPartialAndRevisionFrontier(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "schema/classes/source.ts", `export const raw = {icon: undefined};`)
	policy := governanceTestPolicy()
	rules := []string{"SCH-ONE-DECL", "SCH-ICON-REQUIRED", "SCH-ICON-NEUTRAL", "SCH-EXACT-TYPES", "SCH-DECL-ONLY", "SCH-STATE-RELATION", "SCH-STATE-PURE", "SCH-STATE-SOURCE", "MUT-PLAN-REQ", "MUT-LOCAL-ALIAS", "MUT-STATE-INITIAL", "MUT-STATE-ATOMIC", "MUT-CANON", "MUT-FRAGMENTS", "MUT-PURE", "ROOT-COMPOSE", "ROOT-FACADE", "DOM-PUBLIC-DEPS", "FNC-XDOM-DECLARED", "FNC-XDOM-REQ", "DEP-ALLOWLIST", "IMP-ALIAS-CFG", "QLT-TYPED-COORD", "QLT-CANON-VALUES", "NODE-INHERITED", "RUL-SYNC", "RUL-PURE", "INT-PURE", "UI-NO-DOMAIN", "UTL-PUBLIC-DEPS", "MOD-REQUIRED", "MOD-GOVERNED", "TST-NO-PROD-IMP", "IMP-STATIC", "IMP-SDK-BOUNDARY"}
	requests := []governanceRevision{{ID: "unknown-source-rule", Revision: "unknown"}}
	for _, rule := range rules {
		requests = append(requests, governanceRevision{ID: rule, Revision: governanceRevisions[rule]})
	}
	requests = append(requests, governanceRevision{ID: rules[0], Revision: "different"})
	session := &governanceSession{root: root}
	project, product, err := session.prepareSource(governancePrepare{Root: root, PolicySource: &policy, RuleRevisions: requests})
	if err != nil || project == nil {
		t.Fatalf("captured partial failed: %v", err)
	}
	want := []string{
		"Native rule implementation unavailable: unknown-source-rule",
		"Native rule revision differs: " + rules[0],
		"Native source-family evaluation requires the SDK source-policy owner.",
		"Canonical full policy compilation and whole LintResult assembly/suppression are not qualified.",
	}
	if product.Complete || len(product.Outcomes) != 0 || len(product.Files) == 0 || !reflect.DeepEqual(product.Residual, want) {
		t.Fatalf("original unsupported prepare changed: %#v", product)
	}
	for _, rule := range rules {
		if _, known := governanceEvaluate(project, rule); known {
			t.Fatal("retired source rule fabricated a verdict", rule)
		}
	}
	if project.typeOwner != nil || product.PhaseCounters.RuleEvaluations != 0 || product.PhaseCounters.FamilyEvaluations != 0 {
		t.Fatal("source-only partial entered compiler/rule authority")
	}
}

func TestGovernanceRetiredSourcePrepareKeepsCaptureErrorBeforeRuleMetadata(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "schema/bad.ts", "valid")
	if err := os.WriteFile(filepath.Join(root, "schema/bad.ts"), []byte{255}, 0644); err != nil {
		t.Fatal(err)
	}
	policy := governanceTestPolicy()
	project, product, err := (&governanceSession{root: root}).prepareSource(governancePrepare{
		Root: root, PolicySource: &policy,
		RuleRevisions: []governanceRevision{{ID: "unknown-source-rule", Revision: "unknown"}},
	})
	if err == nil || !strings.Contains(err.Error(), "is not valid UTF-8") || project != nil || len(product.Residual) != 0 {
		t.Fatalf("capture error was replaced by rule admission: project=%v residual=%v err=%v", project, product.Residual, err)
	}
}
