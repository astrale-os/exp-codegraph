package main

import (
	"encoding/json"
	"fmt"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"os"
	"reflect"
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
		!reflect.DeepEqual(compilerTestObservations(old.capture.compiler), compilerTestObservations(new.capture.compiler)) ||
		!reflect.DeepEqual(compilerTestRawReads(old.capture.compiler), compilerTestRawReads(new.capture.compiler)) ||
		old.capture.compiler.inconsistent != new.capture.compiler.inconsistent {
		t.Fatal("actual captured presence/content/metadata prefix differs")
	}
	if new.typeOwner != nil && (new.typeOwner.program != nil || new.typeOwner.opened) {
		t.Fatal("basic family opened typed authority")
	}
}

// Semantic decisions live in the SDK original-verifier transfer tests. These
// controls exercise only the original captured compiler/import scalar owner.
func basicFamilyScalarPrefix(project *governedProject, rule string) []string {
	layer := ""
	switch rule {
	case "RUL-PURE":
		layer = "rules"
	case "INT-PURE":
		layer = "integrations"
	case "UI-NO-DOMAIN":
		layer = "ui"
	case "UTL-PUBLIC-DEPS":
		layer = "utils"
	}
	rows := []string{}
	if layer == "" {
		return rows
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != layer {
			continue
		}
		for _, imp := range file.Imports {
			target := project.resolveProjectImport(file, imp.Specifier)
			path := "<absent>"
			if target != nil {
				path = target.Path
			}
			rows = append(rows, file.Path+"/"+imp.Specifier+"="+path)
		}
	}
	return rows
}

// Publication tickets are private to each capture; semantic equality is canonical.
func basicFamilySameCertificates(t *testing.T, old, current *governedProject) {
	t.Helper()
	if old.capture.canonicalCertificate() != current.capture.canonicalCertificate() {
		t.Fatal("current canonical captured certificate differs")
	}
	left, right := old.capture.certificate(), current.capture.certificate()
	if left == "" || right == "" || left == right {
		t.Fatal("independent capture publication owners collapsed")
	}
	if left != old.capture.certificate() || right != current.capture.certificate() {
		t.Fatal("unchanged capture publication ticket advanced")
	}
}
func basicFamilyFreshSeal(t *testing.T, project *governedProject) {
	t.Helper()
	if same, err := project.capture.Verify(); err != nil || !same {
		t.Fatalf("fresh captured seal failed: %v %v", same, err)
	}
}
func TestGovernanceBasicCaptureAllScalarOrdersAndPhysicalPrefix(t *testing.T) {
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
				current, b := basicFamilyCapture(t, root)
				for _, rule := range append(append([]string{}, prefix...), prefix...) {
					if !reflect.DeepEqual(basicFamilyScalarPrefix(old, rule), basicFamilyScalarPrefix(current, rule)) {
						t.Fatal("captured scalar result order changed", rule)
					}
					basicFamilySamePrefix(t, old, current, a, b)
					basicFamilySameCertificates(t, old, current)
				}
				if len(a.Reads) == 0 {
					t.Fatal("fixture never reached actual resolver I/O")
				}
				basicFamilyFreshSeal(t, old)
				basicFamilyFreshSeal(t, current)
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
func TestGovernanceBasicCaptureEmptyLocalIgnoredAndInvalidCompiler(t *testing.T) {
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
			current, b := basicFamilyCapture(t, root)
			for _, rule := range basicFamilyRules {
				if !reflect.DeepEqual(basicFamilyScalarPrefix(old, rule), basicFamilyScalarPrefix(current, rule)) {
					t.Fatal(rule)
				}
				basicFamilySamePrefix(t, old, current, a, b)
			}
			if old.compilerValid == test.InvalidConfig || current.compilerValid == test.InvalidConfig {
				t.Fatal("original compiler validity changed")
			}
			basicFamilySameCertificates(t, old, current)
			if len(old.Files) != len(current.Files) {
				t.Fatal("capture membership differs")
			}
			basicFamilyFreshSeal(t, old)
			basicFamilyFreshSeal(t, current)
		})
	}
}
func TestGovernanceBasicCaptureKeepsIndependentSourceOwnersAndCoordinates(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "rules/a.ts", "Promise[key]();")
	governanceWrite(t, root, "rules/b.ts", "\n\nfetch('x');")
	old, _ := basicFamilyCapture(t, root)
	current, _ := basicFamilyCapture(t, root)
	if len(old.Files) != 2 || len(current.Files) != 2 {
		t.Fatal("missing owned source")
	}
	shared := governanceSharedProject(current)
	for i, file := range current.Files {
		if file == old.Files[i] || file.Source == old.Files[i].Source || shared.Files[i].Source != file.Source || shared.Files[i].Path != file.Path {
			t.Fatal("captured source owner collapsed")
		}
		location := governanceLocation(file, file.Source.Statements.Nodes[0])
		if location.Path != file.Path || location.Offset != i*2 || location.Line != 1+i*2 {
			t.Fatalf("current original location differs: %#v", location)
		}
	}
	basicFamilyFreshSeal(t, old)
	basicFamilyFreshSeal(t, current)
}
func TestGovernanceBasicCaptureNegativePresenceHiddenEditsAndFreshMembership(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "package.json", `{"type":"module"}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"},"include":["**/*.ts"]}`)
	governanceWrite(t, root, "utils/source.ts", `import './missing.js';`)
	old, a := basicFamilyCapture(t, root)
	current, b := basicFamilyCapture(t, root)
	for _, rule := range basicFamilyRules {
		if !reflect.DeepEqual(basicFamilyScalarPrefix(old, rule), basicFamilyScalarPrefix(current, rule)) {
			t.Fatal(rule)
		}
	}
	basicFamilySamePrefix(t, old, current, a, b)
	if len(a.Reads) == 0 {
		t.Fatal("negative scalar did not reach original compiler I/O")
	}
	governanceWrite(t, root, "utils/missing.ts", "export const newlyPresent=1;")
	for _, project := range []*governedProject{old, current} {
		if same, err := project.capture.Verify(); err != nil || same {
			t.Fatalf("negative presence survived: %v %v", same, err)
		}
	}
	fresh, _ := basicFamilyCapture(t, root)
	if len(fresh.Files) != 2 {
		t.Fatal("fresh membership did not admit new source")
	}
	if got := basicFamilyScalarPrefix(fresh, "UTL-PUBLIC-DEPS"); !reflect.DeepEqual(got, []string{"utils/source.ts/./missing.js=utils/missing.ts"}) {
		t.Fatal("fresh compiler scalar did not resolve newly present source", got)
	}
	basicFamilyFreshSeal(t, fresh)
	if _, err := fresh.capture.optional(root+"/.gitignore", 128*1024); err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, ".gitignore", "new hidden state\n")
	if same, err := fresh.capture.Verify(); err != nil || same {
		t.Fatalf("late hidden change survived: %v %v", same, err)
	}
	for _, path := range []string{"utils/source.ts", "utils/missing.ts"} {
		if err := os.Remove(root + "/" + path); err != nil {
			t.Fatal(err)
		}
	}
	dropped, _ := basicFamilyCapture(t, root)
	if len(dropped.Files) != 0 || len(basicFamilyScalarPrefix(dropped, "UTL-PUBLIC-DEPS")) != 0 {
		t.Fatal("empty membership retained old subjects")
	}
	basicFamilyFreshSeal(t, dropped)
}
func TestGovernanceBasicCaptureRetainsRealIntrinsicResumeDigestGenerationAndSeal(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "rules/source.ts", `Promise[key]();fetch('x');`)
	project, _ := basicFamilyCapture(t, root)
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
		project.Disabled[rule] = "protocol fixture does not own source verdicts"
	}
	certificate := project.capture.certificate()
	state.ActiveFamily = "workflows"
	state.require(governanceIntrinsic{ID: "unrelated-step", Kind: "accept-step-id"})
	state.ActiveFamily = ""
	session := governanceSession{productsSession: state}
	first, err := session.evaluateProducts()
	if err != nil {
		t.Fatal(err)
	}
	if first.(map[string]any)["status"] != "intrinsics" {
		t.Fatalf("missing real original intrinsic wave: %#v", first)
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
	if len(envelope.Products) != 0 || state.SourceProducts != nil {
		t.Fatal("disabled source fabricated verdicts")
	}
	if state.ProductsDigest == "" || state.Generation != "1" || state.Token != "basic-resume" || project.capture.certificate() != certificate {
		t.Fatal("resume changed original digest/generation/capture")
	}
	basicFamilyFreshSeal(t, project)
}
func TestGovernanceBasicCaptureRetainsAll52RevisionsAndRuntimeDispatch(t *testing.T) {
	// Shared independent wire oracle for Go regression and installed producer qualification.
	raw, err := os.ReadFile("testdata/governance-rule-revisions.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]string
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if len(expected) != 52 || !reflect.DeepEqual(governanceRevisions, expected) {
		t.Fatal("original52 revision metadata changed")
	}
	project, recorder := basicFamilyCapture(t, t.TempDir())
	for _, rule := range []string{"FNC-INT-TYPES", "FNC-STEP-IDS", "FNC-NO-NEST", "FNC-ONE-IMPL", "MIG-EXACT-REVS", "MIG-DEDICATED-CTX", "PRV-XDOM-TYPED", "PRV-XDOM-REQ", "PRV-NO-DOMAIN", "VIW-SCHEMA-DECL", "VIW-NO-COMPOSE"} {
		if _, known := governanceEvaluate(project, rule); known {
			t.Fatal("retired source evaluator fabricated verdict", rule)
		}
	}
	if len(recorder.Reads) != 0 {
		t.Fatal("retired source evaluator opened compiler authority")
	}
	basicFamilyFreshSeal(t, project)
	for _, populated := range []bool{false, true} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("populated=%v/reverse=%v", populated, reverse), func(t *testing.T) {
				root := t.TempDir()
				if populated {
					governanceWrite(t, root, "queries/source.ts", `import { defineQuery } from '@astrale-os/sdk'; export const q=defineQuery<any>()(()=>({id:'q',build:()=>({raw:true})}));`)
				}
				old, a := basicFamilyCapture(t, root)
				current, b := basicFamilyCapture(t, root)
				order := []string{"QRY-CANON", "QRY-SINGLE", "QLT-DEF-IDS"}
				if reverse {
					order = []string{"QLT-DEF-IDS", "QRY-SINGLE", "QRY-CANON"}
				}
				for _, rule := range order {
					left, leftKnown := governanceEvaluate(old, rule)
					right, rightKnown := governanceEvaluate(current, rule)
					if !leftKnown || leftKnown != rightKnown || !reflect.DeepEqual(left, right) {
						t.Fatal("original runtime/definition dispatch changed", rule)
					}
					basicFamilySamePrefix(t, old, current, a, b)
				}
				basicFamilyFreshSeal(t, old)
				basicFamilyFreshSeal(t, current)
			})
		}
	}
}
