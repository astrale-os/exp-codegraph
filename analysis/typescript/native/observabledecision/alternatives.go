package observabledecision

import (
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
)

func (r *demandRun) alternatives(values []demandValue) demandValue {
	flat := []demandValue{}
	for _, value := range values {
		if value.kind == "alternatives" {
			flat = append(flat, value.values...)
		} else {
			flat = append(flat, value)
		}
	}
	if len(flat) > r.limits.MaximumAlternatives {
		r.exhausted = "VALUE_ALTERNATIVE_LIMIT"
		return demandUnknown(r.exhausted)
	}
	if len(flat) == 0 {
		return demandKnown("undefined", "")
	}
	if len(flat) == 1 {
		return flat[0]
	}
	return demandValue{kind: "alternatives", values: flat}
}
func (r *demandRun) escaped(value demandValue) demandValue {
	if value.kind == "alternatives" {
		values := []demandValue{}
		for _, v := range value.values {
			values = append(values, r.escaped(v))
		}
		return r.alternatives(values)
	}
	if value.kind == "object" || value.kind == "atom" || value.kind == "external" {
		return demandValue{kind: "unknown", reason: "VALUE_ESCAPE_UNSUPPORTED", candidates: []demandValue{value}}
	}
	return value
}
func valueSummary(value demandValue) NativeValueSummary {
	summary := NativeValueSummary{Kind: value.kind, Origin: value.origin}
	if value.kind == "string" || value.kind == "number" || value.kind == "literal" {
		summary.Literal = value.text
	}
	if value.kind == "function" && value.node != nil {
		summary.Identity = fmt.Sprintf("%s:%d:%d", value.module, value.node.Pos(), value.node.End())
		shape := DemandShape{Callable: true, ParameterCount: len(value.node.Parameters()), Async: ast.GetCombinedModifierFlags(value.node)&ast.ModifierFlagsAsync != 0}
		if value.node.Kind == ast.KindFunctionDeclaration {
			shape.Generator = value.node.AsFunctionDeclaration().AsteriskToken != nil
		}
		if value.node.Kind == ast.KindFunctionExpression {
			shape.Generator = value.node.AsFunctionExpression().AsteriskToken != nil
		}
		summary.Function = &shape
	}
	if value.kind == "object" {
		summary.Properties = []string{}
		for key := range value.properties {
			summary.Properties = append(summary.Properties, key)
		}
		sort.Strings(summary.Properties)
		summary.Complete = !value.incomplete
	}
	return summary
}
func distinctSummaries(values []NativeValueSummary) []NativeValueSummary {
	seen := map[string]bool{}
	out := []NativeValueSummary{}
	for _, value := range values {
		raw, _ := json.Marshal(value)
		key := string(raw)
		if !seen[key] {
			seen[key] = true
			out = append(out, value)
		}
	}
	return out
}
func (r *demandRun) projected(value demandValue) (kind string, values []NativeValueSummary, reasons []DemandReason) {
	if value.kind == "unsupported" {
		return "unknown", nil, []DemandReason{{Code: "VALUE_PATH_UNSUPPORTED", Message: "A possible value path uses " + value.text + "."}}
	}
	if value.kind == "unknown" {
		message := legacyValueMessage(value.reason)
		if value.text != "" {
			message = value.text
		}
		if message == "" {
			message = value.reason
		}
		for _, candidate := range value.candidates {
			_, v, _ := r.projected(candidate)
			values = append(values, v...)
		}
		return "unknown", values, []DemandReason{{Code: value.reason, Message: message}}
	}
	if value.kind == "alternatives" {
		unknown := false
		for _, candidate := range value.values {
			kind, v, why := r.projected(candidate)
			if kind == "unknown" {
				unknown = true
			}
			values = append(values, v...)
			reasons = append(reasons, why...)
		}
		values = distinctSummaries(values)
		if unknown {
			return "unknown", values, reasons
		}
		if len(values) == 1 {
			return "known", values, nil
		}
		return "ambiguous", values, []DemandReason{{Code: "VALUE_ALTERNATIVES", Message: "Several statically reachable values remain possible."}}
	}
	return "known", []NativeValueSummary{valueSummary(value)}, nil
}

func distinctReasons(reasons []DemandReason) []DemandReason {
	seen := map[DemandReason]bool{}
	out := []DemandReason{}
	for _, reason := range reasons {
		if !seen[reason] {
			seen[reason] = true
			out = append(out, reason)
		}
	}
	return out
}
