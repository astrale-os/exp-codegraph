package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"astrale-typespec-v2-native-analysis/jsstring"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

func TestGovernanceJSONLiteralFidelity(t *testing.T) {
	for _, test := range []struct {
		text     string
		faithful bool
	}{
		{`{"#\uFFFD":"./real.ts"}`, true},
		{`{"#\uD800":"./lone.ts"}`, false},
		{`{"#\uFFFD":"./real.ts","#\uD800":"./lone.ts"}`, false},
		{`{"#\uD83D\uDE00":"./real.ts"}`, true},
		{`{"#😀":"./real.ts"}`, true},
		{`{"#\\uD800":"./real.ts"}`, true},
		{`{"#benign":"./real.ts","note":"\\uD800"}`, true},
		{`{"#benign":"./\uD800.ts"}`, false},
		{`{/*original JSON comments*/"#benign":".\/real.ts",}`, true},
		{"{", false},
	} {
		if actual := governanceJSONLiteralFidelity("/private/base.options", test.text); actual != test.faithful {
			t.Fatalf("JSON=%q faithful=%v expected=%v", test.text, actual, test.faithful)
		}
	}
}

func TestGovernanceJSONFidelityOriginalMetadataPorts(t *testing.T) {
	for _, test := range []struct {
		name, text string
		faithful   bool
	}{
		{"base.options", `{"compilerOptions":{"paths":{"#\uFFFD":["./real.ts"],"#\uD800":["./lone.ts"]}}}`, false},
		{"base.options", `{"compilerOptions":{"paths":{"#\uD83D\uDE00":["./real.ts"]}}}`, true},
		{"package.json", `{"imports":{"#\uFFFD":"./real.ts","#\uD800":"./lone.ts"}}`, false},
		{"package.json", `{"imports":{"#\\uD800":"./real.ts"}}`, true},
	} {
		t.Run(test.name+test.text, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, test.name, test.text)
			fs := governanceNewCompilerInputFS(newAuthoredCompilerDisk())
			path := filepath.Join(root, test.name)
			// Configuration/extends use the JSON host regardless of filename extension;
			// the Program's package-json reader uses the underlying same input owner.
			reader := (governanceConfigHost{root, fs}).FS()
			if test.name == "package.json" {
				reader = fs
			}
			first, present := reader.ReadFile(path)
			second, secondPresent := reader.ReadFile(path)
			if !present || !secondPresent || first != test.text || second != first {
				t.Fatal("original raw read changed")
			}
			fs.mu.Lock()
			faithful := !fs.metadataLossy
			raw := fs.rawReads[path]
			observation := fs.observed[compilerInputKey{path, inputRead}]
			fs.mu.Unlock()
			if faithful != test.faithful || raw != (compilerRawRead{test.text, true}) || observation != inputText(test.text, true) {
				t.Fatalf("actual metadata prefix changed: fidelity=%v raw=%#v observation=%q", faithful, raw, observation)
			}
			missing := filepath.Join(root, "missing.options")
			if _, present := reader.ReadFile(missing); present {
				t.Fatal("missing metadata became present")
			}
			fs.mu.Lock()
			absent, recorded := fs.rawReads[missing]
			fs.mu.Unlock()
			if !recorded || absent.present {
				t.Fatal("original negative read guard lost")
			}
		})
	}
}

func TestGovernanceJSONFidelityActualExtendedConfig(t *testing.T) {
	root := typeDemandFixture(t)
	const base = `{"compilerOptions":{"paths":{"#\uFFFD":["./schema/value.ts"],"#\uD800":["./schema/lone.ts"]}}}`
	governanceWrite(t, root, "base.options", base)
	governanceWrite(t, root, "tsconfig.json", `{"extends":"./base.options","compilerOptions":{"noLib":true},"include":["schema/**/*.ts","mutations/**/*.ts","queries/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	fs := project.capture.compiler
	fs.mu.Lock()
	value, present := fs.rawReads[filepath.Join(root, "base.options")]
	lossy := fs.metadataLossy
	fs.mu.Unlock()
	if !present || value != (compilerRawRead{base, true}) || !lossy {
		t.Fatalf("real extension read omitted: %#v %v", value, lossy)
	}
}

func TestGovernanceJSONFidelityFiveScalarAdmission(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "package.json", `{"type":"module","imports":{"#\uFFFD":{"default":"./schema/value.ts"},"#\uD800":"./schema/lone.ts"}}`)
	project, file, expression := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	state := &governanceProductsSession{Project: project, Token: "json-five", Generation: "1", Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":2}`)}}
	session := governanceSession{productsSession: state}
	defer session.discardProducts()
	governanceSourceObservationFixture(t, &session)
	captured := project.FilesByPath[file.Path]
	value, err := jsstring.FromCompilerText("#\uFFFD")
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{"names", "closed", "collection", "resolve", "package-mapping"} {
		request := governanceClosedSourceRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: project.GovernanceDigest, Path: file.Path, Operation: operation, Start: captured.coordinates.utf16(scanner.GetTokenPosOfNode(expression, file.Source, false)), End: captured.coordinates.utf16(expression.End()), SpecifierUnits: value.Units()}
		actual, err := session.observeClosedSource(request)
		if err != nil {
			t.Fatal(err)
		}
		if actual.Status != "unavailable" || actual.Reason == "" || actual.Names != nil || actual.Kind != nil || actual.Mapping != "" || actual.Resolution != nil {
			t.Fatalf("lossy JSON escaped %s admission: %#v", operation, actual)
		}
	}
	if len(project.typeOwner.cells) != 0 || len(project.typeDemandCache.entries) != 0 {
		t.Fatal("successful typed cells escaped JSON prerequisite")
	}
}

func TestGovernanceJSONFidelityCachedMetadataAndRepair(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	firstProject, first := testTypeDemand(t, root, cache)
	if !first.Known || len(cache.entries) == 0 {
		t.Fatalf("original faithful authority missing: %#v %#v", first, firstProject.stats)
	}
	warm, same := testTypeDemand(t, root, cache)
	if !reflect.DeepEqual(first, same) || warm.stats.TypeCacheHits != 1 {
		t.Fatal("faithful witnessed hit changed")
	}
	governanceWrite(t, root, "package.json", `{"type":"module","unused":"\uD800"}`)
	poisoned, value := testTypeDemand(t, root, cache)
	if value.Known || poisoned.stats.TypeCacheHits != 0 || len(poisoned.typeOwner.cells) != 0 {
		t.Fatalf("lossy current metadata admitted cached type: %#v %#v", value, poisoned.stats)
	}
	governanceWrite(t, root, "package.json", `{"type":"module","unused":"\\uD800"}`)
	_, repaired := testTypeDemand(t, root, cache)
	if !reflect.DeepEqual(first, repaired) {
		t.Fatalf("benign escaped slash did not recover: %#v", repaired)
	}
}
