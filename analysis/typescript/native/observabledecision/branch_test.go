package observabledecision

import (
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"reflect"
	"strings"
	"testing"
)

func legacySummary(value NativeValueSummary) map[string]any {
	switch value.Kind {
	case "string":
		return map[string]any{"kind": "literal", "value": value.Literal}
	case "literal":
		if strings.TrimPrefix(value.Literal, "Kind") == "NullKeyword" {
			return map[string]any{"kind": "literal", "value": nil}
		}
		return map[string]any{"kind": "literal", "value": value.Literal}
	case "undefined":
		return map[string]any{"kind": "literal"}
	case "object":
		return map[string]any{"kind": "object", "properties": value.Properties, "complete": value.Complete}
	default:
		return map[string]any{"kind": value.Kind}
	}
}
func TestFrozenBranchAssignmentAndCandidateBoundaries(t *testing.T) {
	var oracle struct {
		Source string
		Rows   []struct {
			Name       string
			Start, End int
			Limits     Limits
			Result     map[string]any
		}
	}
	raw, e := os.ReadFile("testdata/branch-oracle.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &oracle); e != nil {
		t.Fatal(e)
	}
	core, file := effectFixture(oracle.Source)
	core.authority.Symbol = func(_ CapturedFile, node *ast.Node) NativeEffectSymbol {
		if ast.IsFunctionLike(node) {
			return NativeEffectSymbol{Known: true, Key: fmt.Sprintf("function:%d", node.Pos())}
		}
		if node.Kind != ast.KindIdentifier {
			return NativeEffectSymbol{Known: true}
		}
		if function := effectFunctionOwner(node); function != nil {
			binding := selectedLocalBinding(function, node, inspectDemandFlow(function))
			if binding.found {
				return NativeEffectSymbol{Known: true, Key: fmt.Sprintf("local:%d:%s", function.Pos(), node.Text())}
			}
		}
		return NativeEffectSymbol{Known: true, Key: "global:" + node.Text()}
	}
	core.authority.Call = func(_ CapturedFile, node *ast.Node) NativeEffectCall {
		call := node.AsCallExpression()
		result := NativeEffectCall{Known: true}
		if call.Expression.Kind == ast.KindIdentifier && call.Expression.Text() == "opaque" && len(call.Arguments.Nodes) > 0 {
			result.Bindings = []NativeEffectBinding{{Argument: call.Arguments.Nodes[0], Parameter: "global:opaque:value"}}
		}
		return result
	}
	context := fixtureContext([]CapturedFile{*file})
	context.Model = "none"
	context.GlobalValue = func(_ string, node *ast.Node) GlobalValueObservation {
		var target *ast.Node
		if node.Text() == "read" || node.Text() == "outerconstant" {
			var walk func(*ast.Node)
			walk = func(n *ast.Node) {
				if n.Kind == ast.KindVariableDeclaration && n.Name().Kind == ast.KindIdentifier && n.Name().Text() == node.Text() {
					target = n
				}
				n.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
			}
			walk(file.Source.AsNode())
		}
		return GlobalValueObservation{Known: true, Target: target, TargetPath: file.Path}
	}
	context.CallTarget = func(_ string, node *ast.Node) NativeEffectCall {
		call := node.AsCallExpression()
		target := NativeEffectCall{Known: true, Dynamic: true}
		if call.Expression.Kind == ast.KindIdentifier && (call.Expression.Text() == "opaque" || call.Expression.Text() == "fn") {
			target.Dynamic = false
		}
		if call.Expression.Kind == ast.KindIdentifier && call.Expression.Text() == "rest" {
			target.Dynamic = false
			target.Bindings = []NativeEffectBinding{{Rest: true}}
		}
		return target
	}

	context.Effect = core.DemandEffects(func(request EffectRequest) EffectSummary {
		return EffectSummary{Pure: true, ChargeKey: request.Path + ":" + request.Operation}
	})
	reader := NewNativeValueReader(context)
	for _, row := range oracle.Rows {
		var expression *ast.Node
		var walk func(*ast.Node)
		walk = func(node *ast.Node) {
			if node.Kind == ast.KindArrowFunction && utf16At(file.Text, node.End()) == row.End {
				expression = node
			}
			node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
		}
		walk(file.Source.AsNode())
		if expression == nil {
			t.Fatalf("missing expression %s", row.Name)
		}
		proof := reader.Expression(file.Path, expression).Invoke().Resolve(row.Limits)
		out := map[string]any{"kind": proof.Outcome.Kind}
		if proof.Outcome.Kind == "known" {
			out["value"] = legacySummary(proof.Value)
			if len(proof.Outcome.Values) == 1 {
				out["value"] = legacySummary(proof.Outcome.Values[0])
			}
		}
		if len(proof.Outcome.Values) > 1 {
			values := []any{}
			for _, value := range proof.Outcome.Values {
				values = append(values, legacySummary(value))
			}
			out["values"] = values
		}
		if len(proof.Outcome.Candidates) > 0 {
			values := []any{}
			for _, value := range proof.Outcome.Candidates {
				values = append(values, legacySummary(value))
			}
			out["candidates"] = values
		}
		if proof.Outcome.Kind == "unsupported" {
			out["construct"] = proof.Outcome.Construct
		}
		if proof.Outcome.Kind != "known" && proof.Outcome.Kind != "unsupported" {
			reasons := []map[string]string{}
			if len(proof.Outcome.Reasons) > 0 {
				for _, reason := range proof.Outcome.Reasons {
					reasons = append(reasons, map[string]string{"code": reason.Code, "message": reason.Message})
				}
			} else {
				reasons = append(reasons, map[string]string{"code": proof.Outcome.Reason, "message": proof.Outcome.Message})
			}
			out["reasons"] = reasons
		}
		encoded, _ := json.Marshal(out)
		var normalized map[string]any
		json.Unmarshal(encoded, &normalized)
		if !reflect.DeepEqual(normalized, row.Result) {
			t.Errorf("%s limits%+v steps%d\nexpected%v\nactual%v", row.Name, row.Limits, proof.Outcome.Steps, row.Result, normalized)
		}
	}
}
