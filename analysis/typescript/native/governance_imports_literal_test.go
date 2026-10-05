package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/core"
	"github.com/microsoft/typescript-go/shim/parser"
)

// This golden contains actual frozen SDK collector results. It tests import
// facts only: malformed sources are intentionally included because the SDK
// collector can inspect their recovered AST before source syntax admission.
func TestGovernanceCollectImportsOriginalSDKLiteralFacts(t *testing.T) {
	oraclePath := os.Getenv("ASTRALE_NATIVE_IMPORTS_ORACLE")
	if oraclePath == "" {
		oraclePath = filepath.Join("testdata", "import-specifiers-original-sdk-v1.json")
	}
	raw, err := os.ReadFile(oraclePath)
	if err != nil {
		t.Fatalf("read mandatory original SDK import oracle: %v", err)
	}
	var oracle struct {
		Schema               int    `json:"schema"`
		SDKRevision          string `json:"sdkRevision"`
		TypeScript           string `json:"typescript"`
		OriginalOracleSHA256 string `json:"originalOracleSHA256"`
		Cases                []struct {
			Name                 string `json:"name"`
			VerbatimModuleSyntax bool   `json:"verbatimModuleSyntax"`
			Files                []struct {
				Path    string `json:"path"`
				Text    string `json:"text"`
				Imports []struct {
					SpecifierUnits []uint16 `json:"specifierUnits"`
					TypeOnly       bool     `json:"typeOnly"`
					Dynamic        bool     `json:"dynamic"`
				} `json:"imports"`
			} `json:"files"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &oracle); err != nil {
		t.Fatalf("decode original SDK import oracle: %v", err)
	}
	if oracle.Schema != 1 || oracle.SDKRevision != "8a2470cac32f5ef80a89e2f81dd03cec815dfca0" || oracle.TypeScript != "6.0.3" {
		t.Fatalf("unexpected original SDK import oracle provenance: schema=%d SDK=%q TypeScript=%q", oracle.Schema, oracle.SDKRevision, oracle.TypeScript)
	}
	if len(oracle.OriginalOracleSHA256) != 64 || strings.Trim(oracle.OriginalOracleSHA256, "0123456789abcdef") != "" {
		t.Fatal("original SDK import oracle must identify its full source-oracle SHA256")
	}
	if len(oracle.Cases) == 0 {
		t.Fatal("original SDK import oracle has no cases")
	}
	seen := make(map[string]bool, len(oracle.Cases))
	for _, fixture := range oracle.Cases {
		if fixture.Name == "" || seen[fixture.Name] {
			t.Fatalf("original SDK import oracle has an empty or duplicate case name %q", fixture.Name)
		}
		seen[fixture.Name] = true
		t.Run(fixture.Name, func(t *testing.T) {
			if len(fixture.Files) == 0 {
				t.Fatal("original SDK import case has no files")
			}
			for _, row := range fixture.Files {
				if row.Path == "" || row.Imports == nil {
					t.Fatalf("original SDK import case has missing path or import array: %q", row.Path)
				}
				kind := core.ScriptKindTS
				switch strings.ToLower(filepath.Ext(row.Path)) {
				case ".tsx":
					kind = core.ScriptKindTSX
				case ".js", ".mjs", ".cjs":
					kind = core.ScriptKindJS
				}
				absolute := filepath.Join(string(filepath.Separator), "native-imports-literal-fixture", filepath.FromSlash(row.Path))
				source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: absolute}, row.Text, kind)
				ast.SetParentInChildren(source.AsNode())
				if len(source.Diagnostics()) != 0 {
					t.Logf("%s: comparing recovered import facts with %d parser diagnostics; this does not qualify full source admission", row.Path, len(source.Diagnostics()))
				}
				actual := governanceCollectImports(source, fixture.VerbatimModuleSyntax)
				if len(actual) != len(row.Imports) {
					t.Fatalf("%s: import count got %d, original SDK %d", row.Path, len(actual), len(row.Imports))
				}
				for i, expected := range row.Imports {
					if expected.SpecifierUnits == nil {
						t.Fatalf("%s import %d: original SDK specifier units are missing", row.Path, i)
					}
					// WTF-8 is a lossless encoding of these UTF-16 units, including
					// lone surrogates; comparing it does not replace them with U+FFFD.
					expectedSpecifier := jsstring.FromUnits(expected.SpecifierUnits).WTF8()
					if actual[i].Specifier != expectedSpecifier || actual[i].TypeOnly != expected.TypeOnly || actual[i].Dynamic != expected.Dynamic {
						t.Errorf("%s import %d: got specifier bytes %x typeOnly=%t dynamic=%t; original SDK units=%04x bytes=%x typeOnly=%t dynamic=%t", row.Path, i, []byte(actual[i].Specifier), actual[i].TypeOnly, actual[i].Dynamic, expected.SpecifierUnits, []byte(expectedSpecifier), expected.TypeOnly, expected.Dynamic)
					}
				}
			}
		})
	}
}
