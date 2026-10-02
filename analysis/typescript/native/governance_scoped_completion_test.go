package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

// Exact former ScopedEffects materialization, rather than a second completion
// classifier. The regression observes complete production outcomes afterward.
func scopedFormerMaterializedCompletion(source *ast.SourceFile, node *ast.Node) completeness {
	builder := &bodyBuilder{file: source, body: node, occurrence: map[*ast.Node]string{}, occurrenceIndex: map[string]int{}}
	walk(node, func(child *ast.Node) bool {
		builder.occurrence[child] = governanceRuntimeNodeKey(source, child)
		return true
	})
	return buildControlFlow(builder).completion
}

func TestScopedCompletionOriginalReducerAndLaterObservations(t *testing.T) {
	cases := []declaredHeadsCase{
		{"straight", `const callback=()=>{const expanded=Query.from({nodes:[]}).expand({});return expanded.select({})};`, "", true},
		{"self", `const callback=():number=>{Query.from({nodes:[]}).select({});callback();return 1};`, "", false},
		{"async", `const callback=async()=>Query.from({nodes:[]}).select({});`, "", false},
		{"generator", `const callback=()=>{function* nested(){yield 1};return Query.from({nodes:[]}).select({})};`, "", false},
	}
	for _, fixture := range cfgCompletionFixtures() {
		cases = append(cases, declaredHeadsCase{fixture.name, `const callback=()=>{Query.from({nodes:[]}).select({});` + fixture.text + `;};`, "", false})
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			item.text += `function downstream(value:ReturnType<typeof Query.from>){return value}const observed=downstream(Query.from({nodes:[{suffix:true}]}));`
			root := declaredHeadsRoot(t, item)
			// Syntax-invalid sources never reach either original or projected
			// runtime owner. Preserve that original admission failure explicitly;
			// standalone golden CFG tests retain their parser-recovery coverage.
			if strings.HasPrefix(item.name, "malformed-") {
				_, err := captureGovernedProject(root, governanceTestPolicy())
				if err == nil || !strings.Contains(err.Error(), "TypeScript syntax errors") {
					t.Fatalf("original admission failure changed: %v", err)
				}
				return
			}
			type row struct {
				Summary     observabledecision.EffectSummary
				Suffix      []string
				Diagnostics []string
			}
			var rows [2]row
			for mode := range rows {
				owner, fn, _ := declaredHeadsOwner(t, root)
				check := owner.Identity.TypeOwner.program.Checker
				completion := scopedFormerMaterializedCompletion
				if mode == 1 {
					completion = buildControlFlowCompletion
				}
				req := observabledecision.EffectRequest{Path: "queries/case.ts", Node: fn, Operation: "invoke-function"}
				// Shared ownership/admission/self checks run FIRST. No target oracle or
				// whole-program diagnostics prewarm the candidate's completion path.
				rows[mode].Summary = owner.scopedEffectsWithReaders(req, owner.externalFactoryMemberCannotSelf, completion)
				if repeat := owner.scopedEffectsWithReaders(req, owner.externalFactoryMemberCannotSelf, completion); !reflect.DeepEqual(repeat, rows[mode].Summary) {
					t.Fatal("same owner repeated outcome changed")
				}
				var suffix *ast.Node
				walk(owner.ByPath["queries/case.ts"].Source.AsNode(), func(node *ast.Node) bool {
					if node.Kind == ast.KindCallExpression && node.Expression().Kind == ast.KindIdentifier && node.Expression().Text() == "downstream" {
						suffix = node
					}
					return true
				})
				if suffix == nil {
					t.Fatal("different context-coupled suffix missing")
				}
				value, sig := check.GetTypeAtLocation(suffix), check.GetResolvedSignature(suffix)
				if value == nil || sig == nil {
					t.Fatal("original suffix missing")
				}
				rows[mode].Suffix = append(rows[mode].Suffix, fmt.Sprintf("%d:%d:%s", value.Flags(), value.ObjectFlags(), owner.symbolKey(value.Symbol())))
				if decl := sig.Declaration(); decl != nil {
					rows[mode].Suffix = append(rows[mode].Suffix, fmt.Sprintf("%s:%d:%d:%d", ast.GetSourceFileOfNode(decl).FileName(), decl.Pos(), decl.End(), decl.Kind))
				}
				for _, parameter := range checker.Signature_parameters(sig) {
					rows[mode].Suffix = append(rows[mode].Suffix, owner.symbolKey(parameter))
				}
				for _, source := range owner.Identity.TypeOwner.program.TSProgram.GetSourceFiles() {
					rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetDiagnostics(context.Background(), source))...)
				}
				rows[mode].Diagnostics = append(rows[mode].Diagnostics, declaredHeadsDiagnostics(check.GetGlobalDiagnostics())...)
				same, err := owner.Identity.Project.capture.Verify()
				if err != nil || !same {
					t.Fatalf("source seal %v: %v", same, err)
				}
			}
			if !reflect.DeepEqual(rows[0], rows[1]) {
				t.Fatalf("original=%#v projection=%#v", rows[0], rows[1])
			}
			if item.name == "self" && rows[1].Summary.Reason != "VALUE_RECURSION" {
				t.Fatal("self recurrence omitted")
			}
		})
	}
}
