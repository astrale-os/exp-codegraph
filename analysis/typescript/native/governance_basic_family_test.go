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
		!reflect.DeepEqual(old.capture.compiler.observed, new.capture.compiler.observed) ||
		!reflect.DeepEqual(old.capture.compiler.rawReads, new.capture.compiler.rawReads) ||
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
	expected := map[string]string{
		"DEP-ALLOWLIST":      "9c89a0fa0f648026b2f2c8befbbfa4c4714496f91a644a1faa9aeb8c9a3e2903",
		"DOM-PUBLIC-DEPS":    "32b41eefe565343a4c5d18ef2c22c428912c71771bfda4b6da52d3c1f62bbbf5",
		"FNC-INT-TYPES":      "d7f9733e3724ff3c449203551012b7c37bf7af7d2e0bc5b2642308822601a119",
		"FNC-NO-NEST":        "f2d818d1da69830c9ccaf183c5eb0310c795ab5da1a67871952aef1c2ef7600c",
		"FNC-ONE-IMPL":       "98a614772dec03f5a5c669d0b0efcca8d811a2ed6de91347c38c6bd06fe2a84e",
		"FNC-STEP-IDS":       "4bae952733b6f6f85e0380e68f8a8a7318e92dbe1405e57777fb64b36859baa1",
		"FNC-XDOM-DECLARED":  "269e22202a0fbec5ec4afc3579ca504eed457f44046b99e64a38d08634294909",
		"FNC-XDOM-REQ":       "a646c9931bb8b5a011a2cf7431f362fcb0e63be49dfc4c1bc0eba77a8aca8fdb",
		"IMP-ALIAS-CFG":      "c28fb835daba008c01fdf0f6555817a358da85d5a697775c029e8a051c28f0ab",
		"IMP-SDK-BOUNDARY":   "6e00f5e402015af4dbd7ddcd289d0b55a5cd2c145856056c0cb43a2035ebcf4a",
		"IMP-STATIC":         "41f0234cf5774884aaa5b3c4d23deb79e7bc524e964b60ec9d5bd4539d11ec9c",
		"INT-PURE":           "6eddaa070e097a15d194b09ebfeb8d21251c6682879e54a200efb91007742555",
		"MIG-DEDICATED-CTX":  "be6389211e5ac1c0a2805a45dbc394aace48167f462947edc1db47cb4d34bf1e",
		"MIG-EXACT-REVS":     "2353d23e19e0afa948b8c8c15b906a2e1427622cea441001d7e28c6fea81c860",
		"MOD-GOVERNED":       "2fbff878449c8554ae5f9936166c927f7030c79c4a466086b671060cebabda13",
		"MOD-REQUIRED":       "7792b445dee5c0b0184e3bc00e4bfeba2c5f25db921f9d825a5adfe0c9aba48f",
		"MUT-CANON":          "238b94e9c936fc7c8cd2e1b1d5b61e59f32069ff9974dc366de6633717f38756",
		"MUT-FRAGMENTS":      "6102ea4dbe2e461ef38b98afcfbe28639f4f472ee6a83e44ce6aad7de3c3c7ef",
		"MUT-LOCAL-ALIAS":    "9c2a55b932a3f63428701b0d613c4f8c8015a2444bd42f922bdc4921850c37cb",
		"MUT-PLAN-REQ":       "9201a4e5799f62cc8df37d281d1f02516132632e33b4a82187c399780bdfe340",
		"MUT-PURE":           "0101d7edd7d34e69338aaec7129a14df40d3395b6a58b40265ccb5448e739170",
		"MUT-STATE-ATOMIC":   "c734069c35bab09f47b4fcd6b3f207fccceb69a9da4f1fb1c50d9fd2711bf6dd",
		"MUT-STATE-INITIAL":  "d88f178994e9ad56d14f50ad5ffdff398413e42a690985c5ddc669c0f293d9bb",
		"NODE-INHERITED":     "0687b60d058bceb2c9833c6279c0e41543ea0e4d3b4a086ee95e8cb9c2275ef4",
		"PRV-NO-DOMAIN":      "5905f9e8fdd2130de52b41e2bbd920ada1ad9c04a71a04e79c98b1333c318e1b",
		"PRV-XDOM-REQ":       "065816fda57910e917670ed657cf45b1ad3bfdc8fba6362f48123221725e20a0",
		"PRV-XDOM-TYPED":     "a520d2276cd10135dc189bb248875406c8286c1a74d4cc39f8ec4d5a96510a49",
		"QLT-CANON-VALUES":   "2e236d7a521c771be8eace5689d10a52ae390f5d1071add401d749679d22b023",
		"QLT-DEF-IDS":        "0c51a2194d039facdb5833a288b4ec2eadea94bbd0afb02bd1065994592c6c07",
		"QLT-TYPED-COORD":    "4e0b929414b7526cd4cf2e755a9664eaf03845d79e650abcae7b1e2f4f4b67ce",
		"QRY-CANON":          "17dc62dc0413f93c9d9cfd4787ee729caf187eeffe83e38f8036c1cece1b3639",
		"QRY-COLL-FANOUT":    "50279cef3618d44cc1c3212a0d72213eca26a78c540f7a2998df244c38fc54ca",
		"QRY-COMPOSE-STABLE": "7e028a5408a958e7e5bd6ccf04a9262c33be1152c2248896ef3cf038c125ff1e",
		"QRY-COMPOSE-TYPED":  "4ab1566f88e42f6105ef99038f78fb03e2f95c6836458425aecfdecfc6ff3720",
		"QRY-SINGLE":         "a0b90940e0e980f1536b8bfd4288ba3b07689ddf4bf0e72a0ad4f39a83d01f84",
		"ROOT-COMPOSE":       "e4fed1eea4ff1ffdf57082a474cdcf7c0c83bb88268e189662594c8bdcadb47a",
		"ROOT-FACADE":        "df8b0fbb009121f498b3bbf2fca2eeb42da3b0c8c4aea89995e09b7e24efb486",
		"RUL-PURE":           "34957b915d98bd69f459a9865dba400d0c10f76be15502d55175bbd71de416c4",
		"RUL-SYNC":           "b319f50b900aa00880a19cccc0ec850fe86d6b317ffcb8dc578e7d6fac1c0548",
		"SCH-DECL-ONLY":      "3243da10715f3fbb500444cc562195ae10eb61dad84646ab8ef1d1a73b94c99a",
		"SCH-EXACT-TYPES":    "952b22e447d155ca168ac900eede803085cf6326ae73df3c588f6dc8caa3f116",
		"SCH-ICON-NEUTRAL":   "061939249964440ceba92dcb86f166553d56cc0196dff15785616423963d4d5b",
		"SCH-ICON-REQUIRED":  "f4055b93066289f9b7d9cfceb5ef236420f88311a357ea11161b6fda0922ab9f",
		"SCH-ONE-DECL":       "efaecd2e6978d1ec6d61559536246505c746b53f5968caf2560e811a970f2d04",
		"SCH-STATE-PURE":     "8bc69ef2aea37f568d34953c81cad55b1a91ab021e5d6e9b98c6aee3db6f4dd5",
		"SCH-STATE-RELATION": "5dd255417705fa49bda9c79a65032408e2817616c03e8d761ed8c6d089a733d3",
		"SCH-STATE-SOURCE":   "153bb37fbc7ddcf164dea299d6874251b6b2aeffa707e809044c5390f25b3fe6",
		"TST-NO-PROD-IMP":    "3862d665297486d32b225626f39a1cd8344b3f3bf93a2883e19dc4c94412574a",
		"UI-NO-DOMAIN":       "042a25c0aaa76576e6c9b4f9f4f1cc9b08fe5860b9d77a3e5cc64be0f121214c",
		"UTL-PUBLIC-DEPS":    "b64df16bd3b7d9a03142f4f651a29b4785ae64ab7d0ff8a5868a8fb82df9dc1a",
		"VIW-NO-COMPOSE":     "7c1ec262addbd460059e345ab388bf3dcff429618e5d3b1f618a7b0ae4b12d80",
		"VIW-SCHEMA-DECL":    "524ca0956e1ca5ecfd0010f2973075ef9844eb3b4ccf1771d1b784508292f906",
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
