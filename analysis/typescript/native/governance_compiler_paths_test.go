package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
)

func TestGovernanceCompilerPathsJSON(t *testing.T) {
	// These compiler operands are valid on every host, independently of the
	// host filesystem. The capture test below also exercises real Windows IO.
	for _, sample := range []struct{ path, normalized string }{
		{`C:\Users\runneradmin\domain\tsconfig.json`, "C:/Users/runneradmin/domain/tsconfig.json"},
		{`C:\work\domain\.\nested\..\package.json`, "C:/work/domain/package.json"},
		{`\\server\share\domain\tsconfig.json`, "//server/share/domain/tsconfig.json"},
		{`\\server\share\domain\.\nested\..\package.json`, "//server/share/domain/package.json"},
		{"/workspace/domain/./nested/../tsconfig.json", "/workspace/domain/tsconfig.json"},
	} {
		t.Run(sample.path, func(t *testing.T) {
			value, diagnostics := governanceParseConfigText(sample.path, `{"files":["index.ts"]}`)
			if value == nil || len(diagnostics) != 0 || !governanceJSONLiteralFidelity(sample.path, `{"name":"ordinary"}`) {
				t.Fatalf("normalized JSON lost its value or fidelity: %v", diagnostics)
			}
			if governanceJSONLiteralFidelity(sample.path, `{"name":"\uD800"}`) {
				t.Fatal("path normalization changed JSON code-unit admission")
			}
			_, diagnostics = governanceParseConfigText(sample.path, `{"files":`)
			if len(diagnostics) == 0 || diagnostics[0].File() == nil || diagnostics[0].File().FileName() != sample.normalized {
				t.Fatalf("malformed JSON lost normalized compiler location: %#v", diagnostics)
			}
		})
	}
}

func TestGovernanceCompilerPathsCapturedSourceOwner(t *testing.T) {
	root := filepath.Join(governanceTempDir(t), "domain space 😀")
	const source = `import {local} from '#local'; export const value=local;
function patch(input:{allowed?:string}){ const requested=input; return requested; }`
	governanceWrite(t, root, "index.ts", source)
	governanceWrite(t, root, "schema/local.ts", "export const local=1;")
	governanceWrite(t, root, "package.json", `{"type":"module","imports":{"#local":"./schema/local.ts"}}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noLib":true},"include":["index.ts","schema/**/*.ts"]}`)
	separator := string(filepath.Separator)
	requestedRoots := []string{root, root + separator + ".", root + separator + "nested" + separator + "..", filepath.ToSlash(root)}
	var originalFrame []byte
	var originalDigest string
	for _, requestedRoot := range requestedRoots {
		project, err := captureGovernedProject(requestedRoot, governanceTestPolicy())
		if err != nil {
			t.Fatal(err)
		}
		state := &governanceProductsSession{Project: project, Token: "paths", Generation: "1",
			Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":2}`)}}
		session := &governanceSession{productsSession: state}
		t.Cleanup(session.discardProducts)
		frame, err := session.closedSourceHandoff(false)
		if err != nil || frame.(map[string]any)["status"] != "source" {
			t.Fatalf("source-owner revision2 capture failed: %#v %v", frame, err)
		}
		encoded, err := json.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		if originalFrame == nil {
			originalFrame, originalDigest = encoded, project.GovernanceDigest
		} else if string(encoded) != string(originalFrame) || project.GovernanceDigest != originalDigest {
			t.Fatal("equivalent root spellings changed the captured source snapshot")
		}
		governanceSourceObservationFixture(t, session)
		file := project.FilesByPath["index.ts"]
		if file.AbsolutePath != filepath.Join(project.Root, "index.ts") || file.Source.FileName() != tspath.NormalizePath(file.AbsolutePath) || len(file.Source.Diagnostics()) != 0 {
			t.Fatal("compiler path normalization changed OS ownership or syntax diagnostics")
		}
		if mapping := project.packageImportMappingKind(file, "#local"); mapping != "literal" {
			t.Fatalf("package metadata mapping changed: %s", mapping)
		}
		if target := project.resolveProjectImport(file, "#local"); target != project.FilesByPath["schema/local.ts"] {
			t.Fatal("normalized compiler resolution lost captured OS file ownership")
		}
		var expression *ast.Node
		walkFile(file.Source, func(node *ast.Node) bool {
			if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Text() == "requested" {
				expression = node.AsVariableDeclaration().Initializer
			}
			return true
		})
		if expression == nil {
			t.Fatal("typed fixture expression missing")
		}
		answer, err := session.observeClosedSource(governanceClosedSourceRequest{Token: state.Token, Generation: state.Generation,
			SourceSnapshotDigest: project.GovernanceDigest, Path: "index.ts", Operation: "names",
			Start: file.coordinates.utf16(scanner.GetTokenPosOfNode(expression, file.Source, false)), End: file.coordinates.utf16(expression.End())})
		if err != nil || answer.Status != "known" || !reflect.DeepEqual(answer.Names, []jsstring.JSONText{"allowed"}) || project.stats.CompilerPrograms != 1 {
			t.Fatalf("same captured type owner changed: %#v %v programs=%d", answer, err, project.stats.CompilerPrograms)
		}
		if valid, err := project.capture.Verify(); err != nil || !valid {
			t.Fatalf("normalized compiler operands corrupted captured IO certificate: %v %v", valid, err)
		}
	}
	// Syntax diagnostics keep their portable source coordinates, regardless of
	// the root's OS spelling. Invalid source must still fail, without a panic.
	governanceWrite(t, root, "index.ts", "export const value=;")
	var originalDiagnostic string
	for _, requestedRoot := range requestedRoots {
		_, err := captureGovernedProject(requestedRoot, governanceTestPolicy())
		if err == nil || !strings.Contains(err.Error(), "index.ts:1:") {
			t.Fatalf("invalid source lost its diagnostic: %v", err)
		}
		if originalDiagnostic == "" {
			originalDiagnostic = err.Error()
		} else if err.Error() != originalDiagnostic {
			t.Fatal("root spelling changed portable syntax diagnostics")
		}
	}
}
