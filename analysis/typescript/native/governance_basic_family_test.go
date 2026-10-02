package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	"fmt"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"os"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"
)

var basicFamilyRules = []string{"RUL-SYNC", "RUL-PURE", "INT-PURE", "UI-NO-DOMAIN", "UTL-PUBLIC-DEPS"}

func basicFamilyPolicy() governancePolicy {
	policy := governanceTestPolicy()
	for _, layer := range []string{"rules", "integrations", "ui", "utils", "providers", "queries"} {
		policy.Layers = append(policy.Layers, governanceLayer{ID: layer, SourcePath: layer + "/"})
	}
	return policy
}

// The recorder is below original capture-owned compiler cells. It observes
// actual physical resolver operations, not attempted cached callback calls.
type basicFamilyPhysicalRead struct{ Kind, Path string }
type basicFamilyPhysicalFS struct {
	vfs.FS
	Reads []basicFamilyPhysicalRead
}

func (fs *basicFamilyPhysicalFS) record(kind, path string) {
	fs.Reads = append(fs.Reads, basicFamilyPhysicalRead{kind, path})
}
func (fs *basicFamilyPhysicalFS) ReadFile(path string) (string, bool) {
	fs.record("read", path)
	return fs.FS.ReadFile(path)
}
func (fs *basicFamilyPhysicalFS) FileExists(path string) bool {
	fs.record("file", path)
	return fs.FS.FileExists(path)
}
func (fs *basicFamilyPhysicalFS) DirectoryExists(path string) bool {
	fs.record("directory", path)
	return fs.FS.DirectoryExists(path)
}
func (fs *basicFamilyPhysicalFS) GetAccessibleEntries(path string) vfs.Entries {
	fs.record("entries", path)
	return fs.FS.GetAccessibleEntries(path)
}
func (fs *basicFamilyPhysicalFS) Realpath(path string) string {
	fs.record("realpath", path)
	return fs.FS.Realpath(path)
}
func (fs *basicFamilyPhysicalFS) Stat(path string) vfs.FileInfo {
	fs.record("stat", path)
	return fs.FS.Stat(path)
}

func basicFamilyCapture(t *testing.T, root string) (*governedProject, *basicFamilyPhysicalFS) {
	t.Helper()
	project, err := captureGovernedProject(root, basicFamilyPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if project.capture.compiler == nil {
		project.capture.compiler = governanceNewCompilerInputFS(newAuthoredCompilerDisk())
	}
	fs := &basicFamilyPhysicalFS{FS: project.capture.compiler.FS}
	project.capture.compiler.FS = fs
	return project, fs
}
func basicFamilySamePrefix(t *testing.T, old, new *governedProject, a, b *basicFamilyPhysicalFS) {
	t.Helper()
	if !reflect.DeepEqual(a.Reads, b.Reads) {
		t.Fatalf("physical resolver order differs\nold=%#v\nnew=%#v", a.Reads, b.Reads)
	}
	if !reflect.DeepEqual(old.capture.observations, new.capture.observations) ||
		!reflect.DeepEqual(old.capture.compiler.observed, new.capture.compiler.observed) ||
		!reflect.DeepEqual(old.capture.compiler.rawReads, new.capture.compiler.rawReads) ||
		old.capture.compiler.inconsistent != new.capture.compiler.inconsistent {
		t.Fatal("actual captured presence/content/metadata prefix differs")
	}
	if !reflect.DeepEqual(old.familyResidual, new.familyResidual) {
		t.Fatalf("residual order differs: %#v / %#v", old.familyResidual, new.familyResidual)
	}
	if new.typeOwner != nil && (new.typeOwner.program != nil || new.typeOwner.opened) {
		t.Fatal("basic family opened typed authority")
	}
}

func TestGovernanceBasicFamilyAllRuleOrdersOriginalPrefix(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"},"include":["**/*.ts"]}`)
	governanceWrite(t, root, "rules/source.ts", `import './missing'; export async function rule(){ await Promise.resolve(1);fetch('x'); } Promise[member]();`)
	governanceWrite(t, root, "integrations/source.ts", `import '../providers/source'; import type {Value} from '../schema/source'; export const integration=1;`)
	governanceWrite(t, root, "providers/source.ts", `export const provider=1;`)
	governanceWrite(t, root, "schema/source.ts", `export type Value=string;`)
	governanceWrite(t, root, "ui/source.ts", `import '../schema/source';`)
	governanceWrite(t, root, "utils/source.ts", `import '../rules/source'; import '@astrale-os/sdk/src/private';`)
	var permutations func([]string, []string)
	count := 0
	permutations = func(prefix, remaining []string) {
		if len(remaining) == 0 {
			count++
			t.Run(strings.Join(prefix, "/"), func(t *testing.T) {
				old, a := basicFamilyCapture(t, root)
				new, b := basicFamilyCapture(t, root)
				findings := 0
				for _, rule := range append(append([]string{}, prefix...), prefix...) {
					want := governanceSourceFamilyOriginal(old, rule)
					got, known := governanceEvaluate(new, rule)
					if !known || !reflect.DeepEqual(want, got) {
						t.Fatalf("%s differs\nold=%#v\nnew=%#v", rule, want, got)
					}
					findings += len(got.Findings)
					basicFamilySamePrefix(t, old, new, a, b)
				}
				if findings == 0 || len(a.Reads) == 0 {
					t.Fatal("fixture did not reach rule evidence and actual resolver operations")
				}
				if new.stats.FamilyEvaluations != 1 || len(new.familyProducts) != 1 {
					t.Fatalf("expected one actual basic product: %#v", new.stats)
				}
				if old.stats.RuleEvaluations != 0 || new.stats.RuleEvaluations != 10 {
					t.Fatal("rule dispatch accounting changed")
				}
				for _, project := range []*governedProject{old, new} {
					if same, err := project.capture.Verify(); err != nil || !same {
						t.Fatalf("fresh original seal failed: %v %v", same, err)
					}
				}
			})
			return
		}
		for i, rule := range remaining {
			next := append([]string{}, remaining[:i]...)
			next = append(next, remaining[i+1:]...)
			permutations(append(append([]string{}, prefix...), rule), next)
		}
	}
	permutations(nil, basicFamilyRules)
	if count != 120 {
		t.Fatal(count)
	}
}

func TestGovernanceBasicFamilyEmptyLocalAndIgnoredOriginal(t *testing.T) {
	cases := []struct {
		Name, Path, Text string
		InvalidConfig    bool
	}{
		{"empty", "", "", false},
		{"local-shadow", "rules/source.ts", `function rule(Promise,fetch){Promise.resolve();fetch();} function other(){const Promise={};Promise[key]();} export const value=1;`, false},
		{"global", "rules/source.ts", `Promise[key]();fetch('x');export function* rule(){yield 1}`, false},
		{"ignored-focused", "rules/__tests__/source.ts", `export async function rule(){await Promise.resolve()}`, false},
		{"invalid-compiler-config", "utils/source.ts", `import './missing';import '@astrale-domains/other';`, true},
	}
	for _, test := range cases {
		t.Run(test.Name, func(t *testing.T) {
			root := t.TempDir()
			if test.Path != "" {
				governanceWrite(t, root, test.Path, test.Text)
			}
			if test.InvalidConfig {
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"not-a-resolution"}}`)
			}
			old, a := basicFamilyCapture(t, root)
			new, b := basicFamilyCapture(t, root)
			for _, rule := range basicFamilyRules {
				want := governanceSourceFamilyOriginal(old, rule)
				got, ok := governanceEvaluate(new, rule)
				if !ok || !reflect.DeepEqual(want, got) {
					t.Fatalf("%s: old=%#v new=%#v", rule, want, got)
				}
				basicFamilySamePrefix(t, old, new, a, b)
			}
			if new.stats.FamilyEvaluations != 1 {
				t.Fatal("basic product recomputed")
			}
		})
	}
}

func TestGovernanceBasicFamilyPreservesPointerOwnerAndOldOutcomeProjection(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "rules/a.ts", "Promise[key]();")
	governanceWrite(t, root, "rules/b.ts", "\n\nfetch('x');")
	old, _ := basicFamilyCapture(t, root)
	new, _ := basicFamilyCapture(t, root)
	// A deliberately malformed private project retains two distinct source owners
	// at one path. The actual capture cannot produce it; no path-map substitution
	// may silently change the original pointer-owned location projection.
	for _, project := range []*governedProject{old, new} {
		project.Files[0].Path = project.Files[1].Path
		project.FilesByPath = map[string]*governedFile{project.Files[1].Path: project.Files[1]}
	}
	for _, rule := range basicFamilyRules {
		want := governanceSourceFamilyOriginal(old, rule)
		got, _ := governanceEvaluate(new, rule)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("pointer source owner collapsed for %s", rule)
		}
	}
	shared := governanceSharedProject(new)
	// Preserve original basic projection's deliberate omission of reason, even
	// if a future evaluator adds it. Combined families keep their own semantics.
	result := sourcepolicy.Result{Evidence: []sourcepolicy.Evidence{{Rule: "RUL-SYNC", Kind: "ambiguity", Evidence: "future", AmbiguityReason: "unsupported-syntax", File: shared.Files[0], Node: shared.Files[0].Source.AsNode()}}, Residual: []sourcepolicy.Residual{{Rule: "RUL-SYNC", Reason: "first"}, {Rule: "RUL-SYNC", Reason: "second"}}}
	new.familyProducts["basic"] = result
	got, _ := governanceEvaluate(new, "RUL-SYNC")
	if got.Status != "residual" || len(got.Findings) != 1 || got.Findings[0].AmbiguityReason != "" || !reflect.DeepEqual(new.familyResidual, []string{"RUL-SYNC: first", "RUL-SYNC: second"}) {
		t.Fatalf("old basic projection contract changed: %#v", got)
	}
	got.Findings[0].Evidence = "consumer mutation"
	got.Findings[0].Location.Path = "consumer mutation"
	again, _ := governanceEvaluate(new, "RUL-SYNC")
	if again.Findings[0].Evidence != "future" || again.Findings[0].Location.Path == "consumer mutation" {
		t.Fatal("consumer mutated retained family product")
	}
}

func TestGovernanceBasicFamilyNegativeReadFreshCaptureAndMembership(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "utils/source.ts", `import './missing';`)
	old, a := basicFamilyCapture(t, root)
	new, b := basicFamilyCapture(t, root)
	for _, rule := range basicFamilyRules {
		want := governanceSourceFamilyOriginal(old, rule)
		got, _ := governanceEvaluate(new, rule)
		if !reflect.DeepEqual(want, got) {
			t.Fatal(rule)
		}
	}
	basicFamilySamePrefix(t, old, new, a, b)
	governanceWrite(t, root, "utils/missing.ts", "export const newlyPresent=1;")
	for _, project := range []*governedProject{old, new} {
		if same, err := project.capture.Verify(); err != nil || same {
			t.Fatalf("negative membership survived: %v %v", same, err)
		}
	}
	// Every new capture owns a new product, even when source bytes are unchanged.
	fresh, _ := basicFamilyCapture(t, root)
	want, _ := basicFamilyCapture(t, root)
	for _, rule := range basicFamilyRules {
		expected := governanceSourceFamilyOriginal(want, rule)
		got, _ := governanceEvaluate(fresh, rule)
		if !reflect.DeepEqual(expected, got) {
			t.Fatal(rule)
		}
	}
	if fresh.stats.FamilyEvaluations != 1 || fresh.sharedProject == new.sharedProject {
		t.Fatal("cross-capture product escaped")
	}
	for _, path := range []string{"utils/source.ts", "utils/missing.ts"} {
		if err := os.Remove(root + "/" + path); err != nil {
			t.Fatal(err)
		}
	}
	dropped, _ := basicFamilyCapture(t, root)
	dropOracle, _ := basicFamilyCapture(t, root)
	for _, rule := range basicFamilyRules {
		expected := governanceSourceFamilyOriginal(dropOracle, rule)
		got, _ := governanceEvaluate(dropped, rule)
		if !reflect.DeepEqual(expected, got) || got.SubjectCount != 0 || len(got.Findings) != 0 {
			t.Fatal("empty membership retained old subjects")
		}
	}
}

func TestGovernanceBasicFamilyActualIntrinsicResumeKeepsIndependentProduct(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "rules/source.ts", `Promise[key]();fetch('x');`)
	project, _ := basicFamilyCapture(t, root)
	original, _ := basicFamilyCapture(t, root)
	expected := map[string]governanceOutcome{}
	for _, rule := range basicFamilyRules {
		expected[rule] = governanceSourceFamilyOriginal(original, rule)
	}
	state := &governanceProductsSession{Project: project, Token: "basic-resume", Generation: "1", Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false}`)}, Answers: map[string]governanceIntrinsicAnswer{}}
	project.sourceProofState = state
	ids := []string{}
	for rule := range governanceRevisions {
		ids = append(ids, rule)
	}
	sort.Strings(ids)
	for _, rule := range ids {
		implementation := "astrale.sdk.typescript-source"
		if rule == "QRY-CANON" || rule == "QRY-SINGLE" || rule == "QLT-DEF-IDS" {
			implementation = "astrale.sdk.codegraph"
		}
		state.Contracts = append(state.Contracts, governanceImplementationContract{RuleID: rule, RuleRevision: governanceRevisions[rule], Implementation: governanceImplementation{implementation, "1"}})
		if !slices.Contains(basicFamilyRules, rule) {
			project.Disabled[rule] = "fixture"
		}
	}
	state.ActiveFamily = "workflows"
	state.require(governanceIntrinsic{ID: "unrelated-step", Kind: "accept-step-id"})
	state.ActiveFamily = ""
	session := governanceSession{productsSession: state}
	first, err := session.evaluateProducts()
	if err != nil {
		t.Fatal(err)
	}
	if first.(map[string]any)["status"] != "intrinsics" || project.stats.FamilyEvaluations != 1 || len(state.FamilyMissing["basic"]) != 0 {
		t.Fatal("basic family borrowed unrelated canonical authority")
	}
	accepted := true
	raw, _ := json.Marshal(map[string]any{"token": state.Token, "kind": "intrinsics", "answers": []governanceIntrinsicAnswer{{ID: "unrelated-step", Kind: "accept-step-id", Accepted: &accepted}}})
	resumed, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	response := resumed.(map[string]any)
	if response["status"] != "products" {
		t.Fatalf("actual continuation=%#v", response)
	}
	var envelope struct{ Products []governanceRuleProduct }
	if err := json.Unmarshal([]byte(response["productsJSON"].(string)), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Products) != 5 || project.stats.FamilyEvaluations != 1 {
		t.Fatal("basic ready products were lost or repeated on unrelated resume")
	}
	for _, product := range envelope.Products {
		want := expected[product.RuleID]
		if product.RuleRevision != want.Revision || product.Decision.Status != want.Status || len(product.Decision.Findings) != len(want.Findings) {
			t.Fatalf("%s projection differs", product.RuleID)
		}
		for i, finding := range product.Decision.Findings {
			original := want.Findings[i]
			kind := "indeterminate"
			if original.Kind == "violation" {
				kind = "fail"
			}
			if finding.Kind != kind || string(finding.Evidence) != original.Evidence || !reflect.DeepEqual(finding.Location, original.Location) || finding.AmbiguityReason != original.AmbiguityReason {
				t.Fatalf("%s finding differs", product.RuleID)
			}
		}
	}
	if state.ProductsDigest == "" {
		t.Fatal("no actual completed product digest")
	}
	if valid, err := project.capture.Verify(); err != nil || !valid {
		t.Fatalf("actual resumed seal=%v %v", valid, err)
	}
	if state.Generation != "1" {
		t.Fatal("resume changed current capture generation")
	}
}

func TestGovernanceBasicFamilyPreservesEveryRegisteredRuleDispatch(t *testing.T) {
	// Revisions is deliberately NOT a basic-only catalog: query_mutation.init
	// adds entries. This test runs the actual original dispatcher rather than
	// deriving expected rule routing from the candidate's catalog tests.
	if _, present := sourcepolicy.Revisions["QRY-CANON"]; !present {
		t.Fatal("missing actual merged revision registration")
	}
	ids := []string{}
	for rule := range governanceRevisions {
		ids = append(ids, rule)
	}
	sort.Strings(ids)
	for _, populated := range []bool{false, true} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("populated=%v/reverse=%v", populated, reverse), func(t *testing.T) {
				root := t.TempDir()
				if populated {
					for _, layer := range []string{"schema", "mutations", "rules", "integrations", "ui", "utils", "providers", "queries", "functions", "migrations"} {
						governanceWrite(t, root, layer+"/source.ts", `export const value=1;`)
					}
				}
				if populated {
					// Existing SDK source-rule regression inputs, rules.test.ts
					// QRY-CANON and MUT-CANON: no invented typed authority.
					governanceWrite(t, root, "queries/source.ts", "import { defineQuery } from '@astrale-os/sdk'\nexport const q = defineQuery<any>()(() => ({ id: 'q', build: () => ({ raw: true }) }))\n")
					governanceWrite(t, root, "mutations/source.ts", "import { defineMutation } from '@astrale-os/sdk'\ndefineMutation<any>()(() => ({ id: 'm', build: () => ({ raw: true }) }))\n")
				}
				old, a := basicFamilyCapture(t, root)
				new, b := basicFamilyCapture(t, root)
				queryEvidence, mutationEvidence := false, false
				order := append([]string{}, ids...)
				if reverse {
					slices.Reverse(order)
				}
				for _, rule := range order {
					want, wantKnown := governanceEvaluateOriginal(old, rule)
					got, gotKnown := governanceEvaluate(new, rule)
					if rule == "QRY-CANON" {
						queryEvidence = len(want.Findings) > 0 || want.Status == "residual"
					}
					if rule == "MUT-CANON" {
						mutationEvidence = len(want.Findings) > 0 || want.Status == "residual"
					}
					if wantKnown != gotKnown || !reflect.DeepEqual(want, got) {
						t.Fatalf("original registered dispatcher differs for %s: %#v / %#v", rule, want, got)
					}
					basicFamilySamePrefix(t, old, new, a, b)
					for group := range old.familyProducts {
						if _, present := new.familyProducts[group]; !present {
							t.Fatalf("original family %s lost after %s", group, rule)
						}
					}
					for group := range new.familyProducts {
						if group != "basic" {
							if _, present := old.familyProducts[group]; !present {
								t.Fatalf("family %s admitted before its original dispatcher after %s", group, rule)
							}
						}
					}
				}
				if populated && (!queryEvidence || !mutationEvidence) {
					t.Fatal("original query/mutation semantic fixtures did not produce evidence")
				}
				if _, present := new.familyProducts["queries"]; !present {
					t.Fatal("registered query family intercepted")
				}
				if _, present := new.familyProducts["mutations"]; !present {
					t.Fatal("registered mutation family intercepted")
				}
				if new.stats.FamilyEvaluations != old.stats.FamilyEvaluations+1 {
					t.Fatalf("expected only added basic product count, original=%d new=%d", old.stats.FamilyEvaluations, new.stats.FamilyEvaluations)
				}
				for _, project := range []*governedProject{old, new} {
					if same, err := project.capture.Verify(); err != nil || !same {
						t.Fatalf("registered-dispatch final seal=%v %v", same, err)
					}
				}
			})
		}
	}
}
