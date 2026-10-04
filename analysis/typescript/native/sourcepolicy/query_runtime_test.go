package sourcepolicy

import (
	runtime "astrale-typespec-v2-native-analysis/observabledecision"
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"os"
	"reflect"
	"testing"
	"unicode/utf16"
)

func TestSelectedFrozenCodegraphQueryRuleDecisionEvidenceAtBudgetBoundaries(t *testing.T) {
	type finding struct{ Kind, Evidence, AmbiguityReason string }
	var oracle struct {
		Cases []struct {
			Limits  runtime.Limits
			Queries []struct {
				SubjectID string
				Source    *struct {
					Path       string
					Start, End int
				}
			}
			SelectedDecisions struct {
				Canonical, Single struct {
					Status   string
					Findings []finding
				}
			}
		}
	}
	data, err := os.ReadFile("testdata/runtime-budget-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &oracle); err != nil {
		t.Fatal(err)
	}
	context := runtime.DemandContext{Resolve: func(owner, specifier, export string) runtime.Resolution {
		if specifier == "./helper" {
			return runtime.Resolution{Path: "helper.ts"}
		}
		if specifier == "@astrale-os/sdk/query" {
			if export == "defineQuery" || export == "defineCollectionQuery" {
				return runtime.Resolution{Origin: &runtime.Origin{Package: "@astrale-os/sdk", File: "src/application/query/define.ts", Path: []string{export}}}
			}
			if export == "Query" {
				return runtime.Resolution{Origin: &runtime.Origin{Package: "@astrale-os/kernel-core", File: "src/graph/query/index.ts", Path: []string{"Query"}}}
			}
		}
		return runtime.Resolution{Reason: "unqualified test export"}
	}, Effect: func(request runtime.EffectRequest) runtime.EffectSummary { return runtime.EffectSummary{Pure: true} }}
	project := &Project{FilesByPath: map[string]*File{}}
	for _, name := range []string{"read-tag.ts", "list-visible-issues.ts", "helper-query.ts", "helper.ts"} {
		directory := "../observabledecision/testdata/issues/"
		if name == "helper-query.ts" || name == "helper.ts" {
			directory = "../observabledecision/testdata/budgets/"
		}
		data, err := os.ReadFile(directory + name)
		if err != nil {
			t.Fatal(err)
		}
		layer := "queries"
		if name == "helper.ts" {
			layer = "shared"
		}
		file := &File{Path: name, Role: "production", Layer: layer, Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/fixture/" + name}, string(data), core.ScriptKindTS)}
		project.Files = append(project.Files, file)
		project.FilesByPath[name] = file
		context.Files = append(context.Files, runtime.CapturedFile{Path: name, AbsolutePath: "/fixture/" + name, Role: "production", Layer: layer, Text: string(data), Source: file.Source})
	}
	comparisons := 0
	for _, c := range oracle.Cases {
		context.Limits = c.Limits
		product := runtime.ObserveQueries(context)
		identities := map[string]string{}
		for _, q := range c.Queries {
			if q.Source != nil {
				identities[fmt.Sprintf("%s:%d:%d", q.Source.Path, q.Source.Start, q.Source.End)] = q.SubjectID
			}
		}
		result := EvaluateRuntimeQueries(project, RuntimeQueryInput{Product: product, CallIdentity: func(file *File, node *ast.Node) (string, bool) {
			key := fmt.Sprintf("%s:%d:%d", file.Path, qmStart(file, node), len(utf16.Encode([]rune(file.Source.Text()[:node.End()]))))
			id, known := identities[key]
			return id, known
		}})
		if len(result.Residual) != 2 {
			t.Fatalf("selected proof must remain inventory residual: %+v", result.Residual)
		}
		for _, rule := range []string{"QRY-CANON", "QRY-SINGLE"} {
			actual := []finding{}
			for _, e := range result.Evidence {
				if e.Rule != rule {
					continue
				}
				kind := "fail"
				if e.Kind == "ambiguity" {
					kind = "indeterminate"
				}
				actual = append(actual, finding{kind, e.Evidence, e.AmbiguityReason})
			}
			expected := c.SelectedDecisions.Canonical.Findings
			if rule == "QRY-SINGLE" {
				expected = c.SelectedDecisions.Single.Findings
			}
			if expected == nil {
				expected = []finding{}
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("decision %s at %+v\nexpected=%+v\nactual=%+v", rule, c.Limits, expected, actual)
			}
			comparisons++
		}
	}
	t.Logf("%d selected full rule decisions match frozen predicate evidence/order/public reasons; identity and effects explicitly supplied fixture premises, inventory remains residual", comparisons)
}
